import { sqliteDb, isSQLiteAvailable } from './DatabaseService';
import { logger } from '../../lib/logger';

/**
 * SQLiteProjectService
 *
 * Fast primary local layer using SQLite.
 * Same public method signatures as LocalProjectService so it can
 * be dropped in transparently in UnifiedProjectService.
 *
 * If SQLite is unavailable, methods throw — UnifiedProjectService
 * catches and falls back to JSON/Firebase.
 */

function requireDb() {
    if (!isSQLiteAvailable() || !sqliteDb) {
        throw new Error('[SQLite] Database not available');
    }
    return sqliteDb;
}

function now() {
    return new Date().toISOString();
}

function shortId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 10; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

// ── Helpers: convert DB row ↔ API shape ───────────────────────────────────────

function rowToProject(row: any) {
    return {
        id: row.id,
        name: row.name,
        description: row.description ?? '',
        platformType: row.platform_type ?? 'web',
        orgId: row.org_id ?? null,
        user_id: row.user_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function rowToOrg(row: any) {
    return {
        id: row.id,
        name: row.name,
        description: row.description ?? '',
        email: row.email ?? '',
        website: row.website ?? '',
        location: row.location ?? '',
        phone: row.phone ?? '',
        industry: row.industry ?? '',
        logoUrl: row.logo_url ?? '',
        coverFrom: row.cover_from ?? '',
        coverTo: row.cover_to ?? '',
        user_id: row.user_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

// ── PROJECT CRUD ──────────────────────────────────────────────────────────────

export async function sql_getAllProjects(userId: string) {
    const db = requireDb();
    const rows = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC').all(userId);
    return rows.map(rowToProject);
}

export async function sql_getProjectById(id: string, userId: string) {
    const db = requireDb();
    const row = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, userId);
    return row ? rowToProject(row) : null;
}

export async function sql_createProject(
    name: string,
    description: string,
    userId: string,
    orgId?: string,
    platformType: string = 'web',
    id?: string
) {
    const db = requireDb();
    const newId = id || shortId();
    const t = now();

    db.prepare(`
        INSERT OR IGNORE INTO projects (id, name, description, platform_type, org_id, user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(newId, name, description, platformType, orgId ?? null, userId, t, t);

    return sql_getProjectById(newId, userId);
}

export async function sql_updateProject(id: string, updates: Record<string, any>, userId: string) {
    const db = requireDb();
    const t = now();

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
    if (updates.platformType !== undefined) { fields.push('platform_type = ?'); values.push(updates.platformType); }
    if (updates.orgId !== undefined) { fields.push('org_id = ?'); values.push(updates.orgId ?? null); }

    if (fields.length === 0) throw new Error('No fields to update');

    fields.push('updated_at = ?');
    values.push(t, id, userId);

    db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);

    return sql_getProjectById(id, userId);
}

export async function sql_deleteProject(id: string, userId: string) {
    const db = requireDb();
    // CASCADE will delete bugs, test_cases, scripts etc.
    db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, userId);
}

// ── ORGANIZATION CRUD ─────────────────────────────────────────────────────────

export async function sql_getAllOrgs(userId: string) {
    const db = requireDb();
    const rows = db.prepare('SELECT * FROM organizations WHERE user_id = ? ORDER BY updated_at DESC').all(userId);
    return rows.map(rowToOrg);
}

export async function sql_getOrgById(id: string, userId: string) {
    const db = requireDb();
    const row = db.prepare('SELECT * FROM organizations WHERE id = ? AND user_id = ?').get(id, userId);
    return row ? rowToOrg(row) : null;
}

export async function sql_createOrg(data: any, userId: string) {
    const db = requireDb();
    const newId = data.id || shortId();
    const t = now();

    db.prepare(`
        INSERT OR IGNORE INTO organizations
        (id, name, description, email, website, location, phone, industry, logo_url, cover_from, cover_to, user_id, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
        newId, data.name ?? '', data.description ?? '',
        data.email ?? '', data.website ?? '', data.location ?? '',
        data.phone ?? '', data.industry ?? '', data.logoUrl ?? '',
        data.coverFrom ?? '', data.coverTo ?? '',
        userId, t, t
    );

    return sql_getOrgById(newId, userId);
}

export async function sql_updateOrg(id: string, data: any, userId: string) {
    const db = requireDb();
    const t = now();

    db.prepare(`
        UPDATE organizations SET
            name=?, description=?, email=?, website=?, location=?,
            phone=?, industry=?, logo_url=?, cover_from=?, cover_to=?, updated_at=?
        WHERE id = ? AND user_id = ?
    `).run(
        data.name ?? '', data.description ?? '',
        data.email ?? '', data.website ?? '', data.location ?? '',
        data.phone ?? '', data.industry ?? '', data.logoUrl ?? '',
        data.coverFrom ?? '', data.coverTo ?? '',
        t, id, userId
    );

    return sql_getOrgById(id, userId);
}

export async function sql_deleteOrg(id: string, userId: string) {
    const db = requireDb();
    db.prepare('DELETE FROM organizations WHERE id = ? AND user_id = ?').run(id, userId);
}

// ── DAILY DATA (bugs + test cases embedded per date) ─────────────────────────
// The existing API uses dailyData shape: { date, bugs: [...], testCases: [...] }
// We store bugs and test_cases in their own tables but expose the same API shape.

export async function sql_getDailyData(projectId: string, userId: string, date?: string) {
    const db = requireDb();

    // Get unique dates for this project
    let dateQuery = date
        ? `SELECT DISTINCT date FROM bugs WHERE project_id = ? AND date = ?
           UNION
           SELECT DISTINCT date FROM test_cases WHERE project_id = ? AND date = ?`
        : `SELECT DISTINCT date FROM bugs WHERE project_id = ?
           UNION
           SELECT DISTINCT date FROM test_cases WHERE project_id = ?`;

    const dateRows: any[] = date
        ? db.prepare(dateQuery).all(projectId, date, projectId, date)
        : db.prepare(dateQuery).all(projectId, projectId);

    return dateRows.map(({ date: d }: any) => {
        const bugs = db.prepare('SELECT * FROM bugs WHERE project_id = ? AND date = ?').all(projectId, d)
            .map((r: any) => ({ ...JSON.parse(r.extra_json || '{}'), id: r.id, bugId: r.bug_id, title: r.title, description: r.description, module: r.module, status: r.status, severity: r.severity, priority: r.priority, reporter: r.reporter, assignee: r.assignee, createdAt: r.created_at, updatedAt: r.updated_at }));

        const testCases = db.prepare('SELECT * FROM test_cases WHERE project_id = ? AND date = ?').all(projectId, d)
            .map((r: any) => ({ ...JSON.parse(r.extra_json || '{}'), id: r.id, testCaseId: r.test_case_id, testScenario: r.test_scenario, testCaseDescription: r.test_case_description, module: r.module, status: r.status, preRequisites: r.pre_requisites, testSteps: r.test_steps, testData: r.test_data, expectedResult: r.expected_result, actualResult: r.actual_result, comments: r.comments, createdAt: r.created_at, updatedAt: r.updated_at }));

        return { date: d, bugs, testCases };
    });
}

export async function sql_updateDailyData(projectId: string, date: string, updates: any, userId: string) {
    const db = requireDb();
    const t = now();

    // ── FK Safety: ensure the project row exists before writing child rows ──
    // This handles the case where migration hasn't run yet or a project was
    // created before SQLite was added. Without this, all bug/TC writes fail
    // with "FOREIGN KEY constraint failed".
    const projectExists = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!projectExists) {
        db.prepare(`
            INSERT OR IGNORE INTO projects (id, name, description, platform_type, org_id, user_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(projectId, 'Unknown Project', '', 'web', null, userId, t, t);
    }

    // Save bugs
    if (Array.isArray(updates.bugs)) {
        db.prepare('DELETE FROM bugs WHERE project_id = ? AND date = ?').run(projectId, date);
        const insert = db.prepare(`
            INSERT OR REPLACE INTO bugs
            (id, project_id, date, bug_id, title, description, module, status, severity, priority, reporter, assignee, created_at, updated_at, extra_json)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `);
        for (const bug of updates.bugs) {
            insert.run(
                bug.id || shortId(), projectId, date,
                bug.bugId ?? '', bug.title ?? '', bug.description ?? '',
                bug.module ?? '', bug.status ?? 'open', bug.severity ?? 'medium',
                bug.priority ?? 'medium', bug.reporter ?? '', bug.assignee ?? '',
                bug.createdAt ?? t, bug.updatedAt ?? t,
                JSON.stringify({ ...bug })
            );
        }
    }

    // Save test cases
    if (Array.isArray(updates.testCases)) {
        db.prepare('DELETE FROM test_cases WHERE project_id = ? AND date = ?').run(projectId, date);
        const insert = db.prepare(`
            INSERT OR REPLACE INTO test_cases
            (id, project_id, date, test_case_id, test_scenario, test_case_description, module, status, pre_requisites, test_steps, test_data, expected_result, actual_result, comments, created_at, updated_at, extra_json)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `);
        for (const tc of updates.testCases) {
            insert.run(
                tc.id || shortId(), projectId, date,
                tc.testCaseId ?? '', tc.testScenario ?? '', tc.testCaseDescription ?? '',
                tc.module ?? '', tc.status ?? 'Not Executed', tc.preRequisites ?? '',
                tc.testSteps ?? '', tc.testData ?? '', tc.expectedResult ?? '',
                tc.actualResult ?? '', tc.comments ?? '',
                tc.createdAt ?? t, tc.updatedAt ?? t,
                JSON.stringify({ ...tc })
            );
        }
    }

    const results = await sql_getDailyData(projectId, userId, date);
    return results[0] ?? { date, bugs: [], testCases: [] };
}


// ── SCRIPTS ───────────────────────────────────────────────────────────────────

export async function sql_getScripts(projectId: string) {
    const db = requireDb();
    return db.prepare('SELECT * FROM scripts WHERE project_id = ? ORDER BY updated_at DESC').all(projectId)
        .map((r: any) => ({ id: r.id, projectId: r.project_id, name: r.name, content: r.content, language: r.language, createdAt: r.created_at, updatedAt: r.updated_at, ...JSON.parse(r.extra_json || '{}') }));
}

export async function sql_createScript(projectId: string, data: any) {
    const db = requireDb();
    const id = data.id || shortId();
    const t = now();
    db.prepare('INSERT OR IGNORE INTO scripts (id, project_id, name, content, language, created_at, updated_at, extra_json) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, projectId, data.name ?? '', data.content ?? '', data.language ?? 'typescript', t, t, JSON.stringify(data));
    return (await sql_getScripts(projectId)).find((s: any) => s.id === id);
}

export async function sql_updateScript(projectId: string, scriptId: string, updates: any) {
    const db = requireDb();
    const t = now();
    db.prepare('UPDATE scripts SET name=?, content=?, language=?, updated_at=?, extra_json=? WHERE id=? AND project_id=?')
        .run(updates.name ?? '', updates.content ?? '', updates.language ?? 'typescript', t, JSON.stringify(updates), scriptId, projectId);
    return (await sql_getScripts(projectId)).find((s: any) => s.id === scriptId);
}

export async function sql_deleteScript(projectId: string, scriptId: string) {
    const db = requireDb();
    db.prepare('DELETE FROM scripts WHERE id=? AND project_id=?').run(scriptId, projectId);
}

// ── TEST RUNS ─────────────────────────────────────────────────────────────────

export async function sql_getTestRuns(projectId: string) {
    const db = requireDb();
    return db.prepare('SELECT * FROM test_runs WHERE project_id = ? ORDER BY started_at DESC').all(projectId)
        .map((r: any) => ({ id: r.id, projectId: r.project_id, scriptId: r.script_id, status: r.status, logs: JSON.parse(r.logs || '[]'), startedAt: r.started_at, finishedAt: r.finished_at, ...JSON.parse(r.extra_json || '{}') }));
}

export async function sql_createTestRun(projectId: string, data: any) {
    const db = requireDb();
    const id = data.id || shortId();
    const t = now();
    db.prepare('INSERT OR IGNORE INTO test_runs (id, project_id, script_id, status, logs, started_at, finished_at, extra_json) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, projectId, data.scriptId ?? null, data.status ?? 'pending', JSON.stringify(data.logs ?? []), data.startedAt ?? t, data.finishedAt ?? null, JSON.stringify(data));
    return (await sql_getTestRuns(projectId)).find((r: any) => r.id === id);
}

export async function sql_updateTestRun(projectId: string, runId: string, updates: any) {
    const db = requireDb();
    const existing = (await sql_getTestRuns(projectId)).find((r: any) => r.id === runId);
    db.prepare('UPDATE test_runs SET status=?, logs=?, finished_at=?, extra_json=? WHERE id=? AND project_id=?')
        .run(updates.status ?? existing?.status, JSON.stringify(updates.logs ?? existing?.logs ?? []), updates.finishedAt ?? existing?.finishedAt ?? null, JSON.stringify({ ...existing, ...updates }), runId, projectId);
}

export async function sql_deleteTestRun(projectId: string, runId: string) {
    const db = requireDb();
    db.prepare('DELETE FROM test_runs WHERE id=? AND project_id=?').run(runId, projectId);
}

// ── PAGES ─────────────────────────────────────────────────────────────────────

export async function sql_getPages(projectId: string) {
    const db = requireDb();
    return db.prepare('SELECT * FROM pages WHERE project_id = ?').all(projectId)
        .map((r: any) => ({ id: r.id, projectId: r.project_id, name: r.name, date: r.date, ...JSON.parse(r.extra_json || '{}') }));
}

export async function sql_createPage(projectId: string, data: any) {
    const db = requireDb();
    const id = data.id || shortId();
    db.prepare('INSERT OR IGNORE INTO pages (id, project_id, name, date, extra_json) VALUES (?,?,?,?,?)')
        .run(id, projectId, data.name ?? '', data.date ?? '', JSON.stringify(data));
    return (await sql_getPages(projectId)).find((p: any) => p.id === id);
}

export async function sql_deletePage(projectId: string, pageId: string) {
    const db = requireDb();
    db.prepare('DELETE FROM pages WHERE id=? AND project_id=?').run(pageId, projectId);
    // Also remove daily data for that date
    const page = db.prepare('SELECT date FROM pages WHERE id=?').get(pageId) as any;
    if (page?.date) {
        db.prepare('DELETE FROM bugs WHERE project_id=? AND date=?').run(projectId, page.date);
        db.prepare('DELETE FROM test_cases WHERE project_id=? AND date=?').run(projectId, page.date);
    }
}

// ── API COLLECTIONS ───────────────────────────────────────────────────────────

export async function sql_getApiCollections(projectId: string) {
    const db = requireDb();
    return db.prepare('SELECT * FROM api_collections WHERE project_id = ?').all(projectId)
        .map((r: any) => ({ ...JSON.parse(r.data_json || '{}'), id: r.id, projectId: r.project_id }));
}

export async function sql_saveApiCollection(projectId: string, collection: any) {
    const db = requireDb();
    const id = collection.id || shortId();
    const t = now();
    db.prepare(`
        INSERT INTO api_collections (id, project_id, name, data_json, created_at, updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, data_json=excluded.data_json, updated_at=excluded.updated_at
    `).run(id, projectId, collection.name ?? '', JSON.stringify(collection), t, t);
    return { ...collection, id, projectId };
}

export async function sql_deleteApiCollection(projectId: string, collectionId: string) {
    const db = requireDb();
    db.prepare('DELETE FROM api_collections WHERE id=? AND project_id=?').run(collectionId, projectId);
}
