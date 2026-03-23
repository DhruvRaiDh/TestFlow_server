import { EventEmitter } from 'events';
import { takeScreenshot, tap, swipe, doubleTap, longPress, pressBack, pressHome, typeText } from './AdbDirectService';
import { findElementForReplay } from './ElementLookupService';
import { getSession } from './AppiumService';
import { adbShell } from './AdbDirectService';
import { db } from '../../firebase';
import { Timestamp } from 'firebase-admin/firestore';
import type { ScriptStep } from './ScriptStorageService';

// ── Types ─────────────────────────────────────────────────────────────────

type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled';

export interface RunStepResult {
    stepId: string;
    stepIndex: number;
    action: string;
    status: 'passed' | 'failed' | 'skipped';
    duration: number;
    error?: string;
    screenshotBase64?: string;
}

export interface RunResult {
    runId: string;
    scriptId: string;
    deviceId: string;
    status: RunStatus;
    startedAt: Date;
    completedAt?: Date;
    duration?: number;
    stepResults: RunStepResult[];
    passCount: number;
    failCount: number;
}

// ── Active runs tracking ───────────────────────────────────────────────────

const activeRuns = new Map<string, { emitter: EventEmitter; cancelled: boolean }>();

// ── Log types ─────────────────────────────────────────────────────────────

export type LogEntry = {
    time: string;
    level: 'INFO' | 'ACTION' | 'PASS' | 'FAIL' | 'ERROR';
    msg: string;
};

// ── Execute a single step ─────────────────────────────────────────────────

async function executeStep(step: ScriptStep, deviceId: string, sessionId?: string): Promise<{ passed: boolean; error?: string }> {
    try {
        switch (step.action) {
            case 'tap': {
                // Try element-based lookup first, fall back to coordinates
                const coords = await findElementForReplay(deviceId, step);
                if (coords) {
                    await tap(deviceId, coords.x, coords.y);
                } else if (step.locator && sessionId) {
                    const session = await getSession(sessionId);
                    if (session) await session.driver.$(step.locator).click();
                } else {
                    throw new Error(`Cannot locate element: no locator or coordinates for tap`);
                }
                break;
            }

            case 'doubleTap': {
                const coords = await findElementForReplay(deviceId, step);
                const x = coords?.x ?? step.x ?? 540;
                const y = coords?.y ?? step.y ?? 960;
                await doubleTap(deviceId, x, y);
                break;
            }

            case 'longPress': {
                const coords = await findElementForReplay(deviceId, step);
                const x = coords?.x ?? step.x ?? 540;
                const y = coords?.y ?? step.y ?? 960;
                await longPress(deviceId, x, y);
                break;
            }

            case 'swipe':
                await swipe(deviceId, step.startX ?? 540, step.startY ?? 1400, step.endX ?? 540, step.endY ?? 400);
                break;

            case 'type':
                await typeText(deviceId, step.value ?? '');
                break;

            case 'back':
                await pressBack(deviceId);
                break;

            case 'home':
                await pressHome(deviceId);
                break;

            case 'wait':
                await new Promise(r => setTimeout(r, parseInt(step.value ?? '1000')));
                break;

            case 'assertVisible':
                if (step.locator && sessionId) {
                    const session = await getSession(sessionId);
                    if (session) {
                        const visible = await session.driver.$(step.locator).isDisplayed();
                        if (!visible) throw new Error(`Element not visible: ${step.locator}`);
                    }
                }
                break;

            case 'assertText':
                if (step.locator && sessionId) {
                    const session = await getSession(sessionId);
                    if (session && step.assertion) {
                        const actual = await session.driver.$(step.locator).getText();
                        const match = step.assertion.contains ? actual.includes(step.assertion.expected) : actual === step.assertion.expected;
                        if (!match) throw new Error(`Text mismatch: expected "${step.assertion.expected}" got "${actual}"`);
                    }
                }
                break;

            default:
                break;
        }
        return { passed: true };
    } catch (err: any) {
        return { passed: false, error: err.message };
    }
}

// ── Main run function ─────────────────────────────────────────────────────

export async function executeScript(opts: {
    scriptId: string;
    steps: ScriptStep[];
    deviceId: string;
    sessionId?: string;
    screenshotOnFail?: boolean;
    onLog?: (log: LogEntry) => void;
    runId: string;
    appPackage?: string;
    appActivity?: string;
}): Promise<RunResult> {
    const { scriptId, steps, deviceId, sessionId, screenshotOnFail = true, onLog, runId, appPackage, appActivity } = opts;

    const emitter = new EventEmitter();
    activeRuns.set(runId, { emitter, cancelled: false });

    const log = (level: LogEntry['level'], msg: string) => {
        const entry: LogEntry = { time: new Date().toTimeString().slice(0, 8), level, msg };
        onLog?.(entry);
    };

    const startedAt = new Date();
    const stepResults: RunStepResult[] = [];
    let passCount = 0;
    let failCount = 0;

    // Save initial run to Firestore
    const runRef = db.collection('mobile_runs').doc(runId);
    await runRef.set({
        id: runId,
        scriptId,
        deviceId,
        status: 'running' as RunStatus,
        startedAt: Timestamp.fromDate(startedAt),
        stepResults: [],
        passCount: 0,
        failCount: 0,
    });

    log('INFO', `▶ Starting run on device: ${deviceId}`);
    log('INFO', `📋 Script has ${steps.length} steps`);

    // ── Launch the target app if package info is available ──
    if (appPackage) {
        try {
            const component = appActivity ? `${appPackage}/${appActivity}` : appPackage;
            const cmd = appActivity
                ? `am start -n ${component}`
                : `monkey -p ${appPackage} -c android.intent.category.LAUNCHER 1`;
            log('INFO', `🚀 Launching app: ${component}`);
            await adbShell(deviceId, cmd);
            // Wait for app to load
            await new Promise(r => setTimeout(r, 3000));
            log('INFO', `✅ App launched, waiting 3s for load...`);
        } catch (err: any) {
            log('ERROR', `⚠ Failed to launch app: ${err.message} — continuing with current screen`);
        }
    } else {
        log('INFO', `⚠ No app package specified — running on current screen`);
    }

    for (let i = 0; i < steps.length; i++) {
        const run = activeRuns.get(runId);
        if (run?.cancelled) {
            log('INFO', '⏹ Run cancelled by user');
            break;
        }

        const step = steps[i];
        const label = step.description || step.elementLabel || `${step.action}(${step.x ?? step.value ?? ''})`;

        if (step.waitBefore) {
            await new Promise(r => setTimeout(r, step.waitBefore));
        }

        log('ACTION', `Step ${i + 1}/${steps.length}: ${step.action} — ${label}`);

        const t0 = Date.now();
        const { passed, error } = await executeStep(step, deviceId, sessionId);
        const duration = Date.now() - t0;

        let screenshotBase64: string | undefined;
        if (!passed && screenshotOnFail) {
            try { screenshotBase64 = (await takeScreenshot(deviceId)).toString('base64'); } catch { }
        }

        const stepResult: RunStepResult = {
            stepId: step.id,
            stepIndex: i,
            action: step.action,
            status: passed ? 'passed' : 'failed',
            duration,
            error,
            screenshotBase64,
        };

        stepResults.push(stepResult);

        if (passed) {
            passCount++;
            log('PASS', `✅ Step ${i + 1} passed (${duration}ms)`);
        } else {
            failCount++;
            log('FAIL', `❌ Step ${i + 1} failed: ${error}`);
        }
    }

    const completedAt = new Date();
    const totalDuration = completedAt.getTime() - startedAt.getTime();
    const finalStatus: RunStatus = failCount === 0 ? 'passed' : 'failed';

    log('INFO', `\n${finalStatus === 'passed' ? '✅' : '❌'} Run complete: ${passCount} passed, ${failCount} failed (${totalDuration}ms)`);

    // Update Firestore
    await runRef.update({
        status: finalStatus,
        completedAt: Timestamp.fromDate(completedAt),
        duration: totalDuration,
        stepResults: stepResults.map(r => ({ ...r, screenshotBase64: undefined })), // don't store screenshots in Firestore
        passCount,
        failCount,
    });

    // Update script last run info
    await db.collection('mobile_scripts').doc(scriptId).update({
        lastRunAt: Timestamp.fromDate(completedAt),
        lastRunStatus: finalStatus,
    }).catch(() => { });

    activeRuns.delete(runId);

    return {
        runId,
        scriptId,
        deviceId,
        status: finalStatus,
        startedAt,
        completedAt,
        duration: totalDuration,
        stepResults,
        passCount,
        failCount,
    };
}

export async function cancelRun(runId: string): Promise<void> {
    const run = activeRuns.get(runId);
    if (run) run.cancelled = true;
}

export async function listRuns(scriptId?: string): Promise<any[]> {
    let query: FirebaseFirestore.Query = db.collection('mobile_runs');
    if (scriptId) query = query.where('scriptId', '==', scriptId);
    const snap = await query.orderBy('startedAt', 'desc').limit(50).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getRun(runId: string): Promise<any | null> {
    const doc = await db.collection('mobile_runs').doc(runId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
}
