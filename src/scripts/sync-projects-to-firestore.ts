/**
 * sync-projects-to-firestore.ts
 * 
 * ONE-TIME SCRIPT: Overwrites Firestore 'projects' collection with normalized
 * data from backend/data/projects.json.
 * 
 * Run from backend/ directory:
 *   npx ts-node src/scripts/sync-projects-to-firestore.ts
 * 
 * What it does:
 *  1. Reads the canonical local projects.json
 *  2. For each project, does a Firestore SET (overwrite) with the clean structure
 *  3. Deletes any Firestore docs that are NOT in the local file (orphan cleanup)
 *  4. Logs every action taken
 */

import path from 'path';
import * as fs from 'fs/promises';
import * as admin from 'firebase-admin';

// ── Firebase Init ─────────────────────────────────────────────────────────────
const SERVICE_ACCOUNT_PATH = path.join(__dirname, '../../service-account.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(SERVICE_ACCOUNT_PATH)
    });
}
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

// ── Types ─────────────────────────────────────────────────────────────────────
interface Project {
    id: string;
    name: string;
    description: string;
    user_id: string;
    orgId?: string | null;
    createdAt: string;
    updatedAt: string;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function syncProjectsToFirestore(): Promise<void> {
    console.log('\n========================================');
    console.log('  Firestore Project Sync — Starting');
    console.log('========================================\n');

    // 1. Read local canonical source
    const dataDir = path.join(__dirname, '../../data');
    const projectsFile = path.join(dataDir, 'projects.json');

    let localProjects: Project[];
    try {
        const raw = await fs.readFile(projectsFile, 'utf-8');
        const parsed = JSON.parse(raw);
        localProjects = parsed.projects;
        console.log(`✅ Loaded ${localProjects.length} projects from ${projectsFile}\n`);
    } catch (err) {
        console.error('❌ Failed to read projects.json:', err);
        process.exit(1);
    }

    const collection = db.collection('projects');

    // 2. Overwrite each local project into Firestore (normalized structure)
    let written = 0;
    for (const project of localProjects) {
        // Build the canonical Firestore document (no userId double-field)
        const firestoreDoc: Record<string, any> = {
            id: project.id,
            name: project.name,
            description: project.description ?? '',
            user_id: project.user_id,
            userId: project.user_id,   // ← Firestore query field (used by OrganizationService pattern)
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
        };

        // Include orgId only if it's set on the local project
        if (project.orgId) {
            firestoreDoc.orgId = project.orgId;
        } else {
            // Explicitly set to null to clear any stale value that might exist in Firestore
            firestoreDoc.orgId = null;
        }

        try {
            await collection.doc(project.id).set(firestoreDoc);
            console.log(`  ✅ SET  [${project.id}]  "${project.name}"  (user: ${project.user_id})`);
            written++;
        } catch (err) {
            console.error(`  ❌ FAILED to set [${project.id}] "${project.name}":`, err);
        }
    }

    // 3. Find and delete Firestore docs NOT in local data (orphan cleanup)
    console.log('\n📋 Checking for orphaned Firestore docs...');
    const localIds = new Set(localProjects.map(p => p.id));

    // We only look at docs belonging to users in our local data
    const localUserIds = [...new Set(localProjects.map(p => p.user_id))];

    let deleted = 0;
    for (const uid of localUserIds) {
        const snapshot = await collection.where('userId', '==', uid).get();
        for (const doc of snapshot.docs) {
            if (!localIds.has(doc.id)) {
                console.log(`  🗑️  DELETING orphan [${doc.id}] "${doc.data().name}" (not in local data)`);
                await doc.ref.delete();
                deleted++;
            }
        }
    }

    // 4. Summary
    console.log('\n========================================');
    console.log(`  Sync Complete`);
    console.log(`  Written : ${written}`);
    console.log(`  Deleted : ${deleted} orphans`);
    console.log('========================================\n');

    process.exit(0);
}

syncProjectsToFirestore().catch(err => {
    console.error('[Sync] Unhandled error:', err);
    process.exit(1);
});
