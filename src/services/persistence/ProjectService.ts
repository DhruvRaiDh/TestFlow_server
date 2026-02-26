import { db } from '../../lib/firebase-admin';
import { v4 as uuidv4 } from 'uuid';

export interface Project {
    id: string;
    name: string;
    description: string;
    user_id?: string;
    userId?: string; // Handle both cases
    orgId?: string | null; // Optional organization this project belongs to
    createdAt: string;
    updatedAt: string;
}

export class ProjectService {
    public collection = db.collection('projects');

    async getAllProjects(userId: string): Promise<Project[]> {
        try {
            const snapshot = await this.collection.where('userId', '==', userId).get();
            // Also Try 'user_id' for legacy compatibility if needed, or handle in migration
            // For now assuming migration mapped correctly.

            return snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    // Ensure dates are strings
                    createdAt: data.createdAt || new Date().toISOString(),
                    updatedAt: data.updatedAt || new Date().toISOString()
                } as Project;
            });
        } catch (error) {
            console.error('[Firestore] getAllProjects error:', error);
            throw error;
        }
    }

    async getProjectById(id: string, userId: string): Promise<Project | null> {
        try {
            const doc = await this.collection.doc(id).get();
            if (!doc.exists) return null;
            const data = doc.data() as any;
            if (data.userId !== userId && data.user_id !== userId) return null; // Auth check

            return {
                id: doc.id,
                ...data
            } as Project;
        } catch (error) {
            console.error('[Firestore] getProjectById error:', error);
            throw error;
        }
    }

    async createProject(name: string, description: string, userId: string, id?: string): Promise<Project> {
        const projectId = id || uuidv4();
        const now = new Date().toISOString();
        const project: Project = {
            id: projectId,
            name,
            description,
            userId, // Standardize on userId
            user_id: userId, // Keep legacy field for now
            createdAt: now,
            updatedAt: now
        };

        await this.collection.doc(projectId).set(project);
        return project;
    }

    async updateProject(id: string, updates: Partial<Project>, userId: string): Promise<Project> {
        const docRef = this.collection.doc(id);
        const doc = await docRef.get();
        if (!doc.exists) throw new Error('Project not found');
        const data = doc.data() as any;
        if (data.userId !== userId && data.user_id !== userId) throw new Error('Unauthorized');

        const updatedData = {
            ...updates,
            updatedAt: new Date().toISOString()
        };

        await docRef.update(updatedData);
        return {
            ...data,
            ...updatedData,
            id
        } as Project;
    }

    async deleteProject(id: string, userId: string): Promise<void> {
        const docRef = this.collection.doc(id);
        const doc = await docRef.get();
        if (!doc.exists) return;
        const data = doc.data() as any;
        if (data.userId !== userId && data.user_id !== userId) throw new Error('Unauthorized');

        await docRef.delete();
    }

    // --- Sub-Collections (Pages, DailyData, etc stored as nested collections or root collections) ---
    // Decision: Store as Sub-collections for better organization: projects/{id}/pages/{pageId}

    async getProjectPages(projectId: string, userId: string): Promise<any[]> {
        const snapshot = await this.collection.doc(projectId).collection('pages').get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    async createProjectPage(projectId: string, pageData: any, userId: string): Promise<any> {
        const pageId = pageData.id || uuidv4();
        const page = { ...pageData, id: pageId, projectId };
        await this.collection.doc(projectId).collection('pages').doc(pageId).set(page);
        return page;
    }

    async updateProjectPage(projectId: string, pageId: string, updates: any, userId: string): Promise<any> {
        await this.collection.doc(projectId).collection('pages').doc(pageId).update(updates);
        return { id: pageId, ...updates };
    }

    async deleteProjectPage(projectId: string, pageId: string, userId: string): Promise<void> {
        await this.collection.doc(projectId).collection('pages').doc(pageId).delete();
    }

    // Daily Data
    async getDailyData(projectId: string, userId: string, date?: string): Promise<any[]> {
        let query = this.collection.doc(projectId).collection('daily_data');
        if (date) {
            // @ts-ignore
            query = query.where('date', '==', date);
        }
        const snapshot = await query.get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    async createDailyData(projectId: string, dataPayload: any, userId: string): Promise<any> {
        const id = dataPayload.id || uuidv4();
        const data = { ...dataPayload, id, projectId };
        await this.collection.doc(projectId).collection('daily_data').doc(id).set(data);
        return data;
    }

    async updateDailyData(projectId: string, date: string, updates: any, userId: string): Promise<any> {
        // This relies on knowing the ID, but the route passes Date.
        // We need to find the doc by date first if ID isn't known, or change routing.
        // Assuming updateDailyData in route might pass ID? No, it passed 'date'.
        // We'll search by date.

        const snapshot = await this.collection.doc(projectId).collection('daily_data').where('date', '==', date).get();
        if (snapshot.empty) throw new Error('Daily data not found');

        const doc = snapshot.docs[0];
        await doc.ref.update(updates);
        return { id: doc.id, ...doc.data(), ...updates };
    }

    // Exports (Reuse Local for now via Unified? Or implement stream?)
    // Firestore doesn't inherently support Excel export.
    // For simplicity, we can return empty buffer or implement a generator.
    // TO KEEP IT SIMPLE: Raise error or return empty, forcing fallback to local if needed?
    // Actually, UnifiedService delegates to this.
    // We can implement basic JSON-to-Excel here using 'xlsx' if installed, or just return basic buffer.
    // Given the complexity, I will mock this for now or leave as TODO.

    async exportBugs(projectId: string, date: string, userId: string): Promise<Buffer> {
        return Buffer.from(''); // Placeholder
    }

    async exportTestCases(projectId: string, date: string, userId: string): Promise<Buffer> {
        return Buffer.from(''); // Placeholder
    }

    // --- Scripts (Firestore) ---
    async getScripts(projectId: string, userId: string): Promise<any[]> {
        const snapshot = await this.collection.doc(projectId).collection('scripts').get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    async getScript(projectId: string, scriptId: string, userId: string): Promise<any | null> {
        const doc = await this.collection.doc(projectId).collection('scripts').doc(scriptId).get();
        if (!doc.exists) return null;
        return { id: doc.id, ...doc.data() };
    }

    async createScript(projectId: string, scriptData: any, userId: string): Promise<any> {
        const id = scriptData.id || uuidv4();
        const now = new Date().toISOString();
        const script = {
            ...scriptData,
            id,
            projectId,
            createdAt: now,
            updatedAt: now
        };
        await this.collection.doc(projectId).collection('scripts').doc(id).set(script);
        return script;
    }

    async updateScript(projectId: string, scriptId: string, updates: any, userId: string): Promise<any> {
        const docRef = this.collection.doc(projectId).collection('scripts').doc(scriptId);
        await docRef.update({
            ...updates,
            updatedAt: new Date().toISOString()
        });
        const doc = await docRef.get();
        return { id: scriptId, ...doc.data() };
    }

    async deleteScript(projectId: string, scriptId: string, userId: string): Promise<void> {
        await this.collection.doc(projectId).collection('scripts').doc(scriptId).delete();
    }

    // --- Schedules (Firestore) ---
    async getSchedules(projectId: string, userId: string): Promise<any[]> {
        const snapshot = await this.collection.doc(projectId).collection('schedules').get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    async createSchedule(projectId: string, scheduleData: any, userId: string): Promise<any> {
        const id = scheduleData.id || uuidv4();
        const schedule = {
            ...scheduleData,
            id,
            projectId,
            created_at: new Date().toISOString()
        };
        await this.collection.doc(projectId).collection('schedules').doc(id).set(schedule);
        return schedule;
    }

    async deleteSchedule(projectId: string, scheduleId: string, userId: string): Promise<void> {
        await this.collection.doc(projectId).collection('schedules').doc(scheduleId).delete();
    }

    // --- Test Runs (Firestore) ---
    async getTestRuns(projectId: string): Promise<any[]> {
        const snapshot = await this.collection.doc(projectId).collection('test_runs').get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    async getTestRun(projectId: string, runId: string): Promise<any | null> {
        const doc = await this.collection.doc(projectId).collection('test_runs').doc(runId).get();
        if (!doc.exists) return null;
        return { id: doc.id, ...doc.data() };
    }

    async createTestRun(projectId: string, runData: any): Promise<any> {
        const id = runData.id || uuidv4();
        const run = {
            ...runData,
            id,
            projectId,
            logs: [] // Embed logs? Or Subcollection? Embed is fine for simple logs.
        };
        await this.collection.doc(projectId).collection('test_runs').doc(id).set(run);
        return run;
    }

    async updateTestRun(projectId: string, runId: string, updates: any): Promise<void> {
        await this.collection.doc(projectId).collection('test_runs').doc(runId).update(updates);
    }

    async deleteTestRun(projectId: string, runId: string): Promise<void> {
        await this.collection.doc(projectId).collection('test_runs').doc(runId).delete();
    }

    async addTestLog(projectId: string, runId: string, logEntry: any): Promise<void> {
        const docRef = this.collection.doc(projectId).collection('test_runs').doc(runId);
        const doc = await docRef.get();
        if (doc.exists) {
            const data = doc.data();
            const logs = data?.logs || [];
            logs.push(logEntry);
            await docRef.update({ logs });
        }
    }
    // --- File System Nodes (Firestore) ---
    async getFSNodes(projectId: string, userId: string): Promise<any[]> {
        const snapshot = await this.collection.doc(projectId).collection('fs_nodes').get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    async createFSNode(projectId: string, nodeData: any, userId: string): Promise<any> {
        // Use provided ID if available (for sync) or generate new
        const id = nodeData.id || uuidv4();
        const node = {
            ...nodeData,
            id,
            projectId,
            // Ensure fields match types.ts
            // parent_id handled by caller mapping to nodeData
        };
        await this.collection.doc(projectId).collection('fs_nodes').doc(id).set(node);
        console.log(`[ProjectService] 📂 Created FS Node: ${node.name} (${node.type}) [ID: ${id}]`);
        return node;
    }

    async updateFSNode(projectId: string, nodeId: string, updates: any, userId: string): Promise<void> {
        await this.collection.doc(projectId).collection('fs_nodes').doc(nodeId).update(updates);
    }

    async deleteFSNode(projectId: string, nodeId: string, userId: string): Promise<void> {
        console.log(`[ProjectService] 🗑️ Deleting FS Node: ${nodeId} from Project: ${projectId}`);
        await this.collection.doc(projectId).collection('fs_nodes').doc(nodeId).delete();
    }

    // --- Global Lookups (Collection Group Queries) ---
    // Firestore allows querying across all collections with same ID

    async findTestRunById(runId: string): Promise<{ run: any, logs: any[], projectId: string } | null> {
        try {
            // Since we store logs in the run doc, we just need the run
            // We use collectionGroup query to find the run regardless of project
            const snapshot = await db.collectionGroup('test_runs').where('id', '==', runId).get();
            if (snapshot.empty) return null;

            const doc = snapshot.docs[0];
            const data = doc.data();

            // Safety check for parent
            if (!doc.ref.parent.parent) {
                console.warn(`[ProjectService] Run ${runId} has no parent project`);
                return null;
            }

            const projectId = doc.ref.parent.parent.id;

            return { run: { id: doc.id, ...data }, logs: data.logs || [], projectId };
        } catch (error) {
            console.error('[ProjectService] findTestRunById error:', error);
            // Return null instead of throwing to avoid 500 if index missing or other issue
            return null;
        }
    }
}

export const projectService = new ProjectService();
