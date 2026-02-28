import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../lib/logger';

export interface Organization {
    id: string;
    name: string;
    description: string;
    user_id?: string;
    logoUrl?: string;
    email?: string;
    website?: string;
    industry?: string;
    location?: string;
    phone?: string;
    coverFrom?: string;
    coverTo?: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * OrganizationModel - Data Access Layer
 *
 * Stores organizations in data/organizations.json (same pattern as projects.json).
 * Organizations are folder-level groupings above projects.
 * Projects belong to an org via orgId; projects without orgId are "Unassigned".
 */
export class OrganizationModel {
    private dataDir: string;
    private orgsFile: string;

    constructor() {
        const cwd = process.cwd();
        if (cwd.endsWith('backend') || cwd.endsWith('backend' + path.sep)) {
            this.dataDir = path.join(cwd, 'data');
        } else {
            this.dataDir = path.join(cwd, 'backend', 'data');
        }
        this.orgsFile = path.join(this.dataDir, 'organizations.json');
        logger.debug('OrganizationModel initialized', { dataDir: this.dataDir });
    }

    // ── CRUD ─────────────────────────────────────────────────────────────────

    async findAll(userId: string): Promise<Organization[]> {
        const data = await this.readOrgsFile();
        return data.organizations.filter(o => !userId || o.user_id === userId);
    }

    async findById(orgId: string, userId?: string): Promise<Organization | null> {
        const data = await this.readOrgsFile();
        const org = data.organizations.find(o => o.id === orgId);
        if (!org) return null;
        if (userId && org.user_id !== userId) return null;
        return org;
    }

    async create(orgData: Omit<Organization, 'id' | 'createdAt' | 'updatedAt'>): Promise<Organization> {
        const data = await this.readOrgsFile();
        const newOrg: Organization = {
            id: this.generateShortId(),
            user_id: orgData.user_id,
            name: orgData.name,
            description: orgData.description || '',
            logoUrl: orgData.logoUrl || '',
            email: orgData.email || '',
            website: orgData.website || '',
            industry: orgData.industry || '',
            location: orgData.location || '',
            phone: orgData.phone || '',
            coverFrom: orgData.coverFrom || '',
            coverTo: orgData.coverTo || '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        data.organizations.push(newOrg);
        await this.writeOrgsFile(data);
        logger.info('Organization created', { orgId: newOrg.id, name: newOrg.name });
        return newOrg;
    }

    async update(
        orgId: string,
        updates: Partial<Omit<Organization, 'id' | 'createdAt'>>,
        userId?: string
    ): Promise<Organization | null> {
        const data = await this.readOrgsFile();
        const index = data.organizations.findIndex(o => o.id === orgId);
        if (index === -1) return null;
        if (userId && data.organizations[index].user_id !== userId) return null;

        data.organizations[index] = {
            ...data.organizations[index],
            ...updates,
            updatedAt: new Date().toISOString(),
        };
        await this.writeOrgsFile(data);
        logger.info('Organization updated', { orgId });
        return data.organizations[index];
    }

    /**
     * Delete org. Projects that referenced this orgId become "Unassigned" —
     * callers are responsible for clearing orgId on affected projects.
     */
    async delete(orgId: string, userId?: string): Promise<boolean> {
        const data = await this.readOrgsFile();
        const index = data.organizations.findIndex(o => o.id === orgId);
        if (index === -1) return false;
        if (userId && data.organizations[index].user_id !== userId) return false;

        data.organizations.splice(index, 1);
        await this.writeOrgsFile(data);
        logger.info('Organization deleted', { orgId });
        return true;
    }

    // ── Private Helpers ───────────────────────────────────────────────────────

    private async ensureDataDir(): Promise<void> {
        try { await fs.access(this.dataDir); }
        catch { await fs.mkdir(this.dataDir, { recursive: true }); }
    }

    private async readOrgsFile(): Promise<{ organizations: Organization[] }> {
        await this.ensureDataDir();
        try {
            const raw = await fs.readFile(this.orgsFile, 'utf-8');
            return JSON.parse(raw);
        } catch (error: unknown) {
            if (error instanceof Error && 'code' in error && (error as any).code === 'ENOENT') {
                return { organizations: [] };
            }
            throw error;
        }
    }

    private async writeOrgsFile(data: { organizations: Organization[] }): Promise<void> {
        await this.ensureDataDir();
        await fs.writeFile(this.orgsFile, JSON.stringify(data, null, 2));
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
}

export const organizationModel = new OrganizationModel();
