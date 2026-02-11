import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { testRunService } from '../persistence/TestRunService';

export interface ExecutionResult {
    runId: string;
    logs: string[];
    exitCode: number | null;
}

export interface ExecutionOptions {
    runId?: string;
    projectId?: string;
    streamLogs?: boolean;
}

export class CodeExecutorService {
    private tempDir: string;

    constructor() {
        this.tempDir = path.join(process.cwd(), 'temp_execution');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    async executeCode(content: string, language: string, options?: ExecutionOptions): Promise<ExecutionResult> {
        const runId = uuidv4();
        let fileName = `${runId}.txt`;
        let command = '';
        let args: string[] = [];
        let env = { ...process.env };
        let filePath = ''; // Initialize

        console.log(`[CodeExecutor] 🚀 Starting Ad-hoc Execution. RunID: ${runId} Language: ${language}`);

        // 1. Prepare File & Command
        switch (language) {
            case 'typescript':
            case 'javascript':
                fileName = `${runId}.ts`; // We use .ts suffix for tsx compatibility, even for JS content it usually works or we can check
                filePath = path.join(this.tempDir, fileName); // Assign

                // Detection: Is this a Mocha Test?
                if (content.includes('describe(') || content.includes('it(')) {
                    command = 'npx';
                    args = ['mocha', filePath, '--timeout', '60000', '--require', 'tsx']; // Use tsx execution for mocha to handle TS/ESM
                } else {
                    // Standard Script
                    command = 'npx';
                    args = ['tsx', filePath];
                }
                break;

            case 'python':
                fileName = `${runId}.py`;
                filePath = path.join(this.tempDir, fileName); // Assign

                // Check for local venv "python_env" in backend root
                const venvPath = path.join(process.cwd(), 'python_env', 'Scripts', 'python.exe');
                if (fs.existsSync(venvPath)) {
                    command = venvPath;
                } else {
                    command = 'python'; // Fallback to system python
                }
                args = [filePath];
                break;

            case 'java':
                // Advanced Java Support
                // 1. Extract Class Name
                const classMatch = content.match(/public\s+class\s+(\w+)/);
                const className = classMatch ? classMatch[1] : `Main_${runId.replace(/-/g, '')}`;
                fileName = `${className}.java`;
                filePath = path.join(this.tempDir, fileName);

                // 2. Pre-process Content: Strip 'package' declaration
                // (This avoids directory structure requirements for simple runs)
                const processedContent = content.replace(/^\s*package\s+[\w.]+;/m, '// package stripped by runner');

                // 3. Command Setup
                // We assume 'lib/java/*'
                const libs = path.join(process.cwd(), 'lib/java/*');
                const cpSeparator = process.platform === 'win32' ? ';' : ':';
                // CRITICAL FIX: Add this.tempDir to classpath so TestNG can find the compiled class
                const classPath = `"${libs}${cpSeparator}.${cpSeparator}${this.tempDir}"`;

                // 4. Determine Runner (TestNG vs Main)
                const isTestNG = content.includes('@Test');

                command = 'javac';
                if (isTestNG) {
                    // Compile and Run with TestNG
                    command = `javac -cp ${classPath} "${filePath}" && java -cp ${classPath} org.testng.TestNG -testclass ${className}`;
                } else {
                    // Compile and Run Standard Main
                    command = `javac -cp ${classPath} "${filePath}" && java -cp ${classPath} ${className}`;
                }

                // Write the PROCESSED content, not original
                fs.writeFileSync(filePath, processedContent);
                args = []; // Command contains everything (shell mode)

                // Return early since we did manual write
                return new Promise((resolve) => {
                    const logs: string[] = [];
                    // Spawn Process
                    const process = spawn(command, args, {
                        shell: true,
                        env,
                    });

                    process.stdout.on('data', (data) => {
                        const line = data.toString();
                        logs.push(line);

                        // Stream to database in real-time if enabled
                        if (options?.streamLogs && options.runId && options.projectId) {
                            testRunService.appendLog(options.runId, options.projectId, line, 'info')
                                .catch(err => console.error('[CodeExecutor] Failed to append stdout log:', err));
                        }
                    });

                    process.stderr.on('data', (data) => {
                        const line = `[Details] ${data.toString()}`;
                        logs.push(line);

                        // Stream errors to database in real-time
                        if (options?.streamLogs && options.runId && options.projectId) {
                            testRunService.appendLog(options.runId, options.projectId, line, 'error')
                                .catch(err => console.error('[CodeExecutor] Failed to append stderr log:', err));
                        }
                    });

                    process.on('close', (code) => {
                        try {
                            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                            // Cleanup compiled class
                            const classFile = path.join(this.tempDir, `${className}.class`);
                            if (fs.existsSync(classFile)) fs.unlinkSync(classFile);
                        } catch (e) { }
                        resolve({ runId, logs, exitCode: code });
                    });

                    // Timeout safety (120 seconds for automation)
                    const timeoutMs = 120000;
                    const timeoutId = setTimeout(() => {
                        try { process.kill(); logs.push(`\n[System] Execution timed out.`); } catch (e) { }
                        resolve({ runId, logs, exitCode: -1 });
                    }, timeoutMs);
                    process.on('exit', () => clearTimeout(timeoutId));
                });

            default:
                throw new Error(`Unsupported language: ${language}`);
        }

        // 2. Write File
        fs.writeFileSync(filePath, content);

        // 3. Execute
        return new Promise((resolve) => {
            const logs: string[] = [];

            // Spawn Process
            const process = spawn(command, args, {
                shell: true,
                env, // Pass environment (Critical for Browsers!)
            });

            process.stdout.on('data', (data) => {
                const line = data.toString();
                logs.push(line);

                // Stream to database in real-time if enabled
                if (options?.streamLogs && options.runId && options.projectId) {
                    testRunService.appendLog(options.runId, options.projectId, line, 'info')
                        .catch(err => console.error('[CodeExecutor] Failed to append stdout log:', err));
                }
            });

            process.stderr.on('data', (data) => {
                const line = data.toString();
                logs.push(line);

                // Stream errors to database in real-time
                if (options?.streamLogs && options.runId && options.projectId) {
                    testRunService.appendLog(options.runId, options.projectId, line, 'error')
                        .catch(err => console.error('[CodeExecutor] Failed to append stderr log:', err));
                }
            });

            process.on('close', (code) => {
                // Cleanup
                try {
                    // Delay cleanup slightly in case of file locks? No, standard unlink should be fine.
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                } catch (e) {
                    // ignore
                }

                resolve({
                    runId,
                    logs,
                    exitCode: code
                });
                console.log(`[CodeExecutor] ✅ Execution Completed. RunID: ${runId} ExitCode: ${code}`);
            });

            // Timeout safety (120 seconds for automation)
            const timeoutMs = 120000;
            const timeoutId = setTimeout(() => {
                try {
                    process.kill();
                    logs.push(`\n[System] Execution timed out (${timeoutMs / 1000}s limit).`);
                    console.warn(`[CodeExecutor] ⚠️ Execution Timed Out. RunID: ${runId}`);
                } catch (e) {
                    // process might be gone
                }
                resolve({ runId, logs, exitCode: -1 });
            }, timeoutMs);

            // Clear timeout if finished
            process.on('exit', () => clearTimeout(timeoutId));
        });
    }
}

export const codeExecutorService = new CodeExecutorService();
