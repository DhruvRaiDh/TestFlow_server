import { Router } from 'express';
import { executeScript, cancelRun, listRuns, getRun, type LogEntry } from '../../services/mobile/RunnerService';
import { getScript } from '../../services/mobile/ScriptStorageService';

export const runRoutes = Router();

// Active log streams per runId for SSE
const logListeners = new Map<string, ((log: any) => void)[]>();

// ── List runs ──────────────────────────────────────────────────────────────

runRoutes.get('/runs', async (req, res) => {
    try {
        const { scriptId } = req.query as { scriptId?: string };
        const runs = await listRuns(scriptId);
        res.json({ runs });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ── Get single run ─────────────────────────────────────────────────────────

runRoutes.get('/runs/:runId', async (req, res) => {
    try {
        const run = await getRun(req.params.runId);
        if (!run) return res.status(404).json({ error: 'Run not found' });
        res.json({ run });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ── SSE: live log stream for a run in progress ────────────────────────────

runRoutes.get('/runs/:runId/logs', (req, res) => {
    const { runId } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const listener = (log: any) => {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify(log)}\n\n`);
    };

    if (!logListeners.has(runId)) logListeners.set(runId, []);
    logListeners.get(runId)!.push(listener);

    res.on('close', () => {
        const listeners = logListeners.get(runId) || [];
        const filtered = listeners.filter(l => l !== listener);
        if (filtered.length) logListeners.set(runId, filtered);
        else logListeners.delete(runId);
    });
});

// ── Start a run ────────────────────────────────────────────────────────────

runRoutes.post('/runs', async (req, res) => {
    try {
        const { scriptId, deviceId, screenshotOnFail } = req.body;
        if (!scriptId || !deviceId) return res.status(400).json({ error: 'scriptId and deviceId required' });

        const script = await getScript(scriptId);
        if (!script) return res.status(404).json({ error: 'Script not found' });

        const runId = crypto.randomUUID();

        // Respond immediately — run happens async, logs stream via SSE
        res.status(202).json({ runId, status: 'running' });

        const listeners = logListeners.get(runId) || [];

        // Execute async
        executeScript({
            scriptId,
            steps: script.steps,
            deviceId,
            screenshotOnFail: screenshotOnFail ?? true,
            runId,
            appPackage: script.appPackage,
            appActivity: script.appActivity,
            onLog: (log: LogEntry) => {
                const currentListeners = logListeners.get(runId) || [];
                currentListeners.forEach(l => l(log));
            },
        }).catch((err: Error) => console.error('[RunnerService] Error:', err.message));

    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ── Cancel a run ───────────────────────────────────────────────────────────

runRoutes.post('/runs/:runId/cancel', async (req, res) => {
    try {
        await cancelRun(req.params.runId);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});
