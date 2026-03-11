import { db } from '../../firebase';
import { Timestamp } from 'firebase-admin/firestore';

// ── Types ─────────────────────────────────────────────────────────────────

export interface ScriptStep {
    id: string;
    action: 'tap' | 'doubleTap' | 'longPress' | 'swipe' | 'type' | 'back' | 'home' | 'wait' | 'assertVisible' | 'assertText' | 'scroll';
    // Tap / gesture coords
    x?: number;
    y?: number;
    startX?: number;
    startY?: number;
    endX?: number;
    endY?: number;
    // Input
    value?: string;
    // Element locator (from inspector or auto-detection)
    locator?: string;
    locatorStrategy?: string;
    elementLabel?: string;
    // Assertion
    assertion?: { type: string; expected: string; contains?: boolean };
    // Meta
    description?: string;
    waitBefore?: number;
    screenshotAfter?: boolean;
    timestamp: number;
}

export interface MobileScript {
    id: string;
    name: string;
    description?: string;
    tags?: string[];
    platform: 'android' | 'ios';
    deviceId?: string;
    appPackage?: string;
    appActivity?: string;
    steps: ScriptStep[];
    stepCount: number;
    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;
    createdBy?: string;
    lastRunAt?: Timestamp | Date | null;
    lastRunStatus?: 'passed' | 'failed' | null;
}

const COLLECTION = 'mobile_scripts';

// ── CRUD ──────────────────────────────────────────────────────────────────

export async function listScripts(userId?: string): Promise<MobileScript[]> {
    const ref = db.collection(COLLECTION);
    const snap = await ref.orderBy('updatedAt', 'desc').limit(100).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as MobileScript));
}

export async function getScript(id: string): Promise<MobileScript | null> {
    const doc = await db.collection(COLLECTION).doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as MobileScript;
}

export async function createScript(data: Omit<MobileScript, 'id' | 'createdAt' | 'updatedAt'>): Promise<MobileScript> {
    const now = Timestamp.now();
    const ref = db.collection(COLLECTION).doc();
    const script: Omit<MobileScript, 'id'> = {
        ...data,
        stepCount: data.steps.length,
        lastRunAt: null,
        lastRunStatus: null,
        createdAt: now,
        updatedAt: now,
    };
    await ref.set(script);
    return { id: ref.id, ...script };
}

export async function updateScript(id: string, data: Partial<MobileScript>): Promise<MobileScript | null> {
    const ref = db.collection(COLLECTION).doc(id);
    const doc = await ref.get();
    if (!doc.exists) return null;
    const updates = {
        ...data,
        stepCount: data.steps?.length ?? doc.data()?.stepCount,
        updatedAt: Timestamp.now(),
    };
    await ref.update(updates);
    return { id, ...doc.data(), ...updates } as MobileScript;
}

export async function deleteScript(id: string): Promise<boolean> {
    const doc = await db.collection(COLLECTION).doc(id).get();
    if (!doc.exists) return false;
    await db.collection(COLLECTION).doc(id).delete();
    return true;
}
