// Service: ScreenshotService
// Manages screenshot files captured during recording and test runs

import * as fs from 'fs/promises';
import * as path from 'path';
import { testLabStorage } from '../storage/TestLabStorage';
import { Screenshot, CreateScreenshotDto } from '../models/Screenshot';

export class ScreenshotService {

    async listBySession(projectId: string, sessionId: string): Promise<Screenshot[]> {
        return testLabStorage.listScreenshots(projectId, sessionId);
    }

    async listAll(projectId: string): Promise<Screenshot[]> {
        return testLabStorage.listScreenshots(projectId);
    }

    async listSessions(projectId: string) {
        return testLabStorage.listSessions(projectId);
    }

    async save(projectId: string, sessionId: string, sessionName: string, stepIndex: number, imageBuffer: Buffer, meta: {
        stepAction?: string;
        stepTarget?: string;
        url?: string;
        trigger?: Screenshot['trigger'];
    }): Promise<Screenshot> {
        const dir = await testLabStorage.ensureScreenshotDir(projectId, sessionId);
        const paddedIndex = String(stepIndex + 1).padStart(3, '0');
        const filename = `step-${paddedIndex}.png`;
        const filepath = path.join(dir, filename);

        await fs.writeFile(filepath, imageBuffer);

        const dto: CreateScreenshotDto = {
            projectId,
            sessionId,
            sessionName,
            stepIndex,
            stepAction: meta.stepAction,
            stepTarget: meta.stepTarget,
            trigger: meta.trigger || 'step',
            filename,
            filepath,
            url: meta.url,
        };

        return testLabStorage.createScreenshot(projectId, dto);
    }

    async deleteSession(projectId: string, sessionId: string): Promise<void> {
        return testLabStorage.deleteScreenshotsBySession(projectId, sessionId);
    }

    async deleteOne(projectId: string, screenshotId: string): Promise<boolean> {
        return testLabStorage.deleteScreenshot(projectId, screenshotId);
    }

    async getFilePath(projectId: string, sessionId: string, filename: string): Promise<string | null> {
        const dir = testLabStorage.getScreenshotDir(projectId, sessionId);
        const fullPath = path.join(dir, filename);
        try {
            await fs.access(fullPath);
            return fullPath;
        } catch {
            return null;
        }
    }
}

export const screenshotService = new ScreenshotService();
