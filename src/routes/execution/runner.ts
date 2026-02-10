
import express from 'express';
import { testRunnerService } from '../../services/execution/TestRunnerService';
import { codeExecutorService } from '../../services/execution/CodeExecutorService';
import { projectService } from '../../services/persistence/ProjectService';
import { batchRunnerService } from '../../services/execution/BatchRunnerService';
import { testRunService } from '../../services/persistence/TestRunService';
// TestRunnerService usually depended on LocalProject, we might need to update it too.
// For now, let's fix the raw execution logging.

const router = express.Router();

// Trigger a Test Run
router.post('/execute', async (req, res) => {
    try {
        const { scriptId, projectId, source } = req.body;

        if (!scriptId || !projectId) {
            return res.status(400).json({ error: 'scriptId and projectId are required' });
        }

        // We run this asynchronously so the HTTP request returns 'started' quickly
        // The client can then poll for status using the runId (optional, or just wait for sockets/refresh)
        // However, for simplicity now, let's await it or return the runId immediately? 
        // Let's await it for this iteration to see results immediately in Postman/Frontend
        const userId = (req as any).user?.uid;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized: User ID missing' });
        }

        const result = await testRunnerService.executeTest(
            scriptId,
            projectId,
            source || 'manual',
            userId
        );

        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Ad-hoc Code Execution (IDE)
router.post('/execute-raw', async (req, res) => {
    try {
        const { content, language } = req.body;
        if (content === undefined || !language) {
            return res.status(400).json({ error: 'content and language are required' });
        }

        const result = await codeExecutorService.executeCode(content, language);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});


// Get Details of a Specific Run
// Route /run/:id removed (Merged into /run/:runId below)

// Delete a Run


// Batch Execution (Test Orchestrator)
router.post('/batch-execute', async (req, res) => {
    try {
        const { projectId, fileIds, config } = req.body;

        if (!projectId || !fileIds || !Array.isArray(fileIds)) {
            return res.status(400).json({ error: 'Missing projectId or fileIds' });
        }

        // 3. Trigger Batch Run (Async)
        // Note: executeBatch is async but we might want to await it if it's "fire and forget"?
        // BatchRunnerService returns { runId, status } immediately-ish.
        const result = await batchRunnerService.executeBatch(projectId, fileIds, config);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Rescan Files (Disk -> DB)
router.post('/scan', async (req, res) => {
    try {
        const { projectId } = req.body;
        // We need userId to save to remote
        // In this route context, we might not have 'req.user' if authMiddleware isn't applied?
        // Wait, runnerRoutes is under /api which IS protected by authMiddleware.
        const userId = (req as any).user?.uid;

        if (!projectId) return res.status(400).json({ error: 'projectId required' });
        if (!userId) return res.status(401).json({ error: 'User not authenticated' });

        // 1. Scan Disk -> Local DB
        const { localProjectService } = await import('../../services/persistence/LocalProjectService');
        const files = await localProjectService.rescanFiles(projectId);

        // 2. Sync Local -> Remote (Firestore)
        // This ensures GET /api/fs (which reads remote) sees the files
        const { projectService } = await import('../../services/persistence/ProjectService');
        const remoteFiles = await projectService.getFSNodes(projectId, userId);

        let syncedCount = 0;
        for (const file of files) {
            // Check existence by Name + Parent + Type (since IDs might differ if re-created)
            // Or just check by ID if we trust Local ID generation to be stable-ish
            // Local rescan generates new UUIDs, so we must check by Name/Path.

            const exists = remoteFiles.find(rf =>
                rf.name === file.name &&
                rf.parent_id === file.parent_id &&
                rf.type === file.type
            );

            if (!exists) {
                // Create in Remote
                await projectService.createFSNode(projectId, {
                    ...file,
                    user_id: userId
                }, userId);
                syncedCount++;
            } else {
                // Optional: Update content if changed?
                // For now, primary goal is visibility.
            }
        }

        console.log(`[Runner] Rescan synced ${syncedCount} missing files to Remote`);

        res.json({ status: 'scanned', count: files.length, synced: syncedCount, files });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});


// --- Run History Routes ---

router.get('/runs/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;
        const source = req.query.source as string | undefined;
        const runs = await testRunService.getProjectRuns(projectId, source);
        res.json(runs);
    } catch (error: any) {
        console.error(`[Runner] Error in GET /runs/${req.params.projectId}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Get TestNG Results for a Specific Run
router.get('/run/:runId/testng-results', async (req, res) => {
    try {
        const { runId } = req.params;
        console.log(`[Runner] GET /run/${runId}/testng-results`);

        const { testNGParserService } = await import('../../services/TestNGParserService');
        const results = await testNGParserService.getResultsForRun(runId);

        res.json(results);
    } catch (error: any) {
        console.error(`[Runner] Error getting TestNG results:`, error);
        res.status(500).json({ error: error.message });
    }
});


// Get Details of a Specific Run
router.get('/run/:runId', async (req, res) => {
    console.log(`[Runner] GET /run/${req.params.runId} initiated`);
    try {
        const { runId } = req.params;
        let projectId = req.query.projectId as string;
        let firestoreRun: any = null;

        // If no projectId provided, try to find it globally via Firestore OR Local
        if (!projectId) {
            console.log(`[Runner] Lookup projectId for run ${runId}...`);

            // 1. Try Local First (Fastest)
            // Dynamic import to avoid circular dep issues if any, though likely fine here
            const { localProjectService } = await import('../../services/persistence/LocalProjectService');
            const localFound = await localProjectService.findTestRunById(runId);

            if (localFound) {
                projectId = localFound.projectId;
                console.log(`[Runner] Found projectId: ${projectId} locally`);
            } else {
                // 2. Try Firestore
                const found = await projectService.findTestRunById(runId);
                if (found) {
                    projectId = found.projectId;
                    firestoreRun = found; // Cache it
                    console.log(`[Runner] Found projectId: ${projectId} in Firestore`);
                } else {
                    console.log(`[Runner] ProjectId lookup failed for ${runId}`);
                }
            }
        }

        if (!projectId) {
            console.warn(`[Runner] 404 - Run not found (No Project ID)`);
            return res.status(404).json({ error: 'Run not found (Project ID required)' });
        }

        console.log(`[Runner] Fetching details from TestRunService (Local)...`);
        let run = await testRunService.getRunDetails(projectId, runId);

        if (!run) {
            console.warn(`[Runner] Local details null. Checking Firestore fallback...`);

            // If we didn't already fetch it, fetch it now
            if (!firestoreRun) {
                firestoreRun = await projectService.findTestRunById(runId);
            }

            if (firestoreRun) {
                console.log(`[Runner] Found in Firestore. Returning Firestore data.`);
                run = { ...firestoreRun.run, logs: firestoreRun.logs };
            } else {
                console.warn(`[Runner] 404 - Run not found in Local OR Firestore`);
                return res.status(404).json({ error: 'Run not found' });
            }
        }

        console.log(`[Runner] Success, returning run.`);
        res.json(run);
    } catch (error: any) {
        console.error(`[Runner] CRITICAL Error in GET /run/${req.params.runId}:`, error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/run/:runId', async (req, res) => {
    try {
        const { runId } = req.params;
        let { projectId } = req.query;

        // Auto-lookup if missing (Robustness Fix)
        if (!projectId) {
            console.log(`[Runner] DELETE ${runId}: No Project ID provided, searching globally...`);
            const found = await projectService.findTestRunById(runId);
            if (found) {
                projectId = found.projectId;
                console.log(`[Runner] Found run in Project: ${projectId}`);
            }
        }

        if (!projectId) {
            console.warn(`[Runner] DELETE ${runId} Failed: Could not resolve Project ID.`);
            return res.status(404).json({ error: 'Run not found (Could not determine Project ID)' });
        }

        const pId = projectId as string;

        console.log(`[Runner] Deleting run ${runId} from Project ${pId}...`);

        // 1. Delete from Local Storage (Project Data)
        await testRunService.deleteRun(pId, runId);

        // 2. Delete from Firestore (Source of Truth) to prevent Zombies
        try {
            await projectService.deleteTestRun(pId, runId);
            console.log(`[Runner] Deleted ${runId} from Firestore.`);
        } catch (e: any) {
            console.error(`[Runner] Failed to delete from Firestore (Zombie risk):`, e);
            // Don't fail the request, but warn.
        }

        res.json({ status: 'deleted' });
    } catch (error: any) {
        console.error(`[Runner] Delete Error:`, error);
        res.status(500).json({ error: error.message });
    }
});

export const runnerRoutes = router;
