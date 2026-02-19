import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { logger } from '../../lib/logger';

export interface VisionEvent {
    type: 'touchstart' | 'touchmove' | 'touchend';
    x: number;
    y: number;
    timestamp: number;
    raw?: string;
}

export class VisionRecorderService extends EventEmitter {
    private activeProcesses: Map<string, ChildProcess> = new Map();
    private deviceResolutions: Map<string, { width: number, height: number }> = new Map();
    private deviceRanges: Map<string, { xMax: number, yMax: number }> = new Map();

    /**
     * Start listening to raw ADB events for a specific device serial
     */
    async startRecording(serial: string) {
        if (this.activeProcesses.has(serial)) {
            this.stopRecording(serial);
        }

        logger.info(`[VisionRecorder] Probing and starting event hook for ${serial}`);

        // 1. Get resolution and probe for touch device
        await this.updateResolution(serial);
        const eventDevice = await this.probeTouchDevice(serial);

        if (!eventDevice) {
            logger.error(`[VisionRecorder] No touch device with ABS_MT_POSITION_X found for ${serial}`);
            return;
        }

        // 2. Spawn getevent on the specific device
        const process = spawn('adb', ['-s', serial, 'shell', 'getevent', '-lt', eventDevice]);
        this.activeProcesses.set(serial, process);

        process.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            for (const line of lines) {
                this.parseLine(serial, line, (event) => {
                    this.emit('event', { serial, ...event });
                });
            }
        });

        process.on('close', () => {
            this.activeProcesses.delete(serial);
            logger.info(`[VisionRecorder] Event hook stopped for ${serial}`);
        });
    }

    stopRecording(serial: string) {
        const process = this.activeProcesses.get(serial);
        if (process) {
            process.kill();
            this.activeProcesses.delete(serial);
        }
    }

    private async probeTouchDevice(serial: string): Promise<string | null> {
        try {
            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execPromise = promisify(exec);

            // Look for the device that has ABS_MT_POSITION_X
            const { stdout } = await execPromise(`adb -s ${serial} shell getevent -p`);
            const sections = stdout.split(/add device \d+: /);

            for (const section of sections) {
                if (section.includes('ABS_MT_POSITION_X')) {
                    const firstLine = section.split('\n')[0].trim();
                    const devicePath = firstLine.endsWith(':') ? firstLine.slice(0, -1) : firstLine;

                    // Extract ranges
                    const xLine = section.match(/ABS_MT_POSITION_X\s+: value \d+, min \d+, max (\d+)/);
                    const yLine = section.match(/ABS_MT_POSITION_Y\s+: value \d+, min \d+, max (\d+)/);

                    if (xLine && yLine) {
                        this.deviceRanges.set(serial, {
                            xMax: parseInt(xLine[1], 10),
                            yMax: parseInt(yLine[1], 10)
                        });
                    }

                    return devicePath;
                }
            }
        } catch (e) {
            logger.error(`[VisionRecorder] Probing failed for ${serial}`, e);
        }
        return null;
    }

    private async updateResolution(serial: string) {
        try {
            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execPromise = promisify(exec);
            const { stdout } = await execPromise(`adb -s ${serial} shell wm size`);
            const match = stdout.match(/Physical size: (\d+)x(\d+)/);
            if (match) {
                this.deviceResolutions.set(serial, {
                    width: parseInt(match[1], 10),
                    height: parseInt(match[2], 10)
                });
            }
        } catch (e) {
            this.deviceResolutions.set(serial, { width: 1080, height: 1920 });
        }
    }

    private parseLine(serial: string, line: string, callback: (event: VisionEvent) => void) {
        const res = this.deviceResolutions.get(serial) || { width: 1080, height: 1920 };
        const range = this.deviceRanges.get(serial) || { xMax: 32767, yMax: 32767 };

        const scale = (val: number, max: number, screen: number) => Math.round((val / max) * screen);

        if (line.includes('BTN_TOUCH')) {
            const type = line.includes('DOWN') ? 'touchstart' : 'touchend';
            callback({
                type,
                x: scale((this as any)[`${serial}_x`] || 0, range.xMax, res.width),
                y: scale((this as any)[`${serial}_y`] || 0, range.yMax, res.height),
                timestamp: Date.now()
            });
            return;
        }

        if (line.includes('ABS_MT_POSITION_X')) {
            const hex = line.split(/\s+/).pop();
            if (hex) (this as any)[`${serial}_x`] = parseInt(hex, 16);
        }

        if (line.includes('ABS_MT_POSITION_Y')) {
            const hex = line.split(/\s+/).pop();
            if (hex) {
                const yVal = parseInt(hex, 16);
                (this as any)[`${serial}_y`] = yVal;

                callback({
                    type: 'touchmove',
                    x: scale((this as any)[`${serial}_x`] || 0, range.xMax, res.width),
                    y: scale(yVal, range.yMax, res.height),
                    timestamp: Date.now()
                });
            }
        }
    }
}

export const visionRecorderService = new VisionRecorderService();
