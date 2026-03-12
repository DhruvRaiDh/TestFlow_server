import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import { listDevices, listAvds, launchAvd, installApk, isAppInstalled, resolveAndroidHome } from './AdbDirectService';

export { listDevices, listAvds, launchAvd, installApk, isAppInstalled };

const execAsync = promisify(exec);

// ── Appium process management ──────────────────────────────────────────────

let appiumProcess: ReturnType<typeof spawn> | null = null;
let appiumRunning = false;

function getAppiumBin(): string {
    const globalNode = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'appium.cmd');
    // Windows: check npm global first, fall back to PATH
    if (os.platform() === 'win32') return globalNode;
    return 'appium';
}

// Check if a port is already in use (detects externally-started Appium)
async function isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const net = require('net');
        const tester = net.createConnection({ port, host: '127.0.0.1' }, () => {
            tester.destroy();
            resolve(true);
        });
        tester.on('error', () => resolve(false));
        tester.setTimeout(1000, () => { tester.destroy(); resolve(false); });
    });
}

export async function getAppiumStatus(): Promise<{ running: boolean; pid?: number }> {
    // First check in-memory process
    if (appiumRunning && appiumProcess) {
        return { running: true, pid: appiumProcess.pid };
    }
    // Also check if port 4723 is in use (Appium started externally or from previous backend session)
    const portBusy = await isPortInUse(4723);
    if (portBusy) {
        appiumRunning = true;
        return { running: true };
    }
    appiumRunning = false;
    return { running: false };
}

export async function startAppium(): Promise<{ success: boolean; message: string }> {
    if (appiumRunning) return { success: true, message: 'Appium already running' };

    // Check if port 4723 is already occupied (externally started Appium)
    const portBusy = await isPortInUse(4723);
    if (portBusy) {
        appiumRunning = true;
        return { success: true, message: 'Appium already running on port 4723 (external)' };
    }

    const androidHome = resolveAndroidHome();
    const env = {
        ...process.env,
        ANDROID_HOME: androidHome,
        ANDROID_SDK_ROOT: androidHome,
        PATH: `${path.join(androidHome, 'platform-tools')}${path.delimiter}${path.join(androidHome, 'tools')}${path.delimiter}${process.env.PATH}`,
    };

    const appiumBin = getAppiumBin();

    return new Promise((resolve) => {
        const proc = spawn(appiumBin, ['server', '--port', '4723', '--relaxed-security', '--log-level', 'error'], {
            env,
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        appiumProcess = proc;

        let settled = false;

        proc.stdout?.on('data', (data: Buffer) => {
            const msg = data.toString();
            if (!settled && msg.includes('4723')) {
                settled = true;
                appiumRunning = true;
                resolve({ success: true, message: 'Appium server started on port 4723' });
            }
        });

        proc.stderr?.on('data', (data: Buffer) => {
            const msg = data.toString();
            if (!settled && msg.toLowerCase().includes('error')) {
                settled = true;
                // If EADDRINUSE, adopt the existing instance
                if (msg.includes('EADDRINUSE')) {
                    appiumRunning = true;
                    appiumProcess = null;
                    resolve({ success: true, message: 'Appium already running on port 4723' });
                } else {
                    appiumRunning = false;
                    resolve({ success: false, message: msg });
                }
            }
        });

        proc.on('close', () => {
            appiumRunning = false;
            appiumProcess = null;
        });

        // Timeout fallback — if no error in 5s, assume success
        setTimeout(() => {
            if (!settled) {
                settled = true;
                appiumRunning = true;
                resolve({ success: true, message: 'Appium server started' });
            }
        }, 5000);
    });
}

export async function stopAppium(): Promise<{ success: boolean; message: string }> {
    // Kill our own spawned process
    if (appiumProcess) {
        try { appiumProcess.kill('SIGTERM'); } catch { }
    }

    // Also kill any Appium on port 4723 (handles externally-started instances)
    if (os.platform() === 'win32') {
        try {
            const { stdout } = await execAsync('netstat -ano | findstr :4723 | findstr LISTENING');
            const pid = stdout.trim().split(/\s+/).pop();
            if (pid && /^\d+$/.test(pid)) {
                await execAsync(`taskkill /F /PID ${pid}`);
            }
        } catch { /* no process on port */ }
    } else {
        try { await execAsync('kill -9 $(lsof -t -i:4723)'); } catch { }
    }

    appiumRunning = false;
    appiumProcess = null;
    return { success: true, message: 'Appium stopped' };
}
