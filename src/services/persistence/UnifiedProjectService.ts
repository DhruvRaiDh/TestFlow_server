import { projectService as remoteService, Project } from './ProjectService';
import { localProjectService } from './LocalProjectService';

export class UnifiedProjectService {

    /**
     * Normalize a project record coming from Firestore.
     * Firestore stores both `userId` (query field) and `user_id` (our local standard).
     * This strips `userId` and ensures `user_id` is set so local JSON stays clean.
     */
    private normalizeProject(raw: any, userId: string): Project {
        const { userId: _drop, ...rest } = raw;  // drop the legacy camelCase field
        return {
            ...rest,
            user_id: rest.user_id || userId,     // always ensure user_id is set
        } as Project;
    }

    // --- Reads (Primary: Local) ---

    async getAllProjects(userId: string): Promise<Project[]> {
        // 1. Return Local Data Immediately (Fast Start)
        const localProjects = await localProjectService.getAllProjects(userId);

        // 2. Trigger Background Sync (Lazy Load / Update)
        this.syncUserProjects(userId).catch(e => console.error('[Unified] Background Sync Error:', e));

        return localProjects;
    }

    async getProjectById(id: string, userId: string): Promise<Project | null> {
        // Local First
        const local = await localProjectService.getProjectById(id, userId);
        if (local) return local;

        // Fallback to Remote if not found locally (e.g. fresh install)
        console.log(`[Unified] Project ${id} not found locally, fetching from remote...`);
        const remote = await remoteService.getProjectById(id, userId);
        if (remote) {
            // Cache it locally
            await localProjectService.createProject(remote.name, remote.description, userId, remote.id);
            return remote;
        }
        return null;
    }

    async getProjectPages(projectId: string, userId: string): Promise<any[]> {
        return localProjectService.getProjectPages(projectId, userId);
    }

    async getDailyData(projectId: string, userId: string, date?: string): Promise<any[]> {
        return localProjectService.getDailyData(projectId, userId, date);
    }

    async exportBugs(projectId: string, date: string, userId: string): Promise<Buffer> {
        return localProjectService.exportBugs(projectId, date, userId);
    }

    async exportTestCases(projectId: string, date: string, userId: string): Promise<Buffer> {
        return localProjectService.exportTestCases(projectId, date, userId);
    }

    // --- Writes (Local First + Background Remote Sync) ---

    async createProject(name: string, description: string, userId: string, orgId?: string | null, platformType?: string): Promise<Project> {
        // 1. Create Local (Immediate)
        const id = crypto.randomUUID();
        let project = await localProjectService.createProject(name, description, userId, id);

        // 2. Persist orgId and platformType via update
        const extraUpdates: Record<string, any> = {};
        if (orgId !== undefined && orgId !== null) extraUpdates.orgId = orgId;
        if (platformType) extraUpdates.platformType = platformType;

        if (Object.keys(extraUpdates).length > 0) {
            await localProjectService.updateProject(id, extraUpdates as any, userId);
            project = { ...project, ...extraUpdates } as any;
        }

        // 3. Sync to Remote (Background)
        remoteService.createProject(name, description, userId, id).then(async () => {
            if (Object.keys(extraUpdates).length > 0) {
                await remoteService.updateProject(id, extraUpdates as any, userId);
            }
        }).catch(e => console.error('[Unified] Background Remote Create Failed:', e));

        // 4. Sync to SQLite (Background — non-blocking)
        this._sqliteWrite(() => {
            const { sql_createProject } = require('./SQLiteProjectService');
            return sql_createProject(name, description, userId, orgId ?? undefined, platformType ?? 'web', id);
        });

        return project as Project;
    }

    async updateProject(id: string, updates: Partial<Project>, userId: string): Promise<Project> {
        const project = await localProjectService.updateProject(id, updates, userId);

        remoteService.updateProject(id, updates, userId).catch(e =>
            console.error('[Unified] Background Remote Update Failed:', e)
        );

        this._sqliteWrite(() => {
            const { sql_updateProject } = require('./SQLiteProjectService');
            return sql_updateProject(id, updates, userId);
        });

        return project;
    }

    async deleteProject(id: string, userId: string): Promise<void> {
        await localProjectService.deleteProject(id, userId);

        remoteService.deleteProject(id, userId).catch(e =>
            console.error('[Unified] Background Remote Delete Failed:', e)
        );

        this._sqliteWrite(() => {
            const { sql_deleteProject } = require('./SQLiteProjectService');
            return sql_deleteProject(id, userId);
        });
    }

    async createProjectPage(projectId: string, pageData: any, userId: string): Promise<any> {
        const page = await localProjectService.createProjectPage(projectId, pageData, userId);

        remoteService.createProjectPage(projectId, page, userId).catch(e =>
            console.error('[Unified] Background Remote Page Create Failed:', e)
        );

        this._sqliteWrite(() => {
            const { sql_createPage } = require('./SQLiteProjectService');
            return sql_createPage(projectId, page);
        });

        return page;
    }

    async updateProjectPage(projectId: string, pageId: string, updates: any, userId: string): Promise<any> {
        const page = await localProjectService.updateProjectPage(projectId, pageId, updates, userId);
        remoteService.updateProjectPage(projectId, pageId, updates, userId).catch(e => console.error(e));
        return page;
    }

    async deleteProjectPage(projectId: string, pageId: string, userId: string): Promise<void> {
        await localProjectService.deleteProjectPage(projectId, pageId, userId);
        remoteService.deleteProjectPage(projectId, pageId, userId).catch(e => console.error(e));
        this._sqliteWrite(() => {
            const { sql_deletePage } = require('./SQLiteProjectService');
            return sql_deletePage(projectId, pageId);
        });
    }

    async createDailyData(projectId: string, dataPayload: any, userId: string): Promise<any> {
        const data = await localProjectService.createDailyData(projectId, dataPayload, userId);
        remoteService.createDailyData(projectId, data, userId).catch(e => console.error(e));
        return data;
    }

    async updateDailyData(projectId: string, date: string, updates: any, userId: string): Promise<any> {
        const data = await localProjectService.updateDailyData(projectId, date, updates, userId);
        remoteService.updateDailyData(projectId, date, updates, userId).catch((e: any) => console.error(e));

        // Also write to SQLite in background
        this._sqliteWrite(() => {
            const { sql_updateDailyData } = require('./SQLiteProjectService');
            return sql_updateDailyData(projectId, date, updates, userId);
        });

        return data;
    }

    // --- Scripts (Local First) ---

    async getScripts(projectId: string, userId: string): Promise<any[]> {
        return localProjectService.getScripts(projectId, userId);
    }

    async getScript(projectId: string, scriptId: string, userId: string): Promise<any | null> {
        return localProjectService.getScripts(projectId, userId).then(scripts => scripts.find((s: any) => s.id === scriptId) || null);
    }

    async createScript(projectId: string, scriptData: any, userId: string): Promise<any> {
        const script = await localProjectService.createScript(projectId, scriptData, userId);
        remoteService.createScript(projectId, script, userId).catch(e => console.error(e));
        this._sqliteWrite(() => {
            const { sql_createScript } = require('./SQLiteProjectService');
            return sql_createScript(projectId, script);
        });
        return script;
    }

    async updateScript(projectId: string, scriptId: string, updates: any, userId: string): Promise<any> {
        // Logic check: if validation fails locally, we abort.
        const script = await localProjectService.updateScript(projectId, scriptId, updates, userId);
        if (script) {
            remoteService.updateScript(projectId, scriptId, updates, userId).catch(e => console.error(e));
            this._sqliteWrite(() => {
                const { sql_updateScript } = require('./SQLiteProjectService');
                return sql_updateScript(projectId, scriptId, updates);
            });
        }
        return script;
    }

    async deleteScript(projectId: string, scriptId: string, userId: string): Promise<void> {
        await localProjectService.deleteScript(projectId, scriptId, userId);
        remoteService.deleteScript(projectId, scriptId, userId).catch(e => console.error(e));
        this._sqliteWrite(() => {
            const { sql_deleteScript } = require('./SQLiteProjectService');
            return sql_deleteScript(projectId, scriptId);
        });
    }

    // --- Test Runs (Read Access) ---
    async getTestRuns(projectId: string, userId: string): Promise<any[]> {
        return localProjectService.getTestRuns(projectId, userId);
    }

    // --- Files (Read Access) ---
    async getFSNodes(projectId: string): Promise<any[]> {
        return localProjectService.getFSNodes(projectId);
    }

    // ── SQLite background write helper ──────────────────────────────────────
    // Fires the SQLite write asynchronously. Any failure is logged but never
    // propagates — the JSON + Firebase layers are the source of truth for now.
    private _sqliteWrite(fn: () => Promise<any>) {
        Promise.resolve().then(fn).catch(e =>
            console.warn('[SQLite] Background write failed (non-critical):', e?.message ?? e)
        );
    }

    // --- Auto-Sync (Bidirectional) ---
    async syncUserProjects(userId: string) {
        console.log(`[Unified] Starting Auto-Sync for user: ${userId}`);
        try {
            // A. Pull Remote -> Local (For fresh installs or other device updates)
            const remoteProjects = await remoteService.getAllProjects(userId);
            const localProjects = await localProjectService.getAllProjects(userId);

            for (const rProj of remoteProjects) {
                const lProj = localProjects.find(p => p.id === rProj.id);
                if (!lProj) {
                    const normalized = this.normalizeProject(rProj, userId);
                    console.log(`[Unified] Pulling remote project to local: ${normalized.name}`);
                    await localProjectService.createProject(normalized.name, normalized.description, userId, normalized.id);
                    // Preserve orgId and platformType from remote
                    const extraFields: Record<string, any> = {};
                    if ((normalized as any).orgId) extraFields.orgId = (normalized as any).orgId;
                    if ((normalized as any).platformType) extraFields.platformType = (normalized as any).platformType;
                    if (Object.keys(extraFields).length > 0) {
                        await localProjectService.updateProject(normalized.id, extraFields as any, userId);
                    }
                } else {
                    // If local project exists but is missing orgId that remote has, pull it from remote
                    const localOrgId = (lProj as any).orgId ?? null;
                    const remoteOrgId = (rProj as any).orgId ?? null;
                    if (!localOrgId && remoteOrgId) {
                        console.log(`[Unified] Restoring orgId from remote for "${lProj.name}": ${remoteOrgId}`);
                        await localProjectService.updateProject(lProj.id, { orgId: remoteOrgId } as any, userId);
                    }
                }
            }

            // B. Push Local -> Remote (Backup)
            for (const localProj of localProjects) {
                // 1. Sync Project Metadata
                let remoteProj = remoteProjects.find(p => p.id === localProj.id);
                if (!remoteProj) {
                    console.log(`[Unified] Pushing local project to remote: ${localProj.name}`);
                    // @ts-ignore
                    remoteProj = await remoteService.createProject(localProj.name, localProj.description, userId, localProj.id);
                }

                // 1b. Sync orgId field — bidirectional with remote-wins-if-local-empty
                const localOrgId = (localProj as any).orgId ?? null;
                const remoteOrgId = remoteProj ? (remoteProj as any).orgId ?? null : null;
                if (localOrgId !== remoteOrgId) {
                    if (localOrgId && !remoteOrgId) {
                        // Local has orgId, remote doesn't → push to remote
                        console.log(`[Unified] Pushing orgId to remote for "${localProj.name}": → ${localOrgId}`);
                        remoteService.updateProject(localProj.id, { orgId: localOrgId } as any, userId)
                            .catch(e => console.error(`[Unified] orgId sync failed for ${localProj.id}:`, e));
                    } else if (!localOrgId && remoteOrgId) {
                        // Remote has orgId, local doesn't → pull from remote (DON'T overwrite remote!)
                        console.log(`[Unified] Restoring orgId from remote for "${localProj.name}": → ${remoteOrgId}`);
                        await localProjectService.updateProject(localProj.id, { orgId: remoteOrgId } as any, userId);
                    } else if (localOrgId && remoteOrgId) {
                        // Both have different orgIds → local wins (user explicitly changed it)
                        console.log(`[Unified] Syncing orgId for "${localProj.name}": ${remoteOrgId} → ${localOrgId}`);
                        remoteService.updateProject(localProj.id, { orgId: localOrgId } as any, userId)
                            .catch(e => console.error(`[Unified] orgId sync failed for ${localProj.id}:`, e));
                    }
                }

                // 2. Sync Scripts (Bidirectional)
                const localScripts = await localProjectService.getScripts(localProj.id, userId);
                const remoteScripts = await remoteService.getScripts(localProj.id, userId);
                // Push local → remote
                for (const script of localScripts) {
                    if (!remoteScripts.find(s => s.id === script.id)) {
                        console.log(`[Unified] Pushing script: ${script.name}`);
                        await remoteService.createScript(localProj.id, script, userId);
                    }
                }
                // Pull remote → local (RECOVERY)
                for (const rScript of remoteScripts) {
                    if (!localScripts.find(s => s.id === rScript.id)) {
                        console.log(`[Unified] Pulling remote script to local: ${rScript.name || rScript.id}`);
                        await localProjectService.createScript(localProj.id, rScript, userId);
                    }
                }

                // 3. Sync Test Runs (Bidirectional)
                const localRuns = await localProjectService.getTestRuns(localProj.id, userId);
                const remoteRuns = await remoteService.getTestRuns(localProj.id);
                // Push local → remote
                for (const run of localRuns) {
                    if (!remoteRuns.find((r: any) => r.id === run.id)) {
                        await remoteService.createTestRun(localProj.id, run);
                    }
                }
                // Pull remote → local (RECOVERY)
                for (const rRun of remoteRuns) {
                    if (!localRuns.find((r: any) => r.id === rRun.id)) {
                        console.log(`[Unified] Pulling remote test run to local: ${rRun.id}`);
                        await localProjectService.createTestRun(localProj.id, rRun);
                    }
                }

                // 4. Sync Schedules (Bidirectional)
                const localSchedules = await localProjectService.getSchedules(localProj.id, userId);
                const remoteSchedules = await remoteService.getSchedules(localProj.id, userId);
                for (const schedule of localSchedules) {
                    if (!remoteSchedules.find(s => s.id === schedule.id)) {
                        await remoteService.createSchedule(localProj.id, schedule, userId);
                    }
                }
                for (const rSchedule of remoteSchedules) {
                    if (!localSchedules.find(s => s.id === rSchedule.id)) {
                        console.log(`[Unified] Pulling remote schedule to local: ${rSchedule.id}`);
                        await localProjectService.createSchedule(localProj.id, rSchedule, userId);
                    }
                }

                // 5. Sync Daily Data (Bidirectional — test cases, bugs, pages)
                const localDailyData = await localProjectService.getDailyData(localProj.id, userId);
                const remoteDailyData = await remoteService.getDailyData(localProj.id, userId);
                // Push local → remote
                for (const localDay of localDailyData) {
                    if (!remoteDailyData.find((d: any) => d.id === localDay.id)) {
                        console.log(`[Unified] Pushing daily data to remote: ${localDay.date || localDay.id}`);
                        await remoteService.createDailyData(localProj.id, localDay, userId);
                    }
                }
                // Pull remote → local (RECOVERY — this is the critical path for restoring test cases/bugs)
                for (const rDay of remoteDailyData) {
                    if (!localDailyData.find((d: any) => d.id === rDay.id)) {
                        console.log(`[Unified] Pulling remote daily data to local: ${rDay.date || rDay.id}`);
                        await localProjectService.createDailyData(localProj.id, rDay, userId);
                    }
                }

                // 6. Sync Pages (Bidirectional)
                const localPages = await localProjectService.getProjectPages(localProj.id, userId);
                const remotePages = await remoteService.getProjectPages(localProj.id, userId);
                for (const lPage of localPages) {
                    if (!remotePages.find((p: any) => p.id === lPage.id)) {
                        await remoteService.createProjectPage(localProj.id, lPage, userId);
                    }
                }
                for (const rPage of remotePages) {
                    if (!localPages.find((p: any) => p.id === rPage.id)) {
                        console.log(`[Unified] Pulling remote page to local: ${rPage.name || rPage.id}`);
                        await localProjectService.createProjectPage(localProj.id, rPage, userId);
                    }
                }
            }
            console.log('[Unified] Auto-Sync Complete');
        } catch (error) {
            console.error('[Unified] Auto-Sync Failed:', error);
        }
    }
}

export const unifiedProjectService = new UnifiedProjectService();
