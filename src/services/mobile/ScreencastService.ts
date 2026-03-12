import { Response } from 'express';
import { screenshotBase64 } from './AdbDirectService';

// ── SSE-based screen streaming using direct ADB screencap ─────────────────
// Much faster than Appium's getScreenshot() — direct `adb exec-out screencap -p`
// Achieves ~3-5 FPS reliably without Appium session overhead

interface StreamSession {
    deviceId: string;
    res: Response;
    interval: ReturnType<typeof setInterval> | null;
    active: boolean;
    errorCount: number;
}

const MAX_ERRORS = 4;

const streams = new Map<string, StreamSession>();

export function startStream(sessionId: string, deviceId: string, res: Response, fps = 4): void {
    // Close any existing stream for this session
    stopStream(sessionId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const session: StreamSession = { deviceId, res, interval: null, active: true, errorCount: 0 };
    streams.set(sessionId, session);

    // Send initial heartbeat so frontend knows SSE is alive
    res.write(`data: ${JSON.stringify({ type: 'connected', deviceId })}\n\n`);
    console.log(`[Screencast] Stream started for session=${sessionId} device=${deviceId} fps=${fps}`);

    const frameMs = Math.round(1000 / fps);
    let frameSent = false;

    const sendFrame = async () => {
        const s = streams.get(sessionId);
        if (!s || !s.active) return;

        try {
            const base64 = await screenshotBase64(deviceId);
            s.errorCount = 0; // reset on success
            frameSent = true;

            if (s.active && !res.writableEnded) {
                res.write(`data: ${JSON.stringify({ type: 'frame', image: base64 })}\n\n`);
            }
        } catch (err: any) {
            s.errorCount++;
            console.warn(`[Screencast] Frame error #${s.errorCount} for ${sessionId}: ${err.message}`);
            // Fast-fail on first frame error if no frame was ever sent — device likely unreachable
            const limit = !frameSent ? 1 : MAX_ERRORS;
            if (s.errorCount >= limit) {
                s.active = false;
                if (session.interval) clearInterval(session.interval);
                console.error(`[Screencast] Stream failed for ${sessionId} after ${s.errorCount} errors`);
                if (!res.writableEnded) {
                    res.write(`data: ${JSON.stringify({ type: 'error', message: `ADB screenshot failed: ${err.message}` })}\n\n`);
                    res.end();
                }
                streams.delete(sessionId);
            }
        }
    };

    // First frame immediately
    sendFrame();
    session.interval = setInterval(sendFrame, frameMs);

    // Cleanup on client disconnect
    res.on('close', () => stopStream(sessionId));
    res.on('error', () => stopStream(sessionId));
}

export function stopStream(sessionId: string): void {
    const s = streams.get(sessionId);
    if (!s) return;
    s.active = false;
    if (s.interval) clearInterval(s.interval);
    if (!s.res.writableEnded) {
        try { s.res.end(); } catch { }
    }
    streams.delete(sessionId);
}

export function getActiveStreams(): string[] {
    return [...streams.keys()];
}
