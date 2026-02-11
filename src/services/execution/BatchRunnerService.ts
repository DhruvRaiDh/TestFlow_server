import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { localProjectService } from '../persistence/LocalProjectService';

export interface BatchRunResult {
    runId: string;
    status: 'started' | 'failed';
    message?: string;
}

import { codeExecutorService } from './CodeExecutorService';
import { testRunService } from '../persistence/TestRunService';

export class BatchRunnerService {

    // Resolve IDs to Absolute Paths
    private async resolvePaths(projectId: string, fileIds: string[]): Promise<string[]> {
        const nodes = await localProjectService.getFSNodes(projectId);
        const resolvedPaths: string[] = [];
        const nodeMap = new Map(nodes.map(n => [n.id, n]));

        for (const id of fileIds) {
            let currentNode = nodeMap.get(id);
            if (!currentNode) continue;

            // If folder, we might want to include all children? 
            // For Phase 1 of Batch Runner, let's assume UI filters for files only or strict paths.
            // But if user checks a folder, UI likely sends folder ID.
            // If folder, we should pass the folder path to Playwright (it handles recursion).

            const parts = [currentNode.name];
            let parentId = currentNode.parent_id;

            while (parentId) {
                const parent = nodeMap.get(parentId);
                if (!parent) break;
                parts.unshift(parent.name);
                parentId = parent.parent_id; // Recursive
            }

            // Base path for project? 
            // We need to know where the project root is physically.
            // LocalProjectService stores data in `backend/data`.
            // BUT for executing tests, we expect them to be in a runnable environment.
            // Wait, our "Dual Write" saves content to `backend/data/project-ID-data.json`.
            // It DOES NOT save individual .spec.ts files to disk in a hierarchical structure!

            // CRITICAL REALIZATION:
            // The "FSNodes" are virtual in the DB/JSON. They are NOT physical files on disk.
            // To run them with `npx playwright test`, we MUST Dump them to a temp directory first.

            resolvedPaths.push(parts.join('/')); // Relative path virtual
        }
        return resolvedPaths;
    }

    async executeBatch(projectId: string, fileIds: string[], config?: any): Promise<BatchRunResult> {
        // 1. Create Run Record
        const runId = await testRunService.createRun(projectId, fileIds);

        const log = (msg: string) => {
            console.log(msg);
            // Fire & Forget log update to avoid blocking execution
            testRunService.appendLog(runId, projectId, msg).catch(e => console.error(e));
        };

        log(`[BatchRunner] Starting Run ${runId} with config: ${JSON.stringify(config)}`);

        // Use a temp dir inside backend root to ensure node_modules resolution works
        const tempBasePath = path.join(process.cwd(), 'temp_batch_runs', runId);

        try {
            // 2. Fetch all nodes
            const nodes = await localProjectService.getFSNodes(projectId);
            const nodeMap = new Map(nodes.map(n => [n.id, n]));

            // 3. Dump Files to Disk
            if (nodes.length === 0) {
                await testRunService.updateRun(runId, projectId, { status: 'failed', endTime: new Date().toISOString() });
                return { runId, status: 'failed', message: 'No files in project' };
            }

            // Create base dir
            await fs.promises.mkdir(tempBasePath, { recursive: true });

            // Helper to build path
            const getPath = (node: any): string => {
                const parts = [node.name];
                let parentId = node.parent_id;
                while (parentId) {
                    const parent = nodeMap.get(parentId);
                    if (!parent) break;
                    parts.unshift(parent.name);
                    parentId = parent.parent_id;
                }
                return path.join(tempBasePath, ...parts);
            };

            for (const node of nodes) {
                const fullPath = getPath(node);
                if (node.type === 'folder') {
                    await fs.promises.mkdir(fullPath, { recursive: true });
                } else {
                    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
                    await fs.promises.writeFile(fullPath, node.content || '');
                }
            }

            // 4. Resolve Target Paths & Detect Type
            const playwrightFiles: string[] = [];
            const javaFiles: { path: string, content: string }[] = [];
            const pythonFiles: { path: string, content: string }[] = [];

            for (const id of fileIds) {
                const node = nodeMap.get(id);
                if (node && node.type === 'file') {
                    const absPath = getPath(node);
                    if (node.name.endsWith('.java')) {
                        javaFiles.push({ path: absPath, content: node.content || '' });
                    } else if (node.name.endsWith('.py')) {
                        pythonFiles.push({ path: absPath, content: node.content || '' });
                    } else if (node.name.endsWith('.ts') || node.name.endsWith('.js')) {
                        playwrightFiles.push(absPath);
                    }
                }
            }

            if (javaFiles.length === 0 && pythonFiles.length === 0 && playwrightFiles.length === 0) {
                await testRunService.updateRun(runId, projectId, { status: 'failed', endTime: new Date().toISOString() });
                return { runId, status: 'failed', message: 'No valid test files selected' };
            }

            log(`[BatchRunner] Breakdown: ${javaFiles.length} Java, ${pythonFiles.length} Python, ${playwrightFiles.length} Playwright`);

            // 5. Execution Logic
            const customResults: any[] = [];

            const runJava = async () => {
                if (javaFiles.length === 0) return;
                log(`[BatchRunner] Executing ${javaFiles.length} Java files...`);
                await Promise.all(javaFiles.map(async (f) => {
                    try {
                        log(`Executing Java: ${path.basename(f.path)}`);

                        // ✅ Enable real-time log streaming
                        const result = await codeExecutorService.executeCode(f.content, 'java', {
                            runId,
                            projectId,
                            streamLogs: true
                        });

                        customResults.push({
                            file: path.basename(f.path),
                            status: result.exitCode === 0 ? 'passed' : 'failed',
                            logs: result.logs
                        });
                        log(`Finished Java: ${path.basename(f.path)} (${result.exitCode === 0 ? 'PASS' : 'FAIL'})`);
                    } catch (e: any) {
                        console.error(e);
                        customResults.push({ file: path.basename(f.path), status: 'failed', error: e.message });
                    }
                }));
            };

            const runPython = async () => {
                if (pythonFiles.length === 0) return;
                log(`[BatchRunner] Executing ${pythonFiles.length} Python files...`);
                await Promise.all(pythonFiles.map(async (f) => {
                    try {
                        log(`Executing Python: ${path.basename(f.path)}`);

                        // ✅ Enable real-time log streaming
                        const result = await codeExecutorService.executeCode(f.content, 'python', {
                            runId,
                            projectId,
                            streamLogs: true
                        });

                        customResults.push({
                            file: path.basename(f.path),
                            status: result.exitCode === 0 ? 'passed' : 'failed',
                            logs: result.logs
                        });
                        log(`Finished Python: ${path.basename(f.path)} (${result.exitCode === 0 ? 'PASS' : 'FAIL'})`);
                    } catch (e: any) {
                        console.error(e);
                        customResults.push({ file: path.basename(f.path), status: 'failed', error: e.message });
                    }
                }));
            };

            // Trigger execution in background (Fire-and-forget from API perspective, but managed here)
            // Ideally executeBatch should return immediately? Yes, user gets RunID.
            (async () => {
                try {
                    await Promise.all([runJava(), runPython()]); // Wait for non-playwright

                    // Handle Playwright
                    if (playwrightFiles.length > 0) {
                        log(`[BatchRunner] Triggering Playwright for ${playwrightFiles.length} files...`);
                        const reportFile = path.join(tempBasePath, 'report.json');

                        // Construct Command based on Config
                        // Config: { environment: 'local'|'staging'|'prod', browser: 'chrome'|'firefox'|'edge', headless: boolean }

                        let browserFlag = '';
                        if (config?.browser) {
                            // Map UI browser names to Playwright Project names or Browser Types
                            // Provided UI: chrome, firefox, edge
                            // Playwright Standard Projects: chromium, firefox, webkit, Mobile Chrome, etc.
                            // If user is running generic, we can map:
                            const browserMap: Record<string, string> = {
                                'chrome': 'chromium',
                                'firefox': 'firefox',
                                'edge': 'webkit' // Fallback or if they have 'Microsoft Edge' project? 
                                // Actually 'msedge' is a channel, not a project usually unless defined.
                                // Safer: 'chromium' unless we know 'edge' is installed.
                                // Let's try --browser if no config, but --project is standard.
                                // If we don't know the config, let's just assume defaults map loosely to browserType.
                            };
                            const project = browserMap[config.browser] || 'chromium';
                            // browserFlag = `--project=${project}`; 
                            // WARNING: --project only works if configured in playwright.config.ts!
                            // If no config, it fails.
                            // Default behavior: just run.
                            // To force browser without config: --browser=chromium
                            browserFlag = `--browser=${project}`;
                        }

                        const headlessFlag = config?.headless ? '' : '--headed';

                        // Environment Variables
                        const envVars = {
                            ...process.env,
                            CI: 'true',
                            PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
                            TEST_ENV: config?.environment || 'local', // Pass as generic TEST_ENV
                            BASE_URL: config?.environment === 'prod' ? 'https://production.com' : 'http://localhost:3000' // Example mapping, user scripts usually handle this
                        };

                        const command = `npx playwright test ${playwrightFiles.map(p => `"${p}"`).join(' ')} ${headlessFlag} ${browserFlag} --reporter=json`;

                        log(`[BatchRunner] Command: ${command} | Env: ${config?.environment}`);

                        const child = spawn(command, [], { shell: true, env: envVars });

                        // ✅ CRITICAL FIX: Capture stdout (normal test output)
                        child.stdout?.on('data', (data) => {
                            const output = data.toString();
                            log(output); // This calls testRunService.appendLog() which saves to DB
                        });

                        // ✅ CRITICAL FIX: Capture stderr (errors and warnings)
                        child.stderr?.on('data', (data) => {
                            const error = data.toString();
                            log(`[ERROR] ${error}`); // Save errors to DB as well
                        });

                        // ✅ Handle process errors
                        child.on('error', (error) => {
                            log(`[PROCESS ERROR] ${error.message}`);
                        });

                        child.on('close', async (code) => {
                            log(`[BatchRunner] Playwright finished with code ${code}`);
                            // Once EVERYTHING is done:
                            await testRunService.updateRun(runId, projectId, {
                                status: code === 0 ? 'completed' : 'failed', // ✅ Set status based on exit code
                                endTime: new Date().toISOString(),
                                results: customResults // Note: Missing Playwright results in this array, but good for Java/Python
                            });
                        });
                    } else {
                        // Done
                        await testRunService.updateRun(runId, projectId, {
                            status: 'completed',
                            endTime: new Date().toISOString(),
                            results: customResults
                        });
                    }

                } catch (err: any) {
                    log(`[BatchRunner] Critical Error: ${err.message}`);
                    await testRunService.updateRun(runId, projectId, { status: 'failed', endTime: new Date().toISOString() });
                }
            })();

            return { runId, status: 'started', message: 'Batch execution started.' };

        } catch (error: any) {
            console.error('[BatchRunner] Error:', error);
            await testRunService.updateRun(runId, projectId, { status: 'failed', endTime: new Date().toISOString() });
            return { runId, status: 'failed', message: error.message };
        }
    }
}

export const batchRunnerService = new BatchRunnerService();
