// Controller: HistoryController
import { Request, Response } from 'express';
import { historyService } from '../services/HistoryService';

export class HistoryController {
    async list(req: Request, res: Response) {
        try {
            const { projectId } = req.params;
            const limit = req.query.limit ? Number(req.query.limit) : 50;
            const records = await historyService.list(projectId, limit);
            res.json(records);
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }

    async get(req: Request, res: Response) {
        try {
            const { projectId, runId } = req.params;
            const record = await historyService.get(projectId, runId);
            if (!record) return res.status(404).json({ error: 'Run not found' });
            res.json(record);
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }

    async delete(req: Request, res: Response) {
        try {
            const { projectId, runId } = req.params;
            const ok = await historyService.delete(projectId, runId);
            if (!ok) return res.status(404).json({ error: 'Run not found' });
            res.json({ status: 'deleted' });
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
}

export const historyController = new HistoryController();
