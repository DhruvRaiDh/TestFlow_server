// Controller: ScreenshotController
import { Request, Response } from 'express';
import { screenshotService } from '../services/ScreenshotService';

export class ScreenshotController {
    async listSessions(req: Request, res: Response) {
        try {
            const { projectId } = req.params;
            const sessions = await screenshotService.listSessions(projectId);
            res.json(sessions);
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }

    async listBySession(req: Request, res: Response) {
        try {
            const { projectId, sessionId } = req.params;
            const shots = await screenshotService.listBySession(projectId, sessionId);
            res.json(shots);
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }

    async listAll(req: Request, res: Response) {
        try {
            const { projectId } = req.params;
            const shots = await screenshotService.listAll(projectId);
            res.json(shots);
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }

    async serveFile(req: Request, res: Response) {
        try {
            const { projectId, sessionId, filename } = req.params;
            const filepath = await screenshotService.getFilePath(projectId, sessionId, filename);
            if (!filepath) return res.status(404).json({ error: 'Screenshot not found' });
            res.sendFile(filepath);
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }

    async deleteSession(req: Request, res: Response) {
        try {
            const { projectId, sessionId } = req.params;
            await screenshotService.deleteSession(projectId, sessionId);
            res.json({ status: 'deleted' });
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }

    async deleteOne(req: Request, res: Response) {
        try {
            const { projectId, screenshotId } = req.params;
            const ok = await screenshotService.deleteOne(projectId, screenshotId);
            if (!ok) return res.status(404).json({ error: 'Screenshot not found' });
            res.json({ status: 'deleted' });
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
}

export const screenshotController = new ScreenshotController();
