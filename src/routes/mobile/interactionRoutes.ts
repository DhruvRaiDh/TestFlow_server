import { Router } from 'express';
import {
    tap, doubleTap, longPress, swipe, typeText, pressBack, pressHome, pressKey,
    getWindowSize
} from '../../services/mobile/AdbDirectService';
import { findElementByCoords } from '../../services/mobile/InspectorService';

export const interactionRoutes = Router();

// Helper: get deviceId for a session (passed directly in body/params)

// ── Tap ───────────────────────────────────────────────────────────────────

interactionRoutes.post('/tap/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { x, y } = req.body;
        if (x === undefined || y === undefined) return res.status(400).json({ error: 'x and y required' });

        await tap(deviceId, x, y);

        // Try to get element info for step recording
        let element: any = null;
        try {
            element = await findElementByCoords(deviceId, x, y);
        } catch { /* non-fatal */ }

        res.json({ success: true, x, y, element });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Double Tap ────────────────────────────────────────────────────────────

interactionRoutes.post('/double-tap/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { x, y } = req.body;
        await doubleTap(deviceId, x, y);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Long Press ────────────────────────────────────────────────────────────

interactionRoutes.post('/long-press/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { x, y, duration } = req.body;
        await longPress(deviceId, x, y, duration);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Swipe ─────────────────────────────────────────────────────────────────

interactionRoutes.post('/swipe/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { startX, startY, endX, endY, duration } = req.body;
        await swipe(deviceId, startX, startY, endX, endY, duration);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Type Text ─────────────────────────────────────────────────────────────

interactionRoutes.post('/type/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: 'text required' });
        await typeText(deviceId, text);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Key Events ────────────────────────────────────────────────────────────

interactionRoutes.post('/back/:deviceId', async (req, res) => {
    try {
        await pressBack(req.params.deviceId);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

interactionRoutes.post('/home/:deviceId', async (req, res) => {
    try {
        await pressHome(req.params.deviceId);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

interactionRoutes.post('/key/:deviceId', async (req, res) => {
    try {
        const { keyCode } = req.body;
        await pressKey(req.params.deviceId, keyCode);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Device info ───────────────────────────────────────────────────────────

interactionRoutes.get('/window-size/:deviceId', async (req, res) => {
    try {
        const size = await getWindowSize(req.params.deviceId);
        res.json(size);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ── Element detection (without tap) ───────────────────────────────────────

interactionRoutes.post('/element-at/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { x, y } = req.body;
        if (x === undefined || y === undefined) return res.status(400).json({ error: 'x and y required' });

        const element = await findElementByCoords(deviceId, x, y);
        res.json({ element });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});
