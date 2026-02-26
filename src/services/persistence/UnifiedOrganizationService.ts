import { organizationService as remoteService } from './OrganizationService';
import { organizationModel as localModel, Organization } from '../../models/Organization';

/**
 * UnifiedOrganizationService — Local-first, background Firebase sync.
 *
 * Same pattern as UnifiedProjectService:
 *  - Reads: local JSON first (fast), background pull from Firestore
 *  - Writes: local immediately, background push to Firestore
 *  - Sync: bidirectional (pull missing from remote, push missing to remote)
 */
export class UnifiedOrganizationService {

    // ── Reads (Local First) ──────────────────────────────────────────────────

    async getAllOrganizations(userId: string): Promise<Organization[]> {
        const local = await localModel.findAll(userId);
        // Background sync — never blocks the response
        this.syncUserOrganizations(userId).catch(e =>
            console.error('[UnifiedOrg] Background Sync Error:', e)
        );
        return local;
    }

    async getOrganizationById(id: string, userId: string): Promise<Organization | null> {
        const local = await localModel.findById(id, userId);
        if (local) return local;

        // Fallback to Firestore (fresh install / another device)
        console.log(`[UnifiedOrg] Org ${id} not found locally, fetching from remote...`);
        const remote = await remoteService.getOrganizationById(id, userId);
        if (remote) {
            await localModel.create({ ...remote, user_id: userId });
        }
        return remote;
    }

    // ── Writes (Local First + Background Firebase) ───────────────────────────

    async createOrganization(
        orgData: Omit<Organization, 'id' | 'createdAt' | 'updatedAt'>,
        userId: string
    ): Promise<Organization> {
        // 1. Write locally (immediate response)
        const org = await localModel.create({ ...orgData, user_id: userId });

        // 2. Background push to Firestore
        remoteService.createOrganization(orgData, userId, org.id).catch(e =>
            console.error('[UnifiedOrg] Remote Create Failed:', e)
        );

        return org;
    }

    async updateOrganization(
        id: string,
        updates: Partial<Organization>,
        userId: string
    ): Promise<Organization | null> {
        const org = await localModel.update(id, updates, userId);
        if (org) {
            remoteService.updateOrganization(id, updates, userId).catch(e =>
                console.error('[UnifiedOrg] Remote Update Failed:', e)
            );
        }
        return org;
    }

    async deleteOrganization(id: string, userId: string): Promise<void> {
        await localModel.delete(id, userId);
        remoteService.deleteOrganization(id, userId).catch(e =>
            console.error('[UnifiedOrg] Remote Delete Failed:', e)
        );
    }

    // ── Bidirectional Sync (Background) ─────────────────────────────────────

    async syncUserOrganizations(userId: string): Promise<void> {
        console.log(`[UnifiedOrg] Starting sync for user: ${userId}`);
        try {
            const [remoteOrgs, localOrgs] = await Promise.all([
                remoteService.getAllOrganizations(userId),
                localModel.findAll(userId),
            ]);

            // Pull: remote → local (missing on this machine)
            for (const rOrg of remoteOrgs) {
                if (!localOrgs.find(o => o.id === rOrg.id)) {
                    console.log(`[UnifiedOrg] Pulling remote org to local: ${rOrg.name}`);
                    await localModel.create({ ...rOrg, user_id: userId });
                }
            }

            // Push: local → remote (missing in Firestore)
            for (const lOrg of localOrgs) {
                if (!remoteOrgs.find(o => o.id === lOrg.id)) {
                    console.log(`[UnifiedOrg] Pushing local org to remote: ${lOrg.name}`);
                    await remoteService.createOrganization(lOrg, userId, lOrg.id);
                }
            }

            console.log('[UnifiedOrg] Sync complete');
        } catch (error) {
            console.error('[UnifiedOrg] Sync Failed:', error);
        }
    }
}

export const unifiedOrganizationService = new UnifiedOrganizationService();
