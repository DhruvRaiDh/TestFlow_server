import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { settingsService } from '../../services/persistence/SettingsService';

const execAsync = promisify(exec);
const router = Router();

// ── Tool Settings ─────────────────────────────────────────────────────────────

// GET /api/settings/tools
router.get('/tools', async (req, res) => {
    try {
        const toolSettings = await settingsService.getToolSettings();
        res.json(toolSettings);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch tool settings' });
    }
});

// PUT /api/settings/tools
router.put('/tools', async (req, res) => {
    try {
        const updated = await settingsService.saveToolSettings(req.body);
        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: 'Failed to save tool settings' });
    }
});

// POST /api/settings/tools/test — verify a tool path works
router.post('/tools/test', async (req, res) => {
    const { tool, toolPath } = req.body as { tool: string; toolPath: string };
    if (!tool || !toolPath) return res.status(400).json({ ok: false, error: 'Missing tool or toolPath' });

    const versionFlagMap: Record<string, string> = {
        scrcpy: '--version',
        adb: 'version',
        python: '--version',
        java: '-version',
        node: '--version',
    };

    const flag = versionFlagMap[tool] ?? '--version';
    const cmd = `"${toolPath}" ${flag}`;

    try {
        const { stdout, stderr } = await execAsync(cmd, { timeout: 5000 });
        const output = (stdout || stderr).trim().split('\n')[0]; // first line only
        res.json({ ok: true, version: output });
    } catch (err: any) {
        res.json({ ok: false, error: err.message?.split('\n')[0] ?? 'Tool not found or failed to run' });
    }
});

// Get AI Keys
router.get('/keys', async (req, res) => {
    try {
        const userId = (req as any).user?.uid;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const keys = await settingsService.getAIKeys(userId);
        res.json(keys);
    } catch (error) {
        console.error('Error fetching AI keys:', error);
        res.status(500).json({ error: 'Failed to fetch keys' });
    }
});

// Add AI Key
router.post('/keys', async (req, res) => {
    try {
        const userId = (req as any).user?.uid;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { name, apiKey, model, provider, baseUrl } = req.body;
        if (!name || !apiKey || !model) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const newKey = await settingsService.addAIKey(userId, { name, apiKey, model, provider, baseUrl });
        res.status(201).json(newKey);
    } catch (error) {
        console.error('Error adding AI key:', error);
        res.status(500).json({ error: 'Failed to add key', details: (error as any).message || JSON.stringify(error) });
    }
});

// Activate Key
router.put('/keys/:id/activate', async (req, res) => {
    try {
        const userId = (req as any).user?.uid;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { id } = req.params;
        await settingsService.activateAIKey(userId, id);
        res.json({ status: 'success' });
    } catch (error) {
        console.error('Error activating key:', error);
        res.status(500).json({ error: 'Failed to activate key' });
    }
});

// Delete Key
router.delete('/keys/:id', async (req, res) => {
    try {
        const userId = (req as any).user?.uid;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { id } = req.params;
        await settingsService.deleteAIKey(userId, id);
        res.json({ status: 'success' });
    } catch (error) {
        console.error('Error deleting key:', error);
        res.status(500).json({ error: 'Failed to delete key' });
    }
});

export { router as settingsRoutes };
