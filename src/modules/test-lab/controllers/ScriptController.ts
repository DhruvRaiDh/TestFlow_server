// Controller: ScriptController
import { Request, Response } from 'express';
import { scriptService } from '../services/ScriptService';
import { testLabStorage } from '../storage/TestLabStorage';

export class ScriptController {
    async list(req: Request, res: Response) {
        try {
            const { projectId } = req.params;
            const scripts = await scriptService.list(projectId);
            res.json(scripts);
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }

    async get(req: Request, res: Response) {
        try {
            const { projectId, scriptId } = req.params;
            const script = await scriptService.get(projectId, scriptId);
            if (!script) return res.status(404).json({ error: 'Script not found' });
            res.json(script);
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }

    async create(req: Request, res: Response) {
        try {
            const { projectId } = req.params;
            const { name, language, source, content, steps, description, tags } = req.body;
            if (!name || !content) return res.status(400).json({ error: 'name and content required' });
            const script = await scriptService.create(projectId, {
                projectId, name, language: language || 'typescript',
                source: source || 'manual', content, steps, description, tags,
            });
            res.status(201).json(script);
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }

    async update(req: Request, res: Response) {
        try {
            const { projectId, scriptId } = req.params;
            const updated = await scriptService.update(projectId, scriptId, req.body);
            if (!updated) return res.status(404).json({ error: 'Script not found' });
            res.json(updated);
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }

    async delete(req: Request, res: Response) {
        try {
            const { projectId, scriptId } = req.params;
            const ok = await scriptService.delete(projectId, scriptId);
            if (!ok) return res.status(404).json({ error: 'Script not found' });
            res.json({ status: 'deleted' });
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }

    async generateTs(req: Request, res: Response) {
        try {
            const { name, steps } = req.body;
            if (!name || !steps) return res.status(400).json({ error: 'name and steps required' });
            const code = scriptService.generatePlaywrightTs(name, steps);
            res.json({ code });
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
}

export const scriptController = new ScriptController();
