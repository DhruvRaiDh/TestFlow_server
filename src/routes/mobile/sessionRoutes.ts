import { Router, Request, Response } from 'express';
import { createSession, closeSession } from '../../services/mobile/AppiumService';
import { startStream, stopStream } from '../../services/mobile/ScreencastService';

export const sessionRoutes = Router();

const activeSessions = new Map<string, { deviceId: string; appPackage?: string }>();

// ── Start session ─────────────────────────────────────────────────────────

sessionRoutes.post('/session/start', async (req, res) => {
    try {
        const { deviceId, appPackage, appActivity, apkPath, noReset } = req.body;
        if (!deviceId) return res.status(400).json({ success: false, message: 'deviceId is required' });

        // For recorder, we skip Appium session if no app specified — use ADB only
        const sessionId = crypto.randomUUID();
        activeSessions.set(sessionId, { deviceId, appPackage });

        // Optionally start an Appium session if app params given (for element inspection)
        if (appPackage || apkPath) {
            try {
                const session = await createSession({ deviceId, appPackage, appActivity, apkPath, noReset });
                // Store session ID so we can use Appium commands later
                activeSessions.set(sessionId, { deviceId, appPackage });
            } catch (err: any) {
                // Non-fatal — recorder still works with ADB only
                console.warn('[Mobile] Appium session failed (ADB-only mode):', err.message);
            }
        }

        res.json({ success: true, sessionId, deviceId });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── Stop session ─────────────────────────────────────────────────────────

sessionRoutes.delete('/session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        stopStream(sessionId);
        await closeSession(sessionId).catch(() => { });
        activeSessions.delete(sessionId);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── SSE Screen Stream ─────────────────────────────────────────────────────

sessionRoutes.get('/stream/:sessionId', (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const fps = parseInt(req.query.fps as string) || 4;

    const sessionInfo = activeSessions.get(sessionId);
    if (!sessionInfo) {
        return res.status(404).json({ error: 'Session not found' });
    }

    startStream(sessionId, sessionInfo.deviceId, res, fps);
});
