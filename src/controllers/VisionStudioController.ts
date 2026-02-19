import { Request, Response } from 'express';
import { visionStudioService } from '../services/execution/VisionStudioService';
import fs from 'fs';
import path from 'path';

export class VisionStudioController {
    /**
     * GET /api/vision-studio/avds
     */
    async getAVDs(req: Request, res: Response) {
        try {
            const avds = await visionStudioService.listAVDs();
            res.json(avds);
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to fetch AVDs', details: error.message });
        }
    }

    /**
     * POST /api/vision-studio/launch
     */
    async launchAVD(req: Request, res: Response) {
        try {
            const { name } = req.body;
            if (!name) return res.status(400).json({ error: 'Missing AVD name' });

            await visionStudioService.launchAVD(name);
            res.json({ message: `AVD ${name} launch initiated` });
        } catch (error: any) {
            res.status(500).json({ error: 'Launch failed', details: error.message });
        }
    }

    /**
     * GET /api/vision-studio/logs
     */
    async getLogs(req: Request, res: Response) {
        try {
            const logPath = path.join(process.cwd(), 'logs', 'backend.log');

            if (!fs.existsSync(logPath)) {
                return res.json([]);
            }

            // Using a stream or tail-like approach would be better, but for now 
            // we'll read a limited buffer from the end to prevent memory overflow
            const stats = fs.statSync(logPath);
            const fileSize = stats.size;
            const bufferSize = Math.min(fileSize, 50000); // Max 50KB

            const fd = fs.openSync(logPath, 'r');
            const buffer = Buffer.alloc(bufferSize);
            fs.readSync(fd, buffer, 0, bufferSize, fileSize - bufferSize);
            fs.closeSync(fd);

            const content = buffer.toString('utf8');
            const logs = content.split('\n').filter(Boolean).slice(-50);

            res.json(logs.map((l: string) => {
                try {
                    return JSON.parse(l);
                } catch (e) {
                    return { timestamp: new Date().toISOString(), level: 'info', message: l };
                }
            }));
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to fetch logs', details: error.message });
        }
    }
}

export const visionStudioController = new VisionStudioController();
