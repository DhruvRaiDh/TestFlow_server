import { db } from '../../lib/firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import { Organization } from '../../models/Organization';

/**
 * OrganizationService - Firestore CRUD
 *
 * Mirrors ProjectService.ts pattern exactly.
 * Used by UnifiedOrganizationService as the remote (cloud) data source.
 */
export class OrganizationService {
    public collection = db.collection('organizations');

    async getAllOrganizations(userId: string): Promise<Organization[]> {
        try {
            const snapshot = await this.collection.where('userId', '==', userId).get();
            return snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    createdAt: data.createdAt || new Date().toISOString(),
                    updatedAt: data.updatedAt || new Date().toISOString(),
                } as Organization;
            });
        } catch (error) {
            console.error('[Firestore] getAllOrganizations error:', error);
            return []; // Graceful fallback — local is primary source
        }
    }

    async getOrganizationById(id: string, userId: string): Promise<Organization | null> {
        try {
            const doc = await this.collection.doc(id).get();
            if (!doc.exists) return null;
            const data = doc.data() as any;
            if (data.userId !== userId && data.user_id !== userId) return null;
            return { id: doc.id, ...data } as Organization;
        } catch (error) {
            console.error('[Firestore] getOrganizationById error:', error);
            return null;
        }
    }

    async createOrganization(
        orgData: Omit<Organization, 'id' | 'createdAt' | 'updatedAt'>,
        userId: string,
        id?: string
    ): Promise<Organization> {
        const orgId = id || uuidv4();
        const now = new Date().toISOString();
        const org: Organization = {
            id: orgId,
            user_id: userId,
            name: orgData.name,
            description: orgData.description || '',
            logoUrl: orgData.logoUrl || '',
            email: orgData.email || '',
            website: orgData.website || '',
            industry: orgData.industry || '',
            location: orgData.location || '',
            createdAt: now,
            updatedAt: now,
        };
        // Store with userId field (Firestore query field) as a plain object
        await this.collection.doc(orgId).set({ ...org, userId });
        return org;
    }

    async updateOrganization(
        id: string,
        updates: Partial<Organization>,
        userId: string
    ): Promise<Organization | null> {
        try {
            const docRef = this.collection.doc(id);
            const doc = await docRef.get();
            if (!doc.exists) return null;
            const data = doc.data() as any;
            if (data.userId !== userId && data.user_id !== userId) return null;

            const updatedData = { ...updates, updatedAt: new Date().toISOString() };
            await docRef.update(updatedData);
            return { ...data, ...updatedData, id } as Organization;
        } catch (error) {
            console.error('[Firestore] updateOrganization error:', error);
            return null;
        }
    }

    async deleteOrganization(id: string, userId: string): Promise<void> {
        try {
            const docRef = this.collection.doc(id);
            const doc = await docRef.get();
            if (!doc.exists) return;
            const data = doc.data() as any;
            if (data.userId !== userId && data.user_id !== userId) return;
            await docRef.delete();
        } catch (error) {
            console.error('[Firestore] deleteOrganization error:', error);
        }
    }
}

export const organizationService = new OrganizationService();
