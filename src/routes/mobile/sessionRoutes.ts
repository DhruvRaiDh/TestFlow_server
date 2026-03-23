import { Router, Request, Response } from 'express';
import { createSession, closeSession } from '../../services/mobile/AppiumService';
import { startStream, stopStream } from '../../services/mobile/ScreencastService';
import { startTouchEvents, stopTouchEvents } from '../../services/mobile/TouchEventService';
import { getWindowSize } from '../../services/mobile/AdbDirectService';
import { settingsService } from '../../services/persistence/SettingsService';

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
        stopTouchEvents(sessionId);
        await closeSession(sessionId).catch(() => { });
        activeSessions.delete(sessionId);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── SSE Screen Stream ─────────────────────────────────────────────────────

sessionRoutes.get('/stream/:sessionId', async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    // Read FPS from settings, fallback to query param, fallback to 15
    let fps = 15;
    try {
        const toolSettings = await settingsService.getToolSettings();
        fps = toolSettings.streamFps ?? fps;
    } catch { }
    const queryFps = parseInt(req.query.fps as string);
    if (queryFps > 0) fps = queryFps;

    const sessionInfo = activeSessions.get(sessionId);
    if (!sessionInfo) {
        return res.status(404).json({ error: 'Session not found' });
    }

    startStream(sessionId, sessionInfo.deviceId, res, fps);
});

// ── SSE Touch Events (physical device touches via getevent) ───────────────

sessionRoutes.get('/touch-events/:sessionId', async (req: Request, res: Response) => {
    const { sessionId } = req.params;

    const sessionInfo = activeSessions.get(sessionId);
    if (!sessionInfo) {
        return res.status(404).json({ error: 'Session not found' });
    }

    // Get device resolution for coordinate mapping
    let width = 1080, height = 1920;
    try {
        const size = await getWindowSize(sessionInfo.deviceId);
        width = size.width;
        height = size.height;
    } catch { }

    startTouchEvents(sessionId, sessionInfo.deviceId, res, width, height);
});

// ── Device info (resolution) ──────────────────────────────────────────────

sessionRoutes.get('/device-info/:deviceId', async (req: Request, res: Response) => {
    try {
        const { deviceId } = req.params;
        const size = await getWindowSize(deviceId);
        res.json({ width: size.width, height: size.height });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});
