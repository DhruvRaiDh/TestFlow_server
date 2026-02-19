import { Request, Response } from 'express';
import { mobileTestService } from '../services/execution/MobileTestService';
import { MobileTestConfig } from '../models/MobileTest';

export class MobileTestController {
    /**
     * GET /api/mobile-tests/devices
     */
    async getDevices(req: Request, res: Response) {
        try {
            const devices = await mobileTestService.getAvailableDevices();
            res.json(devices);
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to fetch devices', details: error.message });
        }
    }

    /**
     * POST /api/mobile-tests/execute
     */
    async execute(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.uid;
            // if (!userId) return res.status(401).json({ error: 'Unauthorized' });

            const config = req.body as MobileTestConfig;
            if (!config.deviceId || !config.platform) {
                return res.status(400).json({ error: 'Missing deviceId or platform' });
            }

            const result = await mobileTestService.executeTest(config);
            res.json(result);
        } catch (error: any) {
            res.status(500).json({ error: 'Mobile test execution failed', details: error.message });
        }
    }
}

export const mobileTestController = new MobileTestController();
