// Service: RunnerService (Test Lab)
// Executes a single script or a batch using child_process.
// Writes run records to HistoryService for full history tracking.

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { Server } from 'socket.io';
import { historyService } from './HistoryService';
import { testLabStorage } from '../storage/TestLabStorage';
import { localProjectService } from '../../../services/persistence/LocalProjectService';
import { recorderService } from '../../../services/execution/RecorderService';
import { Script } from '../models/Script';
import { RunConfig } from '../models/RunRecord';

export class RunnerService {
    private io: Server | null = null;

    setSocket(io: Server) {
        this.io = io;
    }

    private emit(runId: string, message: string, level: 'info' | 'error' = 'info') {
        this.io?.emit('test-lab:run:log', { runId, message, level, timestamp: new Date().toISOString() });
    }

    /**
     * Resolve a script from any source:
     * 1. Test Lab internal JSON storage
     * 2. Dev Studio filesystem (fileSystemService)
     * 3. Web Recorder scripts (recorderService)
     */
    private async resolveScript(projectId: string, scriptId: string): Promise<Script | null> {
        // 1. Try Test Lab storage first
        const tlScript = await testLabStorage.getScript(projectId, scriptId);
        if (tlScript) return tlScript;

        // 2. Try Dev Studio filesystem — read local project data directly (no user filter)
        try {
            const nodes = await localProjectService.getFSNodes(projectId);
            const node = nodes.find((n: any) => n.id === scriptId && n.type === 'file');
            if (node) {
                const ext = (node.name as string).split('.').pop() || '';
                const lang: Script['language'] =
                    ext === 'py' ? 'python' :
                        ext === 'java' ? 'java' :
                            'typescript';
                return {
                    id: node.id,
                    projectId,
                    name: node.name,
                    language: lang,
                    content: node.content || '',
                    source: 'devstudio',
                    createdAt: node.created_at || new Date().toISOString(),
                    updatedAt: node.updated_at || node.created_at || new Date().toISOString(),
                } as Script;
            }
        } catch { /* not in local filesystem */ }

        // 3. Try Web Recorder scripts (scan across all projects)
        try {
            const recorded = await recorderService.getScripts(projectId);
            const match = recorded.find((s: any) => s.id === scriptId);
            if (match) {
                const content = recorderService.generatePlaywrightTs({
                    name: match.name,
                    steps: match.steps || []
                });
                return {
                    id: match.id,
                    projectId,
                    name: match.name,
                    language: 'typescript',
                    content,
                    source: 'recorder',
                    createdAt: match.createdAt || new Date().toISOString(),
                    updatedAt: match.createdAt || new Date().toISOString(),
                } as Script;
            }
        } catch { /* no recorder scripts */ }

        return null;
    }

    /**
     * Execute a single script by its ID.
     */
    async runScript(projectId: string, scriptId: string, config?: RunConfig): Promise<string> {
        const script = await this.resolveScript(projectId, scriptId);
        if (!script) throw new Error(`Script ${scriptId} not found in any source`);

        const record = await historyService.create(projectId, {
            projectId,
            scriptIds: [scriptId],
            scriptNames: [script.name],
            source: 'manual',
            config,
        });

        await historyService.setStatus(projectId, record.id, 'running');
        this.emit(record.id, `[Runner] Starting: ${script.name}`);

        // Fire async (non-blocking return)
        this.executeSingle(projectId, record.id, script, config).catch(async (err) => {
            this.emit(record.id, `[Runner] Fatal: ${err.message}`, 'error');
            await historyService.setStatus(projectId, record.id, 'failed', new Date().toISOString());
        });

        return record.id;
    }

    /**
     * Execute multiple scripts as a batch.
     */
    async runBatch(projectId: string, scriptIds: string[], config?: RunConfig): Promise<string> {
        const scripts: Script[] = [];
        for (const id of scriptIds) {
            const s = await this.resolveScript(projectId, id);
            if (s) scripts.push(s);
        }

        if (scripts.length === 0) throw new Error('No valid scripts found in Test Lab, Dev Studio, or Recorder');

        const record = await historyService.create(projectId, {
            projectId,
            scriptIds: scripts.map(s => s.id),
            scriptNames: scripts.map(s => s.name),
            source: 'manual',
            config,
        });

        await historyService.setStatus(projectId, record.id, 'running');
        this.emit(record.id, `[Runner] Batch start: ${scripts.length} scripts`);

        this.executeBatch(projectId, record.id, scripts, config).catch(async (err) => {
            this.emit(record.id, `[Runner] Fatal: ${err.message}`, 'error');
            await historyService.setStatus(projectId, record.id, 'failed', new Date().toISOString());
        });

        return record.id;
    }

    private async executeSingle(projectId: string, runId: string, script: Script, config?: RunConfig): Promise<void> {
        const startMs = Date.now();
        const result = await this.executeScript(script, runId, projectId, config);
        const durationMs = Date.now() - startMs;

        await historyService.appendResult(projectId, runId, {
            scriptId: script.id,
            scriptName: script.name,
            status: result.exitCode === 0 ? 'passed' : 'failed',
            durationMs,
            exitCode: result.exitCode,
        });

        const finalStatus = result.exitCode === 0 ? 'completed' : 'failed';
        await historyService.setStatus(projectId, runId, finalStatus, new Date().toISOString());
        this.emit(runId, `[Runner] Done: ${script.name} — ${finalStatus.toUpperCase()} (${durationMs}ms)`);
    }

    private async executeBatch(projectId: string, runId: string, scripts: Script[], config?: RunConfig): Promise<void> {
        let allPassed = true;

        for (const script of scripts) {
            const startMs = Date.now();
            this.emit(runId, `[Runner] Executing: ${script.name}`);

            const result = await this.executeScript(script, runId, projectId, config);
            const durationMs = Date.now() - startMs;
            const status = result.exitCode === 0 ? 'passed' : 'failed';
            if (status === 'failed') allPassed = false;

            await historyService.appendResult(projectId, runId, {
                scriptId: script.id,
                scriptName: script.name,
                status,
                durationMs,
                exitCode: result.exitCode,
            });

            this.emit(runId, `[Runner] ${script.name}: ${status.toUpperCase()} (${durationMs}ms)`);
        }

        await historyService.setStatus(projectId, runId, allPassed ? 'completed' : 'failed', new Date().toISOString());
        this.emit(runId, `[Runner] Batch finished.`);
    }

    private executeScript(script: Script, runId: string, projectId: string, config?: RunConfig): Promise<{ exitCode: number | null }> {
        return new Promise(async (resolve) => {
            const tempDir = path.join(process.cwd(), 'data', 'test-lab', 'temp-runs', runId);
            if (!fsSync.existsSync(tempDir)) fsSync.mkdirSync(tempDir, { recursive: true });

            let filename = '';
            let command = '';
            let args: string[] = [];

            switch (script.language) {
                case 'typescript':
                case 'javascript':
                    filename = `${script.id}.ts`;
                    command = 'npx';
                    args = ['tsx', path.join(tempDir, filename)];
                    break;
                case 'python':
                    filename = `${script.id}.py`;
                    command = 'python';
                    args = [path.join(tempDir, filename)];
                    break;
                case 'java':
                    filename = `Main_${script.id.replace(/-/g, '')}.java`;
                    command = 'bash';
                    args = ['-c', `javac "${path.join(tempDir, filename)}" && java -cp "${tempDir}" Main_${script.id.replace(/-/g, '')}`];
                    break;
            }

            const filePath = path.join(tempDir, filename);
            await fs.writeFile(filePath, script.content, 'utf-8');

            const env = {
                ...process.env,
                HEADED: config?.headless === false ? 'true' : undefined,
            };

            const child = spawn(command, args, { shell: true, env });

            const log = async (msg: string, level: 'info' | 'error' = 'info') => {
                this.emit(runId, msg, level);
                await historyService.appendLog(projectId, runId, msg, level as any);
            };

            child.stdout?.on('data', (d) => log(d.toString()));
            child.stderr?.on('data', (d) => log(d.toString(), 'error'));
            child.on('error', (e) => log(`Process error: ${e.message}`, 'error'));

            const timeout = setTimeout(() => {
                child.kill();
                log('[Runner] Execution timed out (120s)');
                resolve({ exitCode: -1 });
            }, 120_000);

            child.on('close', async (code) => {
                clearTimeout(timeout);
                // Cleanup temp file
                try { await fs.unlink(filePath); } catch { }
                resolve({ exitCode: code });
            });
        });
    }
}

export const runnerService = new RunnerService();
