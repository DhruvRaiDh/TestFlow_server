import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { sqliteDb, isSQLiteAvailable } from '../services/persistence/DatabaseService';
import { logger } from '../lib/logger';

/**
 * migrate-sqlite.ts
 *
 * One-time migration from legacy JSON files → SQLite.
 * Runs automatically on backend startup.
 * Safe to run multiple times — uses INSERT OR IGNORE so no duplicates.
 */

function getDataDir(): string {
    const cwd = process.cwd();
    if (cwd.endsWith('backend') || cwd.endsWith('backend' + path.sep)) {
        return path.join(cwd, 'data');
    }
    return path.join(cwd, 'backend', 'data');
}

function readJsonSafe<T>(filePath: string, fallback: T): T {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function now(): string {
    return new Date().toISOString();
}

export async function runMigration(): Promise<void> {
    if (!isSQLiteAvailable() || !sqliteDb) {
        logger.warn('[Migration] SQLite not available — skipping migration');
        return;
    }

    const db = sqliteDb;

    // ── Check if already migrated ──────────────────────────────────────────
    const existingCount = (db.prepare('SELECT COUNT(*) as c FROM projects').get() as any).c;
    if (existingCount > 0) {
        logger.info(`[Migration] SQLite already has ${existingCount} project(s) — skipping migration`);
        return;
    }

    const dataDir = getDataDir();
    if (!fs.existsSync(dataDir)) {
        logger.warn(`[Migration] Data directory not found at ${dataDir} — skipping`);
        return;
    }

    logger.info('[Migration] Starting JSON → SQLite migration...');
    const t = now();

    let projectCount = 0, bugCount = 0, testCaseCount = 0, scriptCount = 0, runCount = 0;

    // ── 1. Migrate organizations ──────────────────────────────────────────
    const orgsFile = path.join(dataDir, 'organizations.json');
    const orgsData = readJsonSafe<{ organizations?: any[] }>(orgsFile, {});
    const orgs: any[] = orgsData.organizations ?? [];

    const insertOrg = db.prepare(`
        INSERT OR IGNORE INTO organizations
        (id, name, description, email, website, location, phone, industry, logo_url, cover_from, cover_to, user_id, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    for (const org of orgs) {
        try {
            insertOrg.run(
                org.id, org.name ?? '', org.description ?? '',
                org.email ?? '', org.website ?? '', org.location ?? '',
                org.phone ?? '', org.industry ?? '', org.logoUrl ?? '',
                org.coverFrom ?? '', org.coverTo ?? '',
                org.user_id ?? org.userId ?? null,
                org.createdAt ?? t, org.updatedAt ?? t
            );
        } catch (e: any) {
            logger.warn(`[Migration] Org ${org.id} skipped: ${e.message}`);
        }
    }

    // ── 2. Migrate projects ───────────────────────────────────────────────
    const projectsFile = path.join(dataDir, 'projects.json');
    const projectsData = readJsonSafe<{ projects?: any[] }>(projectsFile, {});
    const projects: any[] = projectsData.projects ?? [];

    const insertProject = db.prepare(`
        INSERT OR IGNORE INTO projects
        (id, name, description, platform_type, org_id, user_id, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?)
    `);

    for (const proj of projects) {
        try {
            insertProject.run(
                proj.id, proj.name ?? '', proj.description ?? '',
                proj.platformType ?? 'web',
                proj.orgId ?? null,
                proj.user_id ?? proj.userId ?? null,
                proj.createdAt ?? t, proj.updatedAt ?? t
            );
            projectCount++;
        } catch (e: any) {
            logger.warn(`[Migration] Project ${proj.id} skipped: ${e.message}`);
        }
    }

    logger.info(`[Migration] Inserted ${projectCount} projects`);

    // ── 3. Migrate per-project data ───────────────────────────────────────
    const insertBug = db.prepare(`
        INSERT OR IGNORE INTO bugs
        (id, project_id, date, bug_id, title, description, module, status, severity, priority, reporter, assignee, created_at, updated_at, extra_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    const insertTC = db.prepare(`
        INSERT OR IGNORE INTO test_cases
        (id, project_id, date, test_case_id, test_scenario, test_case_description, module, status, pre_requisites, test_steps, test_data, expected_result, actual_result, comments, created_at, updated_at, extra_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    const insertScript = db.prepare(`
        INSERT OR IGNORE INTO scripts
        (id, project_id, name, content, language, created_at, updated_at, extra_json)
        VALUES (?,?,?,?,?,?,?,?)
    `);

    const insertRun = db.prepare(`
        INSERT OR IGNORE INTO test_runs
        (id, project_id, script_id, status, logs, started_at, finished_at, extra_json)
        VALUES (?,?,?,?,?,?,?,?)
    `);

    const insertSchedule = db.prepare(`
        INSERT OR IGNORE INTO schedules
        (id, project_id, script_id, cron, is_active, created_at, extra_json)
        VALUES (?,?,?,?,?,?,?)
    `);

    const insertPage = db.prepare(`
        INSERT OR IGNORE INTO pages
        (id, project_id, name, date, extra_json)
        VALUES (?,?,?,?,?)
    `);

    const insertApiCollection = db.prepare(`
        INSERT OR IGNORE INTO api_collections
        (id, project_id, name, data_json, created_at, updated_at)
        VALUES (?,?,?,?,?,?)
    `);

    const projectsDir = path.join(dataDir, 'projects');
    if (!fs.existsSync(projectsDir)) {
        logger.warn('[Migration] No projects directory found — done');
        return;
    }

    const projectDirs = fs.readdirSync(projectsDir);

    const migrateProject = db.transaction((projectId: string, data: any) => {
        const dailyData: any[] = data.dailyData ?? [];
        for (const day of dailyData) {
            const date = day.date ?? '';

            // Bugs
            for (const bug of (day.bugs ?? [])) {
                try {
                    const bugId = bug.id ?? `bug-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                    insertBug.run(
                        bugId, projectId, date,
                        bug.bugId ?? '', bug.title ?? '', bug.description ?? '',
                        bug.module ?? '', bug.status ?? 'open',
                        bug.severity ?? 'medium', bug.priority ?? 'medium',
                        bug.reporter ?? '', bug.assignee ?? '',
                        bug.createdAt ?? t, bug.updatedAt ?? t,
                        JSON.stringify(bug)
                    );
                    bugCount++;
                } catch { /* skip duplicate */ }
            }

            // Test Cases
            for (const tc of (day.testCases ?? [])) {
                try {
                    const tcId = tc.id ?? `tc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                    insertTC.run(
                        tcId, projectId, date,
                        tc.testCaseId ?? '', tc.testScenario ?? '', tc.testCaseDescription ?? '',
                        tc.module ?? '', tc.status ?? 'Not Executed',
                        tc.preRequisites ?? '', tc.testSteps ?? '', tc.testData ?? '',
                        tc.expectedResult ?? '', tc.actualResult ?? '', tc.comments ?? '',
                        tc.createdAt ?? t, tc.updatedAt ?? t,
                        JSON.stringify(tc)
                    );
                    testCaseCount++;
                } catch { /* skip duplicate */ }
            }
        }

        // Scripts
        for (const script of (data.scripts ?? [])) {
            try {
                insertScript.run(
                    script.id, projectId,
                    script.name ?? '', script.content ?? '',
                    script.language ?? 'typescript',
                    script.createdAt ?? t, script.updatedAt ?? t,
                    JSON.stringify(script)
                );
                scriptCount++;
            } catch { /* skip */ }
        }

        // Test Runs
        for (const run of (data.testRuns ?? [])) {
            try {
                insertRun.run(
                    run.id, projectId,
                    run.scriptId ?? null, run.status ?? 'completed',
                    JSON.stringify(run.logs ?? []),
                    run.startedAt ?? run.createdAt ?? t,
                    run.finishedAt ?? null,
                    JSON.stringify(run)
                );
                runCount++;
            } catch { /* skip */ }
        }

        // Schedules
        for (const schedule of (data.schedules ?? [])) {
            try {
                insertSchedule.run(
                    schedule.id, projectId,
                    schedule.scriptId ?? null, schedule.cron ?? '',
                    schedule.isActive ? 1 : 0,
                    schedule.createdAt ?? t,
                    JSON.stringify(schedule)
                );
            } catch { /* skip */ }
        }

        // Pages
        for (const page of (data.customPages ?? [])) {
            try {
                insertPage.run(
                    page.id, projectId,
                    page.name ?? '', page.date ?? '',
                    JSON.stringify(page)
                );
            } catch { /* skip */ }
        }

        // API Collections
        for (const col of (data.apiCollections ?? [])) {
            try {
                insertApiCollection.run(
                    col.id, projectId,
                    col.name ?? '', JSON.stringify(col),
                    col.createdAt ?? t, col.updatedAt ?? t
                );
            } catch { /* skip */ }
        }
    });

    for (const dirName of projectDirs) {
        const dataFile = path.join(projectsDir, dirName, 'data.json');
        if (!fs.existsSync(dataFile)) continue;

        const data = readJsonSafe<any>(dataFile, {});

        try {
            migrateProject(dirName, data);
        } catch (e: any) {
            logger.warn(`[Migration] Project ${dirName} data migration failed: ${e.message}`);
        }
    }

    logger.info(`[Migration] ✅ Complete — Projects: ${projectCount}, Bugs: ${bugCount}, TestCases: ${testCaseCount}, Scripts: ${scriptCount}, Runs: ${runCount}`);
}
