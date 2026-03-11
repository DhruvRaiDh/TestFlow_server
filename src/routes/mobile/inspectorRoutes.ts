import { Router } from 'express';
import { getElementTree } from '../../services/mobile/InspectorService';
import { screenshotBase64 } from '../../services/mobile/AdbDirectService';

export const inspectorRoutes = Router();

// ── Get element tree + screenshot for inspector ────────────────────────────

inspectorRoutes.get('/inspector/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { tree, screenshotBase64: screenshot } = await getElementTree(deviceId);
        res.json({ tree, screenshot });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ── Standalone screenshot ──────────────────────────────────────────────────

inspectorRoutes.get('/screenshot/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const screenshot = await screenshotBase64(deviceId);
        res.json({ screenshot });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});
