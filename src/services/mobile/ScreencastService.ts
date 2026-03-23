import { Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import { screenshotBase64, getWindowSize } from './AdbDirectService';
import { settingsService } from '../persistence/SettingsService';
import path from 'path';
import os from 'os';
import fs from 'fs';

// ── Screencast Service ────────────────────────────────────────────────────────
//
// Strategy:
//   • If scrcpy is available → launch it WITH a visible window (60fps, zero lag)
//     The user interacts directly with the scrcpy window.
//     Backend captures physical touches via getevent (TouchEventService).
//     Frontend shows a status panel + step recorder.
//
//   • If scrcpy is NOT available → fall back to adb screencap loop at 15fps
//     (slower but works without scrcpy installed)
//
// ─────────────────────────────────────────────────────────────────────────────

interface StreamSession {
    deviceId: string;
    res: Response;
    interval: ReturnType<typeof setInterval> | null;
    proc: ChildProcess | null;
    active: boolean;
    errorCount: number;
    width: number;
    height: number;
    mode: 'scrcpy' | 'screencap';
}

const MAX_ERRORS = 5;
const streams = new Map<string, StreamSession>();

// ── scrcpy path resolution ─────────────────────────────────────────────────

async function resolveScrcpyPath(): Promise<string | null> {
    try {
        const settings = await settingsService.getToolSettings();
        if (settings.scrcpyPath && fs.existsSync(settings.scrcpyPath)) {
            return settings.scrcpyPath;
        }
    } catch { }

    // Check Documents/TestFlow/tools/scrcpy/
    const docsPath = path.join(os.homedir(), 'Documents', 'TestFlow', 'tools', 'scrcpy',
        os.platform() === 'win32' ? 'scrcpy.exe' : 'scrcpy');
    if (fs.existsSync(docsPath)) return docsPath;

    return null; // Not found — will fall back to screencap
}

// ── SSE helpers ────────────────────────────────────────────────────────────

function sseWrite(res: Response, payload: object) {
    if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
}

function setupSSE(res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
}

// ── Launch scrcpy with visible window ──────────────────────────────────────

async function launchScrcpyWindow(
    sessionId: string,
    session: StreamSession,
    fps: number,
): Promise<boolean> {
    const scrcpyBin = await resolveScrcpyPath();
    if (!scrcpyBin) return false;

    const args = [
        `-s`, session.deviceId,
        `--no-audio`,
        `--max-fps`, `${Math.min(fps, 60)}`,
        `--bit-rate`, `4M`,
        `--stay-awake`,
        `--window-title`, `TestFlow - ${session.deviceId}`,
    ];

    console.log(`[Screencast] Launching scrcpy window for device ${session.deviceId}`);

    return new Promise((resolve) => {
        try {
            const proc = spawn(scrcpyBin, args, {
                shell: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            session.proc = proc;
            session.mode = 'scrcpy';

            let started = false;

            proc.stderr?.on('data', (data: Buffer) => {
                const line = data.toString();
                // scrcpy prints info to stderr
                if (line.includes('INFO') && !started) {
                    started = true;
                    console.log(`[Screencast] scrcpy window opened for ${sessionId}`);
                    sseWrite(session.res, { type: 'scrcpy-started', deviceId: session.deviceId });
                    resolve(true);
                }
            });

            proc.on('close', (code) => {
                console.log(`[Screencast] scrcpy exited code=${code} session=${sessionId}`);
                session.proc = null;
                if (session.active) {
                    sseWrite(session.res, { type: 'scrcpy-closed' });
                }
            });

            proc.on('error', (err) => {
                console.warn(`[Screencast] scrcpy launch error: ${err.message}`);
                session.proc = null;
                resolve(false);
            });

            // If scrcpy doesn't start within 5s, fall back
            setTimeout(() => {
                if (!started) {
                    console.warn(`[Screencast] scrcpy didn't start in 5s — falling back to screencap`);
                    resolve(false);
                }
            }, 5000);

        } catch (err: any) {
            console.warn(`[Screencast] Could not launch scrcpy: ${err.message}`);
            resolve(false);
        }
    });
}

// ── Fallback: ADB screencap loop ───────────────────────────────────────────

async function startScreencapLoop(sessionId: string, session: StreamSession, fps: number) {
    const frameMs = Math.round(1000 / Math.min(fps, 30));
    let frameSent = false;

    session.mode = 'screencap';
    sseWrite(session.res, { type: 'screencap-mode', fps });

    const sendFrame = async () => {
        const s = streams.get(sessionId);
        if (!s || !s.active) return;

        try {
            const base64 = await screenshotBase64(s.deviceId);
            s.errorCount = 0;
            frameSent = true;
            sseWrite(s.res, { type: 'frame', image: base64, width: s.width, height: s.height });
        } catch (err: any) {
            s.errorCount++;
            const limit = !frameSent ? 1 : MAX_ERRORS;
            if (s.errorCount >= limit) {
                s.active = false;
                if (s.interval) clearInterval(s.interval);
                sseWrite(s.res, { type: 'error', message: `ADB screenshot failed: ${err.message}` });
                if (!s.res.writableEnded) s.res.end();
                streams.delete(sessionId);
            }
        }
    };

    sendFrame();
    session.interval = setInterval(sendFrame, frameMs);
}

// ── Public: startStream ────────────────────────────────────────────────────

export async function startStream(
    sessionId: string,
    deviceId: string,
    res: Response,
    fps = 15,
): Promise<void> {
    stopStream(sessionId);
    setupSSE(res);

    // Fetch real device dimensions
    let width = 1080, height = 1920;
    try {
        const size = await getWindowSize(deviceId);
        width = size.width;
        height = size.height;
    } catch { }

    const session: StreamSession = {
        deviceId, res, interval: null, proc: null,
        active: true, errorCount: 0, width, height, mode: 'screencap',
    };
    streams.set(sessionId, session);

    // Send handshake with device info
    sseWrite(res, { type: 'connected', deviceId, width, height });
    console.log(`[Screencast] Stream init: session=${sessionId} device=${deviceId} res=${width}x${height}`);

    // Try scrcpy first (visible window — 60fps zero lag)
    const scrcpyOk = await launchScrcpyWindow(sessionId, session, fps);

    if (!scrcpyOk) {
        // Fall back to screencap loop
        console.log(`[Screencast] scrcpy unavailable — using ADB screencap at ${fps}fps`);
        await startScreencapLoop(sessionId, session, fps);
    }

    res.on('close', () => stopStream(sessionId));
    res.on('error', () => stopStream(sessionId));
}

// ── Public: stopStream ─────────────────────────────────────────────────────

export function stopStream(sessionId: string): void {
    const s = streams.get(sessionId);
    if (!s) return;
    s.active = false;
    if (s.interval) clearInterval(s.interval);
    if (s.proc) {
        try { s.proc.kill(); } catch { }
        s.proc = null;
    }
    if (!s.res.writableEnded) {
        try { s.res.end(); } catch { }
    }
    streams.delete(sessionId);
}

export function getActiveStreams(): string[] {
    return [...streams.keys()];
}
