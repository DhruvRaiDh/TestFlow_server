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

export async function getAppiumStatus(): Promise<{ running: boolean; pid?: number }> {
    // Also verify by trying to connect
    if (appiumRunning && appiumProcess) {
        return { running: true, pid: appiumProcess.pid };
    }
    return { running: false };
}

export async function startAppium(): Promise<{ success: boolean; message: string }> {
    if (appiumRunning) return { success: true, message: 'Appium already running' };

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
                appiumRunning = false;
                resolve({ success: false, message: msg });
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
    if (!appiumProcess) {
        appiumRunning = false;
        return { success: true, message: 'Appium not running' };
    }

    try {
        appiumProcess.kill('SIGTERM');
        // Windows fallback
        if (os.platform() === 'win32') {
            try { await execAsync('taskkill /F /IM node.exe /FI "WINDOWTITLE eq appium"'); } catch { }
        }
    } catch { }

    appiumRunning = false;
    appiumProcess = null;
    return { success: true, message: 'Appium stopped' };
}
