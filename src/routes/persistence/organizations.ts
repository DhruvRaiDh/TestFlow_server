import { Router } from 'express';
import { unifiedOrganizationService as orgService } from '../../services/persistence/UnifiedOrganizationService';

const router = Router();

// GET /api/organizations — list all for authenticated user
router.get('/', async (req, res) => {
    try {
        const userId = (req as any).user?.uid;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const orgs = await orgService.getAllOrganizations(userId);
        res.json(orgs);
    } catch (error) {
        console.error('[Orgs] GET / error:', error);
        res.status(500).json({ error: 'Failed to load organizations' });
    }
});

// POST /api/organizations — create new organization
router.post('/', async (req, res) => {
    try {
        const userId = (req as any).user?.uid;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { name, description, logoUrl, email, website, industry, location } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'Organization name is required' });

        const org = await orgService.createOrganization(
            { name, description, logoUrl, email, website, industry, location, user_id: userId },
            userId
        );
        res.status(201).json(org);
    } catch (error) {
        console.error('[Orgs] POST / error:', error);
        res.status(500).json({ error: 'Failed to create organization' });
    }
});

// PUT /api/organizations/:id — update organization
router.put('/:id', async (req, res) => {
    try {
        const userId = (req as any).user?.uid;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { id } = req.params;
        const { name, description, logoUrl, email, website, industry, location } = req.body;

        const updated = await orgService.updateOrganization(
            id,
            { name, description, logoUrl, email, website, industry, location },
            userId
        );
        if (!updated) return res.status(404).json({ error: 'Organization not found' });
        res.json(updated);
    } catch (error) {
        console.error('[Orgs] PUT /:id error:', error);
        res.status(500).json({ error: 'Failed to update organization' });
    }
});

// DELETE /api/organizations/:id
// NOTE: Does NOT delete projects — they become "Unassigned" (orgId cleared on the frontend)
router.delete('/:id', async (req, res) => {
    try {
        const userId = (req as any).user?.uid;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { id } = req.params;
        await orgService.deleteOrganization(id, userId);
        res.status(204).send();
    } catch (error) {
        console.error('[Orgs] DELETE /:id error:', error);
        res.status(500).json({ error: 'Failed to delete organization' });
    }
});

export { router as organizationRoutes };
