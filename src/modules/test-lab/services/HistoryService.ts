// Service: HistoryService
// Manages run records and log streaming for Test Lab

import { testLabStorage } from '../storage/TestLabStorage';
import { RunRecord, CreateRunDto, RunLog, ScriptResult, RunStatus } from '../models/RunRecord';

export class HistoryService {

    async list(projectId: string, limit?: number): Promise<RunRecord[]> {
        return testLabStorage.listRunRecords(projectId, limit);
    }

    async get(projectId: string, runId: string): Promise<RunRecord | null> {
        return testLabStorage.getRunRecord(projectId, runId);
    }

    async create(projectId: string, dto: CreateRunDto): Promise<RunRecord> {
        return testLabStorage.createRunRecord(projectId, dto);
    }

    async setStatus(projectId: string, runId: string, status: RunStatus, endTime?: string): Promise<void> {
        const updates: Partial<RunRecord> = { status };
        if (endTime) {
            updates.endTime = endTime;
            const record = await testLabStorage.getRunRecord(projectId, runId);
            if (record) {
                updates.durationMs = new Date(endTime).getTime() - new Date(record.startTime).getTime();
            }
        }
        await testLabStorage.updateRunRecord(projectId, runId, updates);
    }

    async appendLog(projectId: string, runId: string, message: string, level: RunLog['level'] = 'info'): Promise<void> {
        const log: RunLog = {
            timestamp: new Date().toISOString(),
            level,
            message: message.trimEnd(),
        };
        await testLabStorage.appendRunLog(projectId, runId, log);
    }

    async appendResult(projectId: string, runId: string, result: ScriptResult): Promise<void> {
        await testLabStorage.appendRunResult(projectId, runId, result);
    }

    async delete(projectId: string, runId: string): Promise<boolean> {
        return testLabStorage.deleteRunRecord(projectId, runId);
    }
}

export const historyService = new HistoryService();
