import express from 'express';
import { recorderService } from '../../services/execution/RecorderService';

export const recorderRoutes = express.Router();

recorderRoutes.post('/start', async (req, res) => {
    try {
        const { url } = req.body;
        await recorderService.startRecording(url);
        res.json({ status: 'started' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

recorderRoutes.post('/stop', async (req, res) => {
    try {
        const steps = await recorderService.stopRecording();
        res.json({ status: 'stopped', steps });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

recorderRoutes.post('/save', async (req, res) => {
    try {
        const script = await recorderService.saveScript(req.body);
        res.json(script);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

recorderRoutes.get('/list', async (req, res) => {
    try {
        const { projectId, userId } = req.query;
        // Fallback to header if not in query
        const uid = (userId as string) || (req.headers['x-user-id'] as string);
        const scripts = await recorderService.getScripts(projectId as string, uid);
        res.json(scripts);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Alias for frontend compatibility (VisualTests.tsx calls /scripts)
recorderRoutes.get('/scripts', async (req, res) => {
    try {
        const { projectId, userId } = req.query;
        // Fallback to header
        const uid = (userId as string) || (req.headers['x-user-id'] as string);
        const scripts = await recorderService.getScripts(projectId as string, uid);
        res.json(scripts);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

recorderRoutes.post('/play', async (req, res) => {
    try {
        const { scriptId, projectId } = req.body;
        // userId isn't typically available here unless auth middleware is used.
        // We'll rely on the new fallback in service.
        const result = await recorderService.playScript(scriptId);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

recorderRoutes.get('/reports', async (req, res) => {
    try {
        const { projectId, userId } = req.query;
        // Fallback to header or request user
        const uid = (userId as string) || (req.headers['x-user-id'] as string) || (req as any).user?.uid;

        const reports = await recorderService.getReports(projectId as string, uid);
        res.json(reports);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

recorderRoutes.delete('/reports/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await recorderService.deleteReport(id);
        res.json({ status: 'deleted' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

recorderRoutes.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { projectId } = req.query;
        if (!projectId) return res.status(400).json({ error: 'Project ID is required' });
        await recorderService.deleteScript(id, projectId as string);
        res.json({ status: 'deleted' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});


recorderRoutes.get('/export/:id/:format', async (req, res) => {
    try {
        const { id, format } = req.params;
        const { projectId, userId } = req.query;
        const uid = (userId as string) || (req.headers['x-user-id'] as string) || (req as any).user?.uid;

        const result = await recorderService.exportScript(id, format as 'side' | 'java' | 'python' | 'playwright-ts', uid);

        if (format === 'side') {
            res.header('Content-Type', 'application/json');
            res.attachment(`${id}.side`);
            res.send(JSON.stringify(result, null, 2));
        } else if (format === 'playwright-ts') {
            res.header('Content-Type', 'text/plain');
            res.attachment(`${id}.spec.ts`);
            res.send(result);
        } else {
            res.header('Content-Type', 'text/plain');
            res.attachment(`${id}.${format === 'python' ? 'py' : 'java'}`);
            res.send(result);
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/recorder/save-to-studio — convert recorded script to Playwright TS and save to Dev Studio filesystem
recorderRoutes.post('/save-to-studio', async (req, res) => {
    try {
        const { scriptId, projectId, parentId, userId } = req.body;
        const uid = userId || (req as any).user?.uid;

        // Get script
        const scripts = await recorderService.getScripts(projectId, uid);
        const script = scripts.find((s: any) => s.id === scriptId);
        if (!script) return res.status(404).json({ error: 'Script not found' });

        // Generate Playwright TS
        const content = recorderService.generatePlaywrightTs(script);

        // Save to Dev Studio filesystem via fileSystemService
        const { fileSystemService } = await import('../../services/persistence/FileSystemService');
        const fileName = `${script.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.spec.ts`;

        // Check if file already exists
        const exists = await fileSystemService.checkExists(projectId, parentId || null, fileName);
        if (exists) {
            return res.status(409).json({ error: `File "${fileName}" already exists in Dev Studio.` });
        }

        const node = await fileSystemService.createNode({
            projectId,
            userId: uid || 'system',
            parentId: parentId || null,
            name: fileName,
            type: 'file',
            language: 'typescript'
        });

        await fileSystemService.updateContent(node.id, content, uid || 'system');

        res.json({ success: true, fileId: node.id, fileName });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

