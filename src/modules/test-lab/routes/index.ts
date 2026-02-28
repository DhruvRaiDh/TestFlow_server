// Routes: Test Lab Module
// All routes mounted at /api/test-lab by backend/src/index.ts
//
// Scripts:      GET/POST   /api/test-lab/projects/:projectId/scripts
//               GET/PUT/DELETE /api/test-lab/projects/:projectId/scripts/:scriptId
//               POST       /api/test-lab/projects/:projectId/scripts/generate-ts
//
// Recorder:     POST       /api/test-lab/projects/:projectId/recorder/start
//               POST       /api/test-lab/projects/:projectId/recorder/stop
//               POST       /api/test-lab/projects/:projectId/recorder/save
//               GET        /api/test-lab/projects/:projectId/recorder/status
//
// Runner:       POST       /api/test-lab/projects/:projectId/runner/scripts/:scriptId/run
//               POST       /api/test-lab/projects/:projectId/runner/batch
//
// History:      GET        /api/test-lab/projects/:projectId/history
//               GET/DELETE /api/test-lab/projects/:projectId/history/:runId
//
// Screenshots:  GET        /api/test-lab/projects/:projectId/screenshots
//               GET        /api/test-lab/projects/:projectId/screenshots/sessions
//               GET        /api/test-lab/projects/:projectId/screenshots/sessions/:sessionId
//               GET        /api/test-lab/projects/:projectId/screenshots/files/:sessionId/:filename (serve image)
//               DELETE     /api/test-lab/projects/:projectId/screenshots/sessions/:sessionId
//               DELETE     /api/test-lab/projects/:projectId/screenshots/:screenshotId

import { Router } from 'express';
import { scriptController } from '../controllers/ScriptController';
import { recorderController } from '../controllers/RecorderController';
import { runnerController } from '../controllers/RunnerController';
import { historyController } from '../controllers/HistoryController';
import { screenshotController } from '../controllers/ScreenshotController';

const router = Router();

// ─── Scripts ────────────────────────────────────────────────────────────────
router.get('/projects/:projectId/scripts', (req, res) => scriptController.list(req, res));
router.post('/projects/:projectId/scripts', (req, res) => scriptController.create(req, res));
router.post('/projects/:projectId/scripts/generate-ts', (req, res) => scriptController.generateTs(req, res));
router.get('/projects/:projectId/scripts/:scriptId', (req, res) => scriptController.get(req, res));
router.put('/projects/:projectId/scripts/:scriptId', (req, res) => scriptController.update(req, res));
router.delete('/projects/:projectId/scripts/:scriptId', (req, res) => scriptController.delete(req, res));

// ─── Recorder ───────────────────────────────────────────────────────────────
router.get('/projects/:projectId/recorder/status', (req, res) => recorderController.status(req, res));
router.post('/projects/:projectId/recorder/start', (req, res) => recorderController.start(req, res));
router.post('/projects/:projectId/recorder/stop', (req, res) => recorderController.stop(req, res));
router.post('/projects/:projectId/recorder/save', (req, res) => recorderController.save(req, res));

// ─── Runner ─────────────────────────────────────────────────────────────────
router.post('/projects/:projectId/runner/scripts/:scriptId/run', (req, res) => runnerController.runScript(req, res));
router.post('/projects/:projectId/runner/batch', (req, res) => runnerController.runBatch(req, res));

// ─── History ────────────────────────────────────────────────────────────────
router.get('/projects/:projectId/history', (req, res) => historyController.list(req, res));
router.get('/projects/:projectId/history/:runId', (req, res) => historyController.get(req, res));
router.delete('/projects/:projectId/history/:runId', (req, res) => historyController.delete(req, res));

// ─── Screenshots ─────────────────────────────────────────────────────────────
router.get('/projects/:projectId/screenshots', (req, res) => screenshotController.listAll(req, res));
router.get('/projects/:projectId/screenshots/sessions', (req, res) => screenshotController.listSessions(req, res));
router.get('/projects/:projectId/screenshots/sessions/:sessionId', (req, res) => screenshotController.listBySession(req, res));
router.get('/projects/:projectId/screenshots/files/:sessionId/:filename', (req, res) => screenshotController.serveFile(req, res));
router.delete('/projects/:projectId/screenshots/sessions/:sessionId', (req, res) => screenshotController.deleteSession(req, res));
router.delete('/projects/:projectId/screenshots/:screenshotId', (req, res) => screenshotController.deleteOne(req, res));

export { router as testLabRouter };
