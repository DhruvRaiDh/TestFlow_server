import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { VirtualDevice } from '../../models/VirtualDevice';
import { logger } from '../../lib/logger';

const execPromise = promisify(exec);

export class VisionStudioService {
    private getEmulatorPath(): string {
        const sdkPath = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || 'C:\\Users\\dhruv\\AppData\\Local\\Android\\Sdk';
        const emulatorExe = path.join(sdkPath, 'emulator', 'emulator.exe');
        return emulatorExe;
    }

    private EMULATOR_PATH = this.getEmulatorPath();

    /**
     * List all available AVDs from Android Studio
     */
    async listAVDs(): Promise<VirtualDevice[]> {
        try {
            const { stdout } = await execPromise(`"${this.EMULATOR_PATH}" -list-avds`);
            const names = stdout.split('\n').map(n => n.trim()).filter(Boolean);

            // Check which ones are running via adb
            const runningDevices = await this.getRunningEmulatorPorts();

            return names.map(name => ({
                name,
                status: runningDevices.some(d => d.name === name) ? 'running' : 'offline',
                port: runningDevices.find(d => d.name === name)?.port
            }));
        } catch (error) {
            logger.error('[VisionStudio] Failed to list AVDs', error);
            throw error;
        }
    }

    /**
     * Start an emulator
     */
    async launchAVD(name: string): Promise<void> {
        logger.info(`[VisionStudio] Launching AVD: ${name}`);

        // Use spawn to keep it running in background detached
        const child = spawn(`"${this.EMULATOR_PATH}"`, ['-avd', name], {
            detached: true,
            stdio: 'ignore',
            shell: true
        });

        child.unref();
    }

    private async getRunningEmulatorPorts(): Promise<{ name: string, port: number }[]> {
        try {
            const { stdout } = await execPromise('adb devices');
            const lines = stdout.split('\n').slice(1);
            const emulators: { name: string, port: number }[] = [];

            for (const line of lines) {
                if (line.includes('emulator-')) {
                    const portStr = line.split('\t')[0].split('-')[1];
                    const port = parseInt(portStr, 10);

                    // Get the AVD name for this port
                    const { stdout: nameOut } = await execPromise(`adb -s emulator-${port} emu avd name`);
                    emulators.push({ name: nameOut.trim(), port });
                }
            }
            return emulators;
        } catch (e) {
            return [];
        }
    }
}

export const visionStudioService = new VisionStudioService();
