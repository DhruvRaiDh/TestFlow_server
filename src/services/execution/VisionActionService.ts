import { EventEmitter } from 'events';
import { VisionEvent } from './VisionRecorderService';
import { logger } from '../../lib/logger';

export interface LogicalStep {
    type: 'CLICK' | 'SWIPE' | 'LONG_PRESS';
    x: number;
    y: number;
    endX?: number;
    endY?: number;
    duration?: number;
    timestamp: number;
}

export class VisionActionService extends EventEmitter {
    private activeGestures: Map<string, VisionEvent[]> = new Map();

    processEvent(serial: string, event: VisionEvent) {
        if (!this.activeGestures.has(serial)) {
            this.activeGestures.set(serial, []);
        }

        const gesture = this.activeGestures.get(serial)!;
        gesture.push(event);

        if (event.type === 'touchend') {
            this.finalizeGesture(serial, gesture);
            this.activeGestures.set(serial, []);
        }
    }

    private finalizeGesture(serial: string, events: VisionEvent[]) {
        if (events.length === 0) return;

        const start = events[0];
        const end = events[events.length - 1];
        const duration = end.timestamp - start.timestamp;

        // 1. Calculate travel distance
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // 2. Logic for recognition
        if (distance < 30) {
            if (duration > 500) {
                this.emitAction(serial, {
                    type: 'LONG_PRESS',
                    x: Math.round(start.x),
                    y: Math.round(start.y),
                    duration,
                    timestamp: start.timestamp
                });
            } else {
                this.emitAction(serial, {
                    type: 'CLICK',
                    x: Math.round(start.x),
                    y: Math.round(start.y),
                    timestamp: start.timestamp
                });
            }
        } else {
            this.emitAction(serial, {
                type: 'SWIPE',
                x: Math.round(start.x),
                y: Math.round(start.y),
                endX: Math.round(end.x),
                endY: Math.round(end.y),
                duration,
                timestamp: start.timestamp
            });
        }
    }

    private emitAction(serial: string, step: LogicalStep) {
        logger.info(`[VisionAction] Recognized ${step.type} at (${step.x}, ${step.y}) for ${serial}`);
        this.emit('action', { serial, step });
    }
}

export const visionActionService = new VisionActionService();
