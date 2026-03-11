import { Router } from 'express';
import {
    listScripts, getScript, createScript, updateScript, deleteScript
} from '../../services/mobile/ScriptStorageService';
import { generateWebdriverIOScript } from '../../services/mobile/ScriptGeneratorService';

export const scriptRoutes = Router();

// ── List all scripts ──────────────────────────────────────────────────────

scriptRoutes.get('/scripts', async (req, res) => {
    try {
        const scripts = await listScripts();
        res.json({ scripts });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ── Get single script ─────────────────────────────────────────────────────

scriptRoutes.get('/scripts/:id', async (req, res) => {
    try {
        const script = await getScript(req.params.id);
        if (!script) return res.status(404).json({ error: 'Script not found' });
        res.json({ script });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ── Create script ─────────────────────────────────────────────────────────

scriptRoutes.post('/scripts', async (req, res) => {
    try {
        const { name, description, tags, platform, deviceId, appPackage, appActivity, steps } = req.body;
        if (!name || !steps) return res.status(400).json({ error: 'name and steps required' });

        const script = await createScript({
            name,
            description,
            tags: tags || [],
            platform: platform || 'android',
            deviceId,
            appPackage,
            appActivity,
            steps,
            stepCount: steps.length,
        });
        res.status(201).json({ script });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ── Update script ─────────────────────────────────────────────────────────

scriptRoutes.put('/scripts/:id', async (req, res) => {
    try {
        const script = await updateScript(req.params.id, req.body);
        if (!script) return res.status(404).json({ error: 'Script not found' });
        res.json({ script });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ── Delete script ─────────────────────────────────────────────────────────

scriptRoutes.delete('/scripts/:id', async (req, res) => {
    try {
        const deleted = await deleteScript(req.params.id);
        if (!deleted) return res.status(404).json({ error: 'Script not found' });
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ── Generate WebdriverIO code ──────────────────────────────────────────────

scriptRoutes.post('/generate-script', async (req, res) => {
    try {
        const { steps, config } = req.body;
        if (!steps?.length) return res.status(400).json({ error: 'steps required' });
        const code = generateWebdriverIOScript(steps, config || { deviceId: 'emulator-5554' });
        res.json({ code });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});
