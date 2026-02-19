/**
 * Logger Utility
 * 
 * Purpose: Replace console.log with environment-aware logging
 * Benefits:
 * - Production-safe (no debug logs in production)
 * - Consistent log format
 * - Easy to extend (can add file logging, external services later)
 * - Type-safe
 * 
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.debug('Debug message', { data: 'value' });
 *   logger.info('Info message');
 *   logger.warn('Warning message', error, { context: 'value' });
 *   logger.error('Error message', error, { context: 'value' });
 */

import fs from 'fs';
import path from 'path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogMeta = Record<string, unknown>;

class Logger {
    private isDevelopment = process.env.NODE_ENV === 'development';
    private logDir = path.join(process.cwd(), 'logs');
    private logFile = path.join(this.logDir, 'backend.log');

    constructor() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
        this.checkRotation();
    }

    private checkRotation() {
        try {
            if (fs.existsSync(this.logFile)) {
                const stats = fs.statSync(this.logFile);
                if (stats.size > 5 * 1024 * 1024) { // 5MB limit
                    fs.writeFileSync(this.logFile, ''); // Clear log
                    this.info('[Logger] Log rotated due to size limit');
                }
            }
        } catch (e) {
            console.error('[Logger] Rotation check failed', e);
        }
    }

    private writeToFile(level: LogLevel, message: string, meta?: LogMeta) {
        try {
            const timestamp = new Date().toISOString();
            const logEntry = JSON.stringify({ timestamp, level, message, meta }) + '\n';
            fs.appendFileSync(this.logFile, logEntry);
        } catch (e) {
            // Silently fail to console if file writing fails to prevent crash
            console.error('[Logger] Failed to write to file', e);
        }
    }

    /**
     * Debug logs - only shown in development
     * Use for: Detailed debugging information
     */
    debug(message: string, meta?: LogMeta): void {
        if (this.isDevelopment) {
            console.log(`[DEBUG] ${message}`, meta || '');
        }
        this.writeToFile('debug', message, meta);
    }

    /**
     * Info logs - shown in all environments
     * Use for: General information, successful operations
     */
    info(message: string, meta?: LogMeta): void {
        console.log(`[INFO] ${message}`, meta || '');
        this.writeToFile('info', message, meta);
    }

    /**
     * Warning logs - shown in all environments
     * Use for: Potential issues, deprecated features
     */
    warn(message: string, error?: Error | unknown, meta?: LogMeta): void {
        const errorMeta = error instanceof Error ? { error: error.message, stack: error.stack, ...meta } : { error, ...meta };
        console.warn(`[WARN] ${message}`, errorMeta);
        this.writeToFile('warn', message, errorMeta as LogMeta);
    }

    /**
     * Error logs - shown in all environments
     * Use for: Errors, exceptions, failures
     */
    error(message: string, error?: Error | unknown, meta?: LogMeta): void {
        const errorMeta = error instanceof Error ? { error: error.message, stack: error.stack, ...meta } : { error, ...meta };
        console.error(`[ERROR] ${message}`, errorMeta);
        this.writeToFile('error', message, errorMeta as LogMeta);
    }

    /**
     * Log with custom level
     */
    log(level: LogLevel, message: string, meta?: LogMeta): void {
        this[level](message, meta);
    }
}

export const logger = new Logger();
