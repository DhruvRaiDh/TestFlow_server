import * as fs from 'fs/promises';
import { Dirent } from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { logger } from '../../lib/logger';

export interface Project {
    id: string;
    name: string;
    description: string;
    user_id?: string;
    orgId?: string | null; // Optional: organization this project belongs to
    createdAt: string;
    updatedAt: string;
}

interface ProjectData {
    customPages: any[];
    dailyData: any[];
    scripts: any[];
    reports: any[];
    testRuns: any[];
    schedules: any[];
    datasets: any[];
    files: any[];
    apiCollections: any[]; // Added for APILabService
    visualTests: any[]; // Added for VisualTestService
}
// ... existing code ...


// const DATA_DIR = path.join(__dirname, '../../data');
// const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

export class LocalProjectService {
    private dataDir: string;
    private projectsFile: string;

    constructor() {
        // Universal Path Resolution (Works in CJS Backend & ESM Electron)
        const cwd = process.cwd();
        // If running from 'backend' dir (Backend Server)
        if (cwd.endsWith('backend') || cwd.endsWith('backend' + path.sep)) {
            this.dataDir = path.join(cwd, 'data');
        } else {
            // If running from root (Electron / Repo root)
            this.dataDir = path.join(cwd, 'backend', 'data');
        }
        this.projectsFile = path.join(this.dataDir, 'projects.json');
        console.log('[LocalProjectService] Data Dir initialized at:', this.dataDir);
    }
    private async ensureDataDir() {
        try {
            await fs.access(this.dataDir);
        } catch {
            await fs.mkdir(this.dataDir, { recursive: true });
        }
        // Also ensure projects directory
        const projectsDir = path.join(this.dataDir, 'projects');
        try {
            await fs.access(projectsDir);
        } catch {
            await fs.mkdir(projectsDir, { recursive: true });
        }
    }

    // Helper: Short ID Generator (10 chars, URL-safe)
    private generateShortId(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        const randomValues = new Uint32Array(10);
        crypto.getRandomValues(randomValues);
        for (let i = 0; i < 10; i++) {
            result += chars[randomValues[i] % chars.length];
        }
        return result;
    }

    private async readProjectsFile(): Promise<{ projects: Project[] }> {
        await this.ensureDataDir();
        try {
            const data = await fs.readFile(this.projectsFile, 'utf-8');
            return JSON.parse(data);
        } catch (error: unknown) {
            if (error instanceof Error && 'code' in error && (error as any).code === 'ENOENT') {
                return { projects: [] };
            }
            throw error;
        }
    }

    private async writeProjectsFile(data: { projects: Project[] }) {
        await this.ensureDataDir();
        await fs.writeFile(this.projectsFile, JSON.stringify(data, null, 2));
    }

    private getProjectDir(projectId: string): string {
        return path.join(this.dataDir, 'projects', projectId);
    }

    private getProjectDataFilePath(projectId: string): string {
        return path.join(this.getProjectDir(projectId), 'data.json');
    }

    // SECURITY: Validate ownership before accessing sub-resources
    private async validateProjectAccess(projectId: string, userId: string): Promise<void> {
        const project = await this.getProjectById(projectId, userId);
        if (!project) throw new Error(`Unauthorized: User ${userId} cannot access project ${projectId}`);
    }

    private locks = new Map<string, Promise<void>>();

    private async acquireLock(key: string, fn: () => Promise<any>): Promise<any> {
        let release: () => void;
        const newLock = new Promise<void>(resolve => { release = resolve; });

        // Wait for previous lock
        const previousLock = this.locks.get(key) || Promise.resolve();
        // Set new lock immediately to block others
        const currentLock = previousLock.then(() => fn().finally(() => release()));
        this.locks.set(key, newLock.then(() => { if (this.locks.get(key) === currentLock) this.locks.delete(key); }));

        return currentLock;
    }

    // Simplified queue-based lock (simpler than above which has logic flaws with the promise chain)
    // Let's use a standard queue pattern.
    private async runExclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.locks.get(key) || Promise.resolve();

        let release: () => void = () => { };
        const current = new Promise<void>(resolve => { release = resolve; });

        // Chain it
        const resultPromise = previous.then(async () => {
            try {
                return await operation();
            } finally {
                release();
            }
        });

        this.locks.set(key, current);

        // Cleanup if we are the last one (optional but good for memory)
        current.then(() => {
            if (this.locks.get(key) === current) this.locks.delete(key);
        });

        return resultPromise;
    }

    public async readProjectData(projectId: string): Promise<ProjectData> {
        return this.runExclusive(projectId, async () => {
            const filePath = this.getProjectDataFilePath(projectId);
            try {
                const data = await fs.readFile(filePath, 'utf-8');
                if (!data || data.trim() === '') {
                    return this.getEmptyProjectData();
                }
                return JSON.parse(data);
            } catch (error: unknown) {
                if (error instanceof Error && 'code' in error && (error as any).code === 'ENOENT') {
                    return this.getEmptyProjectData();
                }
                // Log and return empty if JSON corrupted to prevent 500
                if (error instanceof Error) {
                    logger.error('Corrupt JSON for project', error, { projectId });
                }
                return this.getEmptyProjectData();
            }
        });
    }

    private getEmptyProjectData(): ProjectData {
        return { customPages: [], dailyData: [], scripts: [], reports: [], testRuns: [], schedules: [], datasets: [], files: [], apiCollections: [], visualTests: [] };
    }

    // Direct write - unsafe if not part of a transaction, but we lock it anyway.
    // STAGE 2: Atomic Writes to prevent corruption
    public async writeProjectData(projectId: string, data: ProjectData) {
        return this.runExclusive(projectId, async () => {
            const projectDir = this.getProjectDir(projectId);
            // Ensure project directory exists
            try { await fs.access(projectDir); } catch { await fs.mkdir(projectDir, { recursive: true }); }

            const filePath = this.getProjectDataFilePath(projectId);
            const tempPath = `${filePath}.${this.generateShortId()}.tmp`;

            try {
                await fs.writeFile(tempPath, JSON.stringify(data, null, 2));
                await fs.rename(tempPath, filePath);
            } catch (error: unknown) {
                if (error instanceof Error) {
                    logger.error('Atomic write failed for project', error, { projectId });
                }
                // Try to clean up temp
                try { await fs.unlink(tempPath); } catch { }
                throw error;
            }
        });
    }

    // ATOMIC UPDATE - The solution to our race conditions
    public async updateProjectData(projectId: string, updater: (data: ProjectData) => void | Promise<void>): Promise<void> {
        return this.runExclusive(projectId, async () => {
            const filePath = this.getProjectDataFilePath(projectId);
            let data: ProjectData;
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                data = JSON.parse(content);
            } catch (error: unknown) {
                if (error instanceof Error && 'code' in error && (error as any).code === 'ENOENT') {
                    data = this.getEmptyProjectData();
                } else {
                    throw error;
                }
            }

            await updater(data);

            const projectDir = this.getProjectDir(projectId);
            try { await fs.access(projectDir); } catch { await fs.mkdir(projectDir, { recursive: true }); }

            // Re-implement atomic write logic here directly.
            const tempPath = `${filePath}.${this.generateShortId()}.tmp`;
            try {
                await fs.writeFile(tempPath, JSON.stringify(data, null, 2));
                await fs.rename(tempPath, filePath);
            } catch (error: unknown) {
                if (error instanceof Error) {
                    logger.error('Atomic update failed for project', error, { projectId });
                }
                try { await fs.unlink(tempPath); } catch { }
                throw error;
            }
        });
    }


    async getAllProjects(userId: string): Promise<Project[]> {
        const data = await this.readProjectsFile();
        // Strict Scoping: Only return projects for this user!
        const userProjects = data.projects.filter(p => p.user_id === userId);
        console.log(`[LocalProject] getAllProjects for ${userId}. Total: ${userProjects.length} (Global: ${data.projects.length})`);

        return userProjects.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    async getAllProjectsSystem(): Promise<Project[]> {
        const data = await this.readProjectsFile();
        return data.projects || [];
    }

    async getProjectById(id: string, userId: string): Promise<Project | null> {
        const data = await this.readProjectsFile();
        const project = data.projects.find(p => p.id === id);

        // Strict Scoping Check
        if (!project) return null;
        if (project.user_id !== userId) {
            console.warn(`[LocalProject] Unauthorized access attempt: User ${userId} tried to access Project ${id} (Owner: ${project.user_id})`);
            return null; // Equivalent to 403/404
        }
        return project;
    }

    async createProject(name: string, description: string, userId: string, id?: string): Promise<Project> {
        const data = await this.readProjectsFile();

        const newId = id || this.generateShortId();

        // Idempotency check
        const existing = data.projects.find(p => p.id === newId);
        if (existing) {
            if (existing.user_id !== userId) throw new Error('ID Collision with another user project');
            return existing;
        }

        const newProject: Project = {
            id: newId,
            name,
            description,
            user_id: userId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        data.projects.push(newProject);
        await this.writeProjectsFile(data);

        // Initialize empty data file in new directory structure
        await this.writeProjectData(newProject.id, this.getEmptyProjectData());

        return newProject;
    }


    async updateProject(id: string, updates: Partial<Project>, userId: string): Promise<Project> {
        const data = await this.readProjectsFile();
        const index = data.projects.findIndex(p => p.id === id);

        if (index === -1) throw new Error('Project not found');
        if (data.projects[index].user_id !== userId) throw new Error('Unauthorized');

        const updatedProject = {
            ...data.projects[index],
            ...updates,
            updatedAt: new Date().toISOString()
        };
        data.projects[index] = updatedProject;
        await this.writeProjectsFile(data);
        return updatedProject;
    }

    async deleteProject(id: string, userId: string): Promise<void> {
        const data = await this.readProjectsFile();
        const project = data.projects.find(p => p.id === id);

        if (!project) return; // Idempotent
        if (project.user_id !== userId) throw new Error('Unauthorized');

        const filteredProjects = data.projects.filter(p => p.id !== id);
        await this.writeProjectsFile({ projects: filteredProjects });

        // Also delete data file
        try {
            await fs.unlink(this.getProjectDataFilePath(id));
        } catch (error: unknown) {
            if (error instanceof Error) {
                logger.error('Error deleting project data file', error, { projectId: id });
            }
        }
    }

    // --- Sub-resources methods ---

    async getProjectPages(projectId: string, userId: string): Promise<any[]> {
        await this.validateProjectAccess(projectId, userId);
        const data = await this.readProjectData(projectId);
        return data.customPages || [];
    }

    async createProjectPage(projectId: string, pageData: any, userId: string): Promise<any> {
        const data = await this.readProjectData(projectId);
        const pageId = pageData.id || this.generateShortId();

        // Prevent Duplicates: Check if Page ID exists
        const existingPage = data.customPages.find(p => p.id === pageId);
        if (existingPage) {
            return existingPage;
        }

        const newPage = { ...pageData, id: pageId };
        data.customPages.push(newPage);
        await this.writeProjectData(projectId, data);
        return newPage;
    }

    async updateProjectPage(projectId: string, pageId: string, updates: any, userId: string): Promise<any> {
        const data = await this.readProjectData(projectId);
        const index = data.customPages.findIndex(p => p.id === pageId);

        if (index !== -1) {
            data.customPages[index] = { ...data.customPages[index], ...updates };
            await this.writeProjectData(projectId, data);
            return data.customPages[index];
        }
        return null;
    }

    async deleteProjectPage(projectId: string, pageId: string, userId: string): Promise<void> {
        await this.updateProjectData(projectId, (data) => {
            // Find the page before removing it so we can get its date
            const pageToDelete = data.customPages.find(p => p.id === pageId);

            if (!pageToDelete) return; // Page not found, nothing to do (idempotent)

            // Remove the page tab
            data.customPages = data.customPages.filter(p => p.id !== pageId);

            // Only remove dailyData if no other remaining page still references the same date.
            // This guards against any future scenario where two pages share a date.
            const dateStillInUse = data.customPages.some(p => p.date === pageToDelete.date);
            if (!dateStillInUse) {
                data.dailyData = data.dailyData.filter(d => d.date !== pageToDelete.date);
            }
        });
    }

    async getDailyData(projectId: string, userId: string, date?: string): Promise<any[]> {
        await this.validateProjectAccess(projectId, userId);
        const data = await this.readProjectData(projectId);
        if (date) {
            return data.dailyData.filter(d => d.date === date);
        }
        return data.dailyData || [];
    }

    async createDailyData(projectId: string, dataPayload: any, userId: string): Promise<any> {
        const data = await this.readProjectData(projectId);
        data.dailyData.push(dataPayload);
        await this.writeProjectData(projectId, data);
        return dataPayload;
    }

    async updateDailyData(projectId: string, date: string, updates: any, userId: string): Promise<any> {
        const data = await this.readProjectData(projectId);
        const index = data.dailyData.findIndex(d => d.date === date);

        if (index !== -1) {
            data.dailyData[index] = { ...data.dailyData[index], ...updates };
        } else {
            // If not found, create it (upsert behavior often expected)
            data.dailyData.push({ date, ...updates });
        }

        await this.writeProjectData(projectId, data);
        return data.dailyData.find(d => d.date === date);
    }

    async exportBugs(projectId: string, date: string, userId: string): Promise<Buffer> {
        const dailyData = await this.getDailyData(projectId, userId);
        const dayData = dailyData.find(d => d.date === date);
        const bugs = dayData?.bugs || [];

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Bugs');

        worksheet.columns = [
            { header: 'Bug ID', key: 'bugId', width: 15 },
            { header: 'Title', key: 'title', width: 30 },
            { header: 'Description', key: 'description', width: 40 },
            { header: 'Module', key: 'module', width: 15 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Severity', key: 'severity', width: 15 },
            { header: 'Priority', key: 'priority', width: 15 },
            { header: 'Reporter', key: 'reporter', width: 20 },
            { header: 'Assignee', key: 'assignee', width: 20 },
            { header: 'Created At', key: 'createdAt', width: 20 },
            { header: 'Updated At', key: 'updatedAt', width: 20 }
        ];

        worksheet.addRows(bugs);

        return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
    }

    async exportTestCases(projectId: string, date: string, userId: string): Promise<Buffer> {
        const dailyData = await this.getDailyData(projectId, userId);
        const dayData = dailyData.find(d => d.date === date);
        const testCases = dayData?.testCases || [];

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Test Cases');

        worksheet.columns = [
            { header: 'Test Case ID', key: 'testCaseId', width: 15 },
            { header: 'Scenario', key: 'testScenario', width: 30 },
            { header: 'Description', key: 'testCaseDescription', width: 40 },
            { header: 'Module', key: 'module', width: 15 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Pre-requisites', key: 'preRequisites', width: 30 },
            { header: 'Test Steps', key: 'testSteps', width: 40 },
            { header: 'Test Data', key: 'testData', width: 20 },
            { header: 'Expected Result', key: 'expectedResult', width: 30 },
            { header: 'Actual Result', key: 'actualResult', width: 30 },
            { header: 'Comments', key: 'comments', width: 30 },
            { header: 'Created At', key: 'createdAt', width: 20 },
            { header: 'Updated At', key: 'updatedAt', width: 20 }
        ];

        worksheet.addRows(testCases);

        return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
    }
    // --- Reports methods ---

    async getReports(projectId: string, userId: string): Promise<any[]> {
        await this.validateProjectAccess(projectId, userId);
        const data = await this.readProjectData(projectId);
        return data.reports || [];
    }

    async addReport(projectId: string, reportData: any, userId: string): Promise<any> {
        const data = await this.readProjectData(projectId);
        const reportId = reportData.id || this.generateShortId();

        const newReport = {
            ...reportData,
            id: reportId,
        };

        if (!data.reports) data.reports = [];
        data.reports.push(newReport);

        await this.writeProjectData(projectId, data);
        return newReport;
    }

    async deleteReport(projectId: string, reportId: string, userId: string): Promise<void> {
        const data = await this.readProjectData(projectId);
        if (!data.reports) return;

        data.reports = data.reports.filter((r: any) => r.id !== reportId);
        await this.writeProjectData(projectId, data);
    }

    // --- TestRuns methods ---

    async createTestRun(projectId: string, runData: any): Promise<any> {
        const data = await this.readProjectData(projectId);
        if (!data.testRuns) data.testRuns = [];

        const newRun = {
            ...runData,
            id: runData.id || this.generateShortId(),
            logs: [] // Embed logs directly
        };
        data.testRuns.push(newRun);
        await this.writeProjectData(projectId, data);
        return newRun;
    }

    async updateTestRun(projectId: string, runId: string, updates: any): Promise<void> {
        const data = await this.readProjectData(projectId);
        if (!data.testRuns) return;

        const index = data.testRuns.findIndex((r: any) => r.id === runId);
        if (index !== -1) {
            data.testRuns[index] = { ...data.testRuns[index], ...updates };
            await this.writeProjectData(projectId, data);
        }
    }

    async addTestLog(projectId: string, runId: string, logEntry: any): Promise<void> {
        const data = await this.readProjectData(projectId);
        if (!data.testRuns) return;

        const run = data.testRuns.find((r: any) => r.id === runId);
        if (run) {
            if (!run.logs) run.logs = [];
            run.logs.push(logEntry);
            await this.writeProjectData(projectId, data);
        }
    }

    // --- Scripts methods ---

    async getScripts(projectId: string, userId: string): Promise<any[]> {
        await this.validateProjectAccess(projectId, userId);
        const data = await this.readProjectData(projectId);
        return data.scripts || [];
    }

    async createScript(projectId: string, scriptData: any, userId: string): Promise<any> {
        const data = await this.readProjectData(projectId);
        const scriptId = scriptData.id || this.generateShortId();

        const newScript = {
            ...scriptData,
            id: scriptId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        if (!data.scripts) data.scripts = [];
        data.scripts.push(newScript);

        await this.writeProjectData(projectId, data);
        return newScript;
    }

    async updateScript(projectId: string, scriptId: string, updates: any, userId: string): Promise<any> {
        const data = await this.readProjectData(projectId);
        if (!data.scripts) return null;

        const index = data.scripts.findIndex((s: any) => s.id === scriptId);
        if (index !== -1) {
            data.scripts[index] = {
                ...data.scripts[index],
                ...updates,
                updatedAt: new Date().toISOString()
            };
            await this.writeProjectData(projectId, data);
            return data.scripts[index];
        }
        return null;
    }

    async deleteScript(projectId: string, scriptId: string, userId: string): Promise<void> {
        const data = await this.readProjectData(projectId);
        if (!data.scripts) return;

        data.scripts = data.scripts.filter((s: any) => s.id !== scriptId);
        await this.writeProjectData(projectId, data);
    }
    // --- Schedules methods ---

    async getSchedules(projectId: string, userId: string): Promise<any[]> {
        await this.validateProjectAccess(projectId, userId);
        const data = await this.readProjectData(projectId);
        return data.schedules || [];
    }

    // --- Helpers for global lookup (Scanning) ---

    // SYSTEM ONLY: Get all schedules for booting the SchedulerService
    async getAllSchedulesSystem(): Promise<{ schedule: any, projectId: string }[]> {
        const projects = await this.readProjectsFile();
        const allSchedules: { schedule: any, projectId: string }[] = [];

        for (const p of projects.projects) {
            const data = await this.readProjectData(p.id);
            if (data.schedules && Array.isArray(data.schedules)) {
                data.schedules.forEach(s => {
                    if (s.is_active) {
                        allSchedules.push({ schedule: s, projectId: p.id });
                    }
                });
            }
        }
        return allSchedules;
    }

    async findScriptById(scriptId: string): Promise<{ script: any, projectId: string, project: Project } | null> {
        const projects = await this.readProjectsFile();
        for (const p of projects.projects) {
            const data = await this.readProjectData(p.id);
            const script = data.scripts?.find((s: any) => s.id === scriptId);
            if (script) return { script, projectId: p.id, project: p };
        }
        return null;
    }

    async findTestRunById(runId: string): Promise<{ run: any, logs: any[], projectId: string } | null> {
        const projects = await this.readProjectsFile();
        for (const p of projects.projects) {
            const data = await this.readProjectData(p.id);
            const run = data.testRuns?.find((r: any) => r.id === runId);
            if (run) return { run, logs: run.logs || [], projectId: p.id };
        }
        return null;
    }

    async findScheduleById(scheduleId: string): Promise<{ schedule: any, projectId: string } | null> {
        const projects = await this.readProjectsFile();
        for (const p of projects.projects) {
            const data = await this.readProjectData(p.id);
            const schedule = data.schedules?.find((s: any) => s.id === scheduleId);
            if (schedule) return { schedule, projectId: p.id };
        }
        return null;
    }

    async getTestRuns(projectId: string, userId: string): Promise<any[]> {
        // userId arg was missing in original signature but passed by route? 
        // Route called: projectService.getTestRuns(id, userId) but signature was getTestRuns(projectId)
        // Correcting signature to match standard pattern
        await this.validateProjectAccess(projectId, userId);
        const data = await this.readProjectData(projectId);
        return data.testRuns || [];
    }

    // Overloading system call if needed, but for now enforcing security
    async getTestRunsSystem(projectId: string): Promise<any[]> {
        const data = await this.readProjectData(projectId);
        return data.testRuns || [];
    }

    async deleteTestRun(projectId: string, runId: string): Promise<void> {
        const data = await this.readProjectData(projectId);
        if (!data.testRuns) return;
        data.testRuns = data.testRuns.filter((r: any) => r.id !== runId);
        await this.writeProjectData(projectId, data);
    }


    async createSchedule(projectId: string, scheduleData: any, userId: string): Promise<any> {
        const data = await this.readProjectData(projectId);
        const scheduleId = scheduleData.id || this.generateShortId();

        const newSchedule = {
            ...scheduleData,
            id: scheduleId,
            created_at: new Date().toISOString()
        };

        if (!data.schedules) data.schedules = [];
        data.schedules.push(newSchedule);

        await this.writeProjectData(projectId, data);
        return newSchedule;
    }

    async deleteSchedule(projectId: string, scheduleId: string, userId: string): Promise<void> {
        const data = await this.readProjectData(projectId);
        if (!data.schedules) return;

        data.schedules = data.schedules.filter((s: any) => s.id !== scheduleId);
        await this.writeProjectData(projectId, data);
    }
    // --- Datasets methods ---

    async getDatasets(projectId: string): Promise<any[]> {
        const data = await this.readProjectData(projectId);
        return data.datasets || [];
    }

    async saveDataset(projectId: string, dataset: any): Promise<any> {
        const data = await this.readProjectData(projectId);
        if (!data.datasets) data.datasets = [];

        const newDataset = {
            ...dataset,
            id: dataset.id || this.generateShortId(),
            created_at: new Date().toISOString()
        };
        data.datasets.push(newDataset);
        await this.writeProjectData(projectId, data);
        return newDataset;
    }

    async deleteDataset(projectId: string, datasetId: string): Promise<void> {
        const data = await this.readProjectData(projectId);
        if (!data.datasets) return;

        data.datasets = data.datasets.filter((d: any) => d.id !== datasetId);
        await this.writeProjectData(projectId, data);
    }
    // --- FileSystem methods ---

    async getFSNodes(projectId: string): Promise<any[]> {
        const data = await this.readProjectData(projectId);
        console.log(`[LocalProject] GetFSNodes ${projectId}: ${data.files?.length || 0} files`);
        return data.files || [];
    }

    async saveFSNode(projectId: string, node: any): Promise<any> {
        const data = await this.readProjectData(projectId);
        if (!data.files) data.files = [];

        let result;
        const index = data.files.findIndex((f: any) => f.id === node.id);
        if (index !== -1) {
            data.files[index] = { ...data.files[index], ...node };
            result = data.files[index];
        } else {
            const newNode = {
                ...node,
                id: node.id || this.generateShortId(),
                created_at: new Date().toISOString()
            };
            data.files.push(newNode);
            result = newNode;
        }
        await this.writeProjectData(projectId, data);
        return result;
    }

    async saveFSNodes(projectId: string, nodes: any[]): Promise<void> {
        const data = await this.readProjectData(projectId);
        // Overwrite or Merge? "Heal" implies overwrite from Source of Truth.
        // But we want to preserve local-only changes? 
        // No, Firestore is master. If it's in Firestore, it wins.
        // We'll replace the entire files array to be safe from ghosts.
        data.files = nodes.map(n => ({
            ...n,
            // Ensure ID exists
            id: n.id || this.generateShortId()
        }));
        console.log(`[LocalProject] Healed ${projectId} with ${nodes.length} remote nodes.`);
        await this.writeProjectData(projectId, data);
    }


    async deleteFSNode(projectId: string, nodeId: string): Promise<void> {
        const data = await this.readProjectData(projectId);
        if (!data.files) return;

        data.files = data.files.filter((f: any) => f.id !== nodeId);
        await this.writeProjectData(projectId, data);
    }
    // --- API Lab methods ---

    async getApiCollections(projectId: string): Promise<any[]> {
        const data = await this.readProjectData(projectId);
        console.log(`[LocalProject] GetApiCollections ${projectId}: ${data.apiCollections?.length || 0} collections`);
        return data.apiCollections || [];
    }

    async saveApiCollection(projectId: string, collection: any): Promise<any> {
        const data = await this.readProjectData(projectId);
        if (!data.apiCollections) data.apiCollections = [];

        let result;
        const index = data.apiCollections.findIndex((c: any) => c.id === collection.id);
        if (index !== -1) {
            data.apiCollections[index] = { ...data.apiCollections[index], ...collection };
            result = data.apiCollections[index];
        } else {
            const newCollection = {
                ...collection,
                id: collection.id || this.generateShortId(),
                created_at: new Date().toISOString(),
                requests: [] // initialize requests array
            };
            data.apiCollections.push(newCollection);
            result = newCollection;
        }
        await this.writeProjectData(projectId, data);
        return result;
    }

    async deleteApiCollection(projectId: string, collectionId: string): Promise<void> {
        const data = await this.readProjectData(projectId);
        if (!data.apiCollections) return;

        data.apiCollections = data.apiCollections.filter((c: any) => c.id !== collectionId);
        await this.writeProjectData(projectId, data);
    }

    // --- Visual Tests ---

    async getVisualTests(projectId: string): Promise<any[]> {
        const data = await this.readProjectData(projectId);
        return data.visualTests || [];
    }

    async saveVisualTest(projectId: string, test: any): Promise<any> {
        const data = await this.readProjectData(projectId);
        if (!data.visualTests) data.visualTests = [];

        let result;
        const index = data.visualTests.findIndex((t: any) => t.id === test.id);
        if (index !== -1) {
            data.visualTests[index] = { ...data.visualTests[index], ...test };
            result = data.visualTests[index];
        } else {
            const newTest = {
                ...test,
                id: test.id || this.generateShortId(),
                created_at: new Date().toISOString()
            };
            data.visualTests.push(newTest);
            result = newTest;
        }
        await this.writeProjectData(projectId, data);
        return result;
    }

    async deleteVisualTest(projectId: string, testId: string): Promise<void> {
        const data = await this.readProjectData(projectId);
        if (!data.visualTests) return;

        data.visualTests = data.visualTests.filter((t: any) => t.id !== testId);
        await this.writeProjectData(projectId, data);
    }
    async createFSNode(projectId: string, node: any): Promise<any> {
        const data = await this.readProjectData(projectId);
        if (!data.files) data.files = [];

        const newNode = {
            ...node,
            id: node.id || this.generateShortId(),
            created_at: new Date().toISOString()
        };

        data.files.push(newNode);
        await this.writeProjectData(projectId, data);
        return newNode;
    }

    async rescanFiles(projectId: string): Promise<any[]> {
        const data = await this.readProjectData(projectId);

        // Scan "tests" directory in backend root
        const testsDir = path.join(process.cwd(), 'tests');
        const files: any[] = [];

        // Helper to recursively scan
        const scan = async (dir: string, parentId: string | null = null) => {
            let entries: Dirent[];
            try {
                entries = await fs.readdir(dir, { withFileTypes: true });
            } catch (error: unknown) {
                if (parentId === null) {
                    if (error instanceof Error) {
                        console.error(`[LocalProject] Error reading root tests directory ${dir}: ${error.message}`);
                    }
                    await fs.mkdir(dir, { recursive: true });
                    entries = [];
                } else {
                    if (error instanceof Error) {
                        console.error(`[LocalProject] Error reading directory ${dir}: ${error.message}`);
                    }
                    return;
                }
            }

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const type = entry.isDirectory() ? 'folder' : 'file';
                if (type === 'file' && !entry.name.match(/\.(ts|js|java|py)$/)) continue;

                const node = {
                    id: this.generateShortId(),
                    name: entry.name,
                    type,
                    parent_id: parentId,
                    content: type === 'file' ? await fs.readFile(fullPath, 'utf-8') : null,
                    created_at: new Date().toISOString()
                };

                files.push(node);

                if (type === 'folder') {
                    await scan(fullPath, node.id);
                }
            }
        };

        await scan(testsDir);

        data.files = files;
        await this.writeProjectData(projectId, data);
        console.log(`[LocalProject] Rescanned ${files.length} files for project ${projectId}`);
        return files;
    }
}

export const localProjectService = new LocalProjectService();
