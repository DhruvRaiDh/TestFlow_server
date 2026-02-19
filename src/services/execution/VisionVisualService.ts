import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { logger } from '../../lib/logger';

export class VisionVisualService extends EventEmitter {
    private activeStreams: Map<string, ChildProcess> = new Map();

    /**
     * Start capturing frames from an ADB device and emits them as base64
     * This is a "Zero-Hook" approach for visual-only mirroring.
     */
    startStreaming(serial: string) {
        if (this.activeStreams.has(serial)) this.stopStreaming(serial);

        logger.info(`[VisionVisual] Starting screen stream for ${serial}`);

        // Using exec-out directly with binary-safe handling
        const process = spawn('adb', ['-s', serial, 'exec-out', 'while true; do screencap -p; done']);
        this.activeStreams.set(serial, process);

        let buffer = Buffer.alloc(0);
        const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

        process.stdout.on('data', (data) => {
            buffer = Buffer.concat([buffer, data]);

            // Simple header-to-header split for PNG frames
            let headerIdx = buffer.indexOf(PNG_HEADER);
            if (headerIdx !== -1) {
                let nextHeaderIdx = buffer.indexOf(PNG_HEADER, headerIdx + 4);
                if (nextHeaderIdx !== -1) {
                    const frame = buffer.slice(headerIdx, nextHeaderIdx);
                    buffer = buffer.slice(nextHeaderIdx);
                    this.emit('frame', { serial, base64: frame.toString('base64') });
                }
            }

            // Cleanup if buffer gets out of hand (5MB safety limit)
            if (buffer.length > 5 * 1024 * 1024) {
                buffer = Buffer.alloc(0);
            }
        });

        process.on('close', () => {
            this.activeStreams.delete(serial);
            logger.info(`[VisionVisual] Stream stopped for ${serial}`);
        });
    }

    stopStreaming(serial: string) {
        const process = this.activeStreams.get(serial);
        if (process) {
            process.kill();
            this.activeStreams.delete(serial);
        }
    }
}

export const visionVisualService = new VisionVisualService();
