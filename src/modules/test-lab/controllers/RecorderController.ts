// Controller: RecorderController
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { testLabRecorderService } from '../services/RecorderService';

export class RecorderController {
    async start(req: Request, res: Response) {
        try {
            const { projectId } = req.params;
            const { url } = req.body;
            if (!url) return res.status(400).json({ error: 'url required' });
            const sessionId = uuidv4();
            const session = await testLabRecorderService.startRecording(projectId, url, sessionId);
            res.json({ status: 'started', sessionId, session });
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }

    async stop(req: Request, res: Response) {
        try {
            const steps = await testLabRecorderService.stopRecording();
            res.json({ status: 'stopped', steps, count: steps.length });
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }

    async save(req: Request, res: Response) {
        try {
            const { projectId } = req.params;
            const { sessionId, scriptName, steps } = req.body;
            if (!sessionId || !scriptName || !steps) {
                return res.status(400).json({ error: 'sessionId, scriptName, and steps required' });
            }
            const script = await testLabRecorderService.saveRecording(projectId, sessionId, scriptName, steps);
            res.status(201).json(script);
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }

    async status(req: Request, res: Response) {
        try {
            res.json(testLabRecorderService.getStatus());
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
}

export const recorderController = new RecorderController();
