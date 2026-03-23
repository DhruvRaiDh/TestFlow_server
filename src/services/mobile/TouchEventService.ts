import { spawn, ChildProcess } from 'child_process';
import { Response } from 'express';
import { resolveAndroidHome } from './AdbDirectService';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { settingsService } from '../persistence/SettingsService';

// ── TouchEventService ─────────────────────────────────────────────────────────
// Listens to getevent on the Android device to capture physical touch events.
// Converts raw ABS_MT_POSITION_X/Y events into tap/swipe steps that are sent
// back to the frontend as SSE events — enabling "record by touching the phone".
// ─────────────────────────────────────────────────────────────────────────────

interface TouchSession {
    proc: ChildProcess | null;
    res: Response;
    active: boolean;
    // in-progress touch tracking
    pendingX: number | null;
    pendingY: number | null;
    startX: number | null;
    startY: number | null;
    startTime: number;
    deviceWidth: number;
    deviceHeight: number;
}

const sessions = new Map<string, TouchSession>();

async function getAdbPath(): Promise<string> {
    try {
        const s = await settingsService.getToolSettings();
        if (s.adbPath) return s.adbPath;
    } catch { }
    const ah = resolveAndroidHome();
    if (ah) {
        const p = path.join(ah, 'platform-tools', os.platform() === 'win32' ? 'adb.exe' : 'adb');
        if (fs.existsSync(p)) return p;
    }
    return 'adb';
}

// Parse a single getevent line and update in-flight touch state
function parseLine(line: string, session: TouchSession): { type: string; x?: number; y?: number; startX?: number; startY?: number; endX?: number; endY?: number } | null {
    // Example getevent -lt lines:
    // [  1234.567] /dev/input/event1: EV_ABS       ABS_MT_POSITION_X    0000020a
    // [  1234.567] /dev/input/event1: EV_SYN       SYN_REPORT           00000000
    // [  1234.567] /dev/input/event1: EV_ABS       ABS_MT_TRACKING_ID   ffffffff  ← finger up

    const xMatch = line.match(/ABS_MT_POSITION_X\s+([0-9a-f]+)/i);
    const yMatch = line.match(/ABS_MT_POSITION_Y\s+([0-9a-f]+)/i);
    const trackingMatch = line.match(/ABS_MT_TRACKING_ID\s+([0-9a-f]+)/i);
    const synReport = line.includes('SYN_REPORT');

    if (xMatch) {
        session.pendingX = parseInt(xMatch[1], 16);
    }
    if (yMatch) {
        session.pendingY = parseInt(yMatch[1], 16);
    }

    if (trackingMatch) {
        const id = parseInt(trackingMatch[1], 16);
        if (id === 0xffffffff) {
            // Finger up — calculate gesture
            if (session.startX !== null && session.startY !== null && session.pendingX !== null && session.pendingY !== null) {
                const endX = session.pendingX;
                const endY = session.pendingY;
                const duration = Date.now() - session.startTime;
                const dx = Math.abs(endX - session.startX);
                const dy = Math.abs(endY - session.startY);

                const result = dx > 30 || dy > 30
                    ? { type: 'swipe', startX: session.startX, startY: session.startY, endX, endY }
                    : { type: 'tap', x: session.startX, y: session.startY };

                // Reset
                session.startX = null; session.startY = null;
                session.pendingX = null; session.pendingY = null;
                return result;
            }
        } else {
            // Finger down — record start position
            session.startX = session.pendingX;
            session.startY = session.pendingY;
            session.startTime = Date.now();
        }
    }

    return null;
}

export async function startTouchEvents(
    sessionId: string,
    deviceId: string,
    res: Response,
    deviceWidth = 1080,
    deviceHeight = 1920,
): Promise<void> {
    stopTouchEvents(sessionId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const session: TouchSession = {
        proc: null, res, active: true,
        pendingX: null, pendingY: null,
        startX: null, startY: null, startTime: 0,
        deviceWidth, deviceHeight,
    };
    sessions.set(sessionId, session);

    const adb = await getAdbPath();

    // Use getevent -lt for human-readable events
    const proc = spawn(adb, ['-s', deviceId, 'shell', 'getevent', '-lt'], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    session.proc = proc;

    let buf = '';
    proc.stdout?.on('data', (data: Buffer) => {
        buf += data.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
            const s = sessions.get(sessionId);
            if (!s || !s.active) break;

            const event = parseLine(line, s);
            if (event && !res.writableEnded) {
                res.write(`data: ${JSON.stringify({ category: 'touch', ...event })}\n\n`);
            }
        }
    });

    proc.on('close', () => {
        sessions.delete(sessionId);
    });

    proc.on('error', (err) => {
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
            res.end();
        }
        sessions.delete(sessionId);
    });

    res.on('close', () => stopTouchEvents(sessionId));
    res.on('error', () => stopTouchEvents(sessionId));

    console.log(`[TouchEvents] Listening for physical touches on device=${deviceId} session=${sessionId}`);
}

export function stopTouchEvents(sessionId: string): void {
    const s = sessions.get(sessionId);
    if (!s) return;
    s.active = false;
    if (s.proc) {
        try { s.proc.kill(); } catch { }
        s.proc = null;
    }
    if (!s.res.writableEnded) {
        try { s.res.end(); } catch { }
    }
    sessions.delete(sessionId);
}
