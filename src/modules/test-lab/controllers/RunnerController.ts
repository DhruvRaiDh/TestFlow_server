// Controller: RunnerController
import { Request, Response } from 'express';
import { runnerService } from '../services/RunnerService';

export class RunnerController {
    async runScript(req: Request, res: Response) {
        try {
            const { projectId, scriptId } = req.params;
            const { config } = req.body;
            const runId = await runnerService.runScript(projectId, scriptId, config);
            res.json({ status: 'started', runId });
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }

    async runBatch(req: Request, res: Response) {
        try {
            const { projectId } = req.params;
            const { scriptIds, config } = req.body;
            if (!scriptIds || !Array.isArray(scriptIds) || scriptIds.length === 0) {
                return res.status(400).json({ error: 'scriptIds array required' });
            }
            const runId = await runnerService.runBatch(projectId, scriptIds, config);
            res.json({ status: 'started', runId });
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
}

export const runnerController = new RunnerController();
