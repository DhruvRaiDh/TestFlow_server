// Model: RunRecord
// Represents a single execution run of one or more scripts

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type RunSource = 'manual' | 'schedule' | 'ide' | 'api';

export interface RunLog {
    timestamp: string;
    level: 'info' | 'warn' | 'error' | 'stdout' | 'stderr';
    message: string;
}

export interface ScriptResult {
    scriptId: string;
    scriptName: string;
    status: 'passed' | 'failed' | 'skipped';
    durationMs: number;
    exitCode: number | null;
    error?: string;
}

export interface RunConfig {
    browser?: 'chromium' | 'firefox' | 'webkit';
    headless?: boolean;
    workers?: number;
    timeout?: number;
    environment?: 'local' | 'staging' | 'production';
    baseUrl?: string;
}

export interface RunRecord {
    id: string;
    projectId: string;
    scriptIds: string[];       // Scripts selected for this run
    scriptNames: string[];     // Cached names for display
    source: RunSource;
    status: RunStatus;
    config?: RunConfig;
    logs: RunLog[];
    results: ScriptResult[];
    startTime: string;
    endTime?: string;
    durationMs?: number;
    passCount: number;
    failCount: number;
    skipCount: number;
}

export type CreateRunDto = Pick<RunRecord, 'projectId' | 'scriptIds' | 'scriptNames' | 'source' | 'config'>;
