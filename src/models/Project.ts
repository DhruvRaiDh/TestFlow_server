import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../lib/logger';

/**
 * Project Model - Data Access Layer
 * 
 * Responsibilities:
 * - CRUD operations for projects
 * - File system management
 * - Data validation
 * - Atomic writes with locking
 */

export interface Project {
    id: string;
    name: string;
    description: string;
    user_id?: string;
    orgId?: string | null; // Optional: the organization this project belongs to
    createdAt: string;
    updatedAt: string;
}

export interface ProjectData {
    customPages: any[];
    dailyData: any[];
    scripts: any[];
    reports: any[];
    testRuns: any[];
    schedules: any[];
    datasets: any[];
    files: any[];
    apiCollections: any[];
    visualTests: any[];
}

export class ProjectModel {
    private dataDir: string;
    private projectsFile: string;
    private locks = new Map<string, Promise<void>>();

    constructor() {
        const cwd = process.cwd();
        if (cwd.endsWith('backend') || cwd.endsWith('backend' + path.sep)) {
            this.dataDir = path.join(cwd, 'data');
        } else {
            this.dataDir = path.join(cwd, 'backend', 'data');
        }
        this.projectsFile = path.join(this.dataDir, 'projects.json');
        logger.debug('ProjectModel initialized', { dataDir: this.dataDir });
    }

    // ==================== CRUD Operations ====================

    /**
     * Get all projects for a user
     */
    async findAll(userId: string): Promise<Project[]> {
        const data = await this.readProjectsFile();
        return data.projects.filter(p => !userId || p.user_id === userId);
    }

    /**
     * Get project by ID
     */
    async findById(projectId: string, userId?: string): Promise<Project | null> {
        const data = await this.readProjectsFile();
        const project = data.projects.find(p => p.id === projectId);

        if (!project) return null;
        if (userId && project.user_id !== userId) return null;

        return project;
    }

    /**
     * Create new project
     */
    async create(projectData: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project> {
        const data = await this.readProjectsFile();

        const newProject: Project = {
            id: this.generateShortId(),
            name: projectData.name,
            description: projectData.description,
            user_id: projectData.user_id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        data.projects.push(newProject);
        await this.writeProjectsFile(data);

        // Create project directory and data file
        await this.initializeProjectData(newProject.id);

        logger.info('Project created', { projectId: newProject.id, name: newProject.name });
        return newProject;
    }

    /**
     * Update project
     */
    async update(projectId: string, updates: Partial<Omit<Project, 'id' | 'createdAt'>>, userId?: string): Promise<Project | null> {
        const data = await this.readProjectsFile();
        const index = data.projects.findIndex(p => p.id === projectId);

        if (index === -1) return null;
        if (userId && data.projects[index].user_id !== userId) return null;

        data.projects[index] = {
            ...data.projects[index],
            ...updates,
            updatedAt: new Date().toISOString()
        };

        await this.writeProjectsFile(data);
        logger.info('Project updated', { projectId });
        return data.projects[index];
    }

    /**
     * Delete project
     */
    async delete(projectId: string, userId?: string): Promise<boolean> {
        const data = await this.readProjectsFile();
        const index = data.projects.findIndex(p => p.id === projectId);

        if (index === -1) return false;
        if (userId && data.projects[index].user_id !== userId) return false;

        data.projects.splice(index, 1);
        await this.writeProjectsFile(data);

        // Delete project directory
        try {
            await fs.rm(this.getProjectDir(projectId), { recursive: true, force: true });
        } catch (error) {
            logger.error('Failed to delete project directory', error as Error, { projectId });
        }

        logger.info('Project deleted', { projectId });
        return true;
    }

    // ==================== Project Data Operations ====================

    /**
     * Read project data (scripts, reports, etc.)
     */
    async readProjectData(projectId: string): Promise<ProjectData> {
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
                if (error instanceof Error) {
                    logger.error('Corrupt JSON for project', error, { projectId });
                }
                return this.getEmptyProjectData();
            }
        });
    }

    /**
     * Write project data (atomic with locking)
     */
    async writeProjectData(projectId: string, data: ProjectData): Promise<void> {
        return this.runExclusive(projectId, async () => {
            const projectDir = this.getProjectDir(projectId);
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
                try { await fs.unlink(tempPath); } catch { }
                throw error;
            }
        });
    }

    // ==================== Validation ====================

    /**
     * Validate project access for user
     */
    async validateAccess(projectId: string, userId: string): Promise<boolean> {
        const project = await this.findById(projectId, userId);
        return project !== null;
    }

    /**
     * Validate project data structure
     */
    validate(data: unknown): data is Project {
        if (typeof data !== 'object' || data === null) return false;
        const project = data as any;
        return (
            typeof project.id === 'string' &&
            typeof project.name === 'string' &&
            typeof project.description === 'string' &&
            typeof project.createdAt === 'string'
        );
    }

    // ==================== Private Helpers ====================

    private async ensureDataDir(): Promise<void> {
        try {
            await fs.access(this.dataDir);
        } catch {
            await fs.mkdir(this.dataDir, { recursive: true });
        }
        const projectsDir = path.join(this.dataDir, 'projects');
        try {
            await fs.access(projectsDir);
        } catch {
            await fs.mkdir(projectsDir, { recursive: true });
        }
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

    private async writeProjectsFile(data: { projects: Project[] }): Promise<void> {
        await this.ensureDataDir();
        await fs.writeFile(this.projectsFile, JSON.stringify(data, null, 2));
    }

    private getProjectDir(projectId: string): string {
        return path.join(this.dataDir, 'projects', projectId);
    }

    private getProjectDataFilePath(projectId: string): string {
        return path.join(this.getProjectDir(projectId), 'data.json');
    }

    private async initializeProjectData(projectId: string): Promise<void> {
        const projectDir = this.getProjectDir(projectId);
        await fs.mkdir(projectDir, { recursive: true });
        await this.writeProjectData(projectId, this.getEmptyProjectData());
    }

    private getEmptyProjectData(): ProjectData {
        return {
            customPages: [],
            dailyData: [],
            scripts: [],
            reports: [],
            testRuns: [],
            schedules: [],
            datasets: [],
            files: [],
            apiCollections: [],
            visualTests: []
        };
    }

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

    private async runExclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.locks.get(key) || Promise.resolve();
        let release: () => void = () => { };
        const current = new Promise<void>(resolve => { release = resolve; });

        const resultPromise = previous.then(async () => {
            try {
                return await operation();
            } finally {
                release();
            }
        });

        this.locks.set(key, current);
        current.then(() => {
            if (this.locks.get(key) === current) this.locks.delete(key);
        });

        return resultPromise;
    }
}

// Export singleton instance
export const projectModel = new ProjectModel();
