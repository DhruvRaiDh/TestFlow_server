import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import fs from 'fs';

const execAsync = promisify(exec);

// ── Android SDK path auto-detection ────────────────────────────────────────

export function resolveAndroidHome(): string {
    // 1. Check env vars first
    const envHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (envHome && fs.existsSync(envHome)) return envHome;

    // 2. Auto-detect from common install locations
    const home = os.homedir();
    const candidates: string[] = os.platform() === 'win32'
        ? [
            path.join(home, 'AppData', 'Local', 'Android', 'Sdk'),
            path.join(home, 'Android', 'Sdk'),
            'C:\\Android\\Sdk',
        ]
        : os.platform() === 'darwin'
            ? [path.join(home, 'Library', 'Android', 'sdk')]
            : [path.join(home, 'Android', 'Sdk'), '/opt/android-sdk'];

    for (const dir of candidates) {
        if (fs.existsSync(dir)) {
            // Cache it for future calls
            process.env.ANDROID_HOME = dir;
            return dir;
        }
    }
    return '';
}

// ── ADB binary path detection ──────────────────────────────────────────────

function getAdbPath(): string {
    const androidHome = resolveAndroidHome();
    if (androidHome) {
        const adb = path.join(androidHome, 'platform-tools', os.platform() === 'win32' ? 'adb.exe' : 'adb');
        return adb;
    }
    return 'adb'; // assume in PATH
}


// ── Core execute helper ────────────────────────────────────────────────────

export async function adbShell(deviceId: string, command: string): Promise<string> {
    const adb = getAdbPath();
    const { stdout } = await execAsync(`"${adb}" -s ${deviceId} shell ${command}`);
    return stdout.trim();
}

export async function adbExec(args: string[]): Promise<string> {
    const adb = getAdbPath();
    const { stdout } = await execAsync(`"${adb}" ${args.join(' ')}`);
    return stdout.trim();
}

// ── Device discovery ───────────────────────────────────────────────────────

export interface AdbDevice {
    id: string;
    status: 'online' | 'offline' | 'unauthorized';
    name: string;
    model: string;
    osVersion: string;
    battery: number;
    resolution: string;
}

export async function listDevices(): Promise<AdbDevice[]> {
    const adb = getAdbPath();
    const { stdout } = await execAsync(`"${adb}" devices -l`);
    const lines = stdout.split('\n').slice(1).filter(l => l.trim() && !l.startsWith('*'));

    const devices: AdbDevice[] = [];
    for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const id = parts[0];
        const rawStatus = parts[1];
        if (!id || !rawStatus) continue;

        let status: AdbDevice['status'] = 'offline';
        if (rawStatus === 'device') status = 'online';
        else if (rawStatus === 'unauthorized') status = 'unauthorized';

        let model = id;
        let osVersion = 'Unknown';
        let battery = 0;
        let resolution = 'Unknown';

        if (status === 'online') {
            try {
                [model, osVersion, battery, resolution] = await Promise.all([
                    adbShell(id, 'getprop ro.product.model').catch(() => id),
                    adbShell(id, 'getprop ro.build.version.release').catch(() => 'Unknown'),
                    adbShell(id, 'dumpsys battery | grep -m1 level').then(s => parseInt(s.replace(/[^0-9]/g, '') || '0')).catch(() => 0),
                    adbShell(id, 'wm size').then(s => s.replace('Physical size:', '').trim()).catch(() => 'Unknown'),
                ]);
            } catch { /* ignore info errors */ }
        }

        const name = status === 'online' ? model : `Device (${id})`;
        devices.push({ id, status, name, model, osVersion, battery, resolution });
    }
    return devices;
}

// ── AVD (Emulator) management ──────────────────────────────────────────────

export interface AvdInfo {
    name: string;
    running: boolean;
}

export async function listAvds(): Promise<AvdInfo[]> {
    const androidHome = resolveAndroidHome();
    const emulatorBin = androidHome
        ? path.join(androidHome, 'emulator', os.platform() === 'win32' ? 'emulator.exe' : 'emulator')
        : 'emulator';

    try {
        const { stdout } = await execAsync(`"${emulatorBin}" -list-avds`);
        const names = stdout.split('\n').map(l => l.trim()).filter(Boolean);

        // Get running emulators
        const { stdout: devOut } = await execAsync(`"${getAdbPath()}" devices`);
        const runningIds = devOut.split('\n').filter(l => l.includes('emulator-')).map(l => l.split('\t')[0].trim());

        return names.map(name => ({ name, running: runningIds.length > 0 }));
    } catch {
        return [];
    }
}

export async function launchAvd(avdName: string): Promise<{ success: boolean; message: string }> {
    const androidHome = resolveAndroidHome();
    const emulatorBin = androidHome
        ? path.join(androidHome, 'emulator', os.platform() === 'win32' ? 'emulator.exe' : 'emulator')
        : 'emulator';

    const env = { ...process.env, ANDROID_HOME: androidHome, ANDROID_SDK_ROOT: androidHome };

    // Spawn detached so it persists after express process
    const child = spawn(`"${emulatorBin}"`, ['-avd', avdName, '-no-snapshot-load'], {
        detached: true,
        stdio: 'ignore',
        shell: true,
        env,
    });
    child.unref();

    return { success: true, message: `Emulator ${avdName} launching in background` };
}

// ── Screen capture (direct ADB — no Appium) ───────────────────────────────

export async function takeScreenshot(deviceId: string): Promise<Buffer> {
    const adb = getAdbPath();
    return new Promise((resolve, reject) => {
        const child = execFile(adb, ['-s', deviceId, 'exec-out', 'screencap', '-p'], {
            maxBuffer: 10 * 1024 * 1024,
            encoding: 'buffer',
        }, (err, stdout) => {
            if (err) return reject(err);
            resolve(stdout as unknown as Buffer);
        });
    });
}

export async function screenshotBase64(deviceId: string): Promise<string> {
    const buf = await takeScreenshot(deviceId);
    return buf.toString('base64');
}

// ── Touch & input (direct ADB — no Appium) ────────────────────────────────

export async function tap(deviceId: string, x: number, y: number): Promise<void> {
    await adbShell(deviceId, `input tap ${x} ${y}`);
}

export async function doubleTap(deviceId: string, x: number, y: number): Promise<void> {
    await adbShell(deviceId, `input tap ${x} ${y}`);
    await new Promise(r => setTimeout(r, 100));
    await adbShell(deviceId, `input tap ${x} ${y}`);
}

export async function longPress(deviceId: string, x: number, y: number, duration = 1000): Promise<void> {
    await adbShell(deviceId, `input swipe ${x} ${y} ${x} ${y} ${duration}`);
}

export async function swipe(deviceId: string, x1: number, y1: number, x2: number, y2: number, duration = 300): Promise<void> {
    await adbShell(deviceId, `input swipe ${x1} ${y1} ${x2} ${y2} ${duration}`);
}

export async function typeText(deviceId: string, text: string): Promise<void> {
    // Escape special characters for ADB shell
    const escaped = text.replace(/([()&|;<>!$`\\"])/g, '\\$1').replace(/ /g, '%s');
    await adbShell(deviceId, `input text "${escaped}"`);
}

export async function pressKey(deviceId: string, keyCode: number): Promise<void> {
    await adbShell(deviceId, `input keyevent ${keyCode}`);
}

export async function pressBack(deviceId: string): Promise<void> {
    await pressKey(deviceId, 4); // KEYCODE_BACK
}

export async function pressHome(deviceId: string): Promise<void> {
    await pressKey(deviceId, 3); // KEYCODE_HOME
}

// ── App management ────────────────────────────────────────────────────────

export async function installApk(deviceId: string, apkPath: string): Promise<{ success: boolean; message: string }> {
    try {
        const adb = getAdbPath();
        const { stdout } = await execAsync(`"${adb}" -s ${deviceId} install -r "${apkPath}"`);
        const success = stdout.includes('Success');
        return { success, message: stdout.trim() };
    } catch (err: any) {
        return { success: false, message: err.message };
    }
}

export async function listInstalledApps(deviceId: string): Promise<string[]> {
    const out = await adbShell(deviceId, 'pm list packages -3');
    return out.split('\n').map(l => l.replace('package:', '').trim()).filter(Boolean);
}

export async function isAppInstalled(deviceId: string, packageName: string): Promise<boolean> {
    const out = await adbShell(deviceId, `pm list packages | grep ${packageName}`);
    return out.includes(packageName);
}

// ── Page source (UI Automator XML) ────────────────────────────────────────

export async function getPageSource(deviceId: string): Promise<string> {
    return adbShell(deviceId, 'uiautomator dump /dev/stdout');
}

// ── Device info helpers ────────────────────────────────────────────────────

export async function getWindowSize(deviceId: string): Promise<{ width: number; height: number }> {
    const out = await adbShell(deviceId, 'wm size');
    const match = out.match(/(\d+)x(\d+)/);
    if (match) return { width: parseInt(match[1]), height: parseInt(match[2]) };
    return { width: 1080, height: 1920 };
}
