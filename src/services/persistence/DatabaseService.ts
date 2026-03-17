import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { logger } from '../../lib/logger';

/**
 * DatabaseService — SQLite local database
 *
 * Database location: Documents/TestFlow/testflow.db
 * This is the fast primary local layer. If it fails, the app
 * falls back to the existing JSON + Firebase layers.
 */

function getDbPath(): string {
    // Resolve user's Documents folder cross-platform
    const home = os.homedir();
    let documentsDir: string;

    if (process.platform === 'win32') {
        // Windows: typically C:\Users\{user}\Documents
        documentsDir = path.join(home, 'Documents');
    } else if (process.platform === 'darwin') {
        // macOS: ~/Documents
        documentsDir = path.join(home, 'Documents');
    } else {
        // Linux: use ~/.local/share as Documents equivalent
        documentsDir = path.join(home, '.local', 'share');
    }

    const appDir = path.join(documentsDir, 'TestFlow');

    // Create directory if it doesn't exist
    if (!fs.existsSync(appDir)) {
        fs.mkdirSync(appDir, { recursive: true });
        logger.info(`[SQLite] Created TestFlow directory at: ${appDir}`);
    }

    return path.join(appDir, 'testflow.db');
}

function createDatabase(): Database.Database | null {
    try {
        const dbPath = getDbPath();
        logger.info(`[SQLite] Opening database at: ${dbPath}`);

        const db = new Database(dbPath);

        // Enable WAL mode for better concurrent read performance
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');

        // Create all tables
        db.exec(`
            -- ── Core entities ─────────────────────────────────────────
            CREATE TABLE IF NOT EXISTS organizations (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                description TEXT DEFAULT '',
                email       TEXT DEFAULT '',
                website     TEXT DEFAULT '',
                location    TEXT DEFAULT '',
                phone       TEXT DEFAULT '',
                industry    TEXT DEFAULT '',
                logo_url    TEXT DEFAULT '',
                cover_from  TEXT DEFAULT '',
                cover_to    TEXT DEFAULT '',
                user_id     TEXT,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS projects (
                id            TEXT PRIMARY KEY,
                name          TEXT NOT NULL,
                description   TEXT DEFAULT '',
                platform_type TEXT DEFAULT 'web',
                org_id        TEXT,
                user_id       TEXT,
                created_at    TEXT NOT NULL,
                updated_at    TEXT NOT NULL,
                FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL
            );

            -- ── Project data ───────────────────────────────────────────
            CREATE TABLE IF NOT EXISTS bugs (
                id          TEXT PRIMARY KEY,
                project_id  TEXT NOT NULL,
                date        TEXT NOT NULL,
                bug_id      TEXT,
                title       TEXT DEFAULT '',
                description TEXT DEFAULT '',
                module      TEXT DEFAULT '',
                status      TEXT DEFAULT 'open',
                severity    TEXT DEFAULT 'medium',
                priority    TEXT DEFAULT 'medium',
                reporter    TEXT DEFAULT '',
                assignee    TEXT DEFAULT '',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                extra_json  TEXT DEFAULT '{}',
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS test_cases (
                id                    TEXT PRIMARY KEY,
                project_id            TEXT NOT NULL,
                date                  TEXT NOT NULL,
                test_case_id          TEXT,
                test_scenario         TEXT DEFAULT '',
                test_case_description TEXT DEFAULT '',
                module                TEXT DEFAULT '',
                status                TEXT DEFAULT 'Not Executed',
                pre_requisites        TEXT DEFAULT '',
                test_steps            TEXT DEFAULT '',
                test_data             TEXT DEFAULT '',
                expected_result       TEXT DEFAULT '',
                actual_result         TEXT DEFAULT '',
                comments              TEXT DEFAULT '',
                created_at            TEXT NOT NULL,
                updated_at            TEXT NOT NULL,
                extra_json            TEXT DEFAULT '{}',
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS scripts (
                id          TEXT PRIMARY KEY,
                project_id  TEXT NOT NULL,
                name        TEXT DEFAULT '',
                content     TEXT DEFAULT '',
                language    TEXT DEFAULT 'typescript',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                extra_json  TEXT DEFAULT '{}',
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS test_runs (
                id          TEXT PRIMARY KEY,
                project_id  TEXT NOT NULL,
                script_id   TEXT,
                status      TEXT DEFAULT 'pending',
                logs        TEXT DEFAULT '[]',
                started_at  TEXT,
                finished_at TEXT,
                extra_json  TEXT DEFAULT '{}',
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS pages (
                id         TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name       TEXT DEFAULT '',
                date       TEXT DEFAULT '',
                extra_json TEXT DEFAULT '{}',
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS schedules (
                id         TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                script_id  TEXT,
                cron       TEXT DEFAULT '',
                is_active  INTEGER DEFAULT 1,
                created_at TEXT NOT NULL,
                extra_json TEXT DEFAULT '{}',
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS api_collections (
                id         TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name       TEXT DEFAULT '',
                data_json  TEXT DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS visual_tests (
                id         TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                data_json  TEXT DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS fs_nodes (
                id         TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                data_json  TEXT DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS datasets (
                id         TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                data_json  TEXT DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            -- ── Indexes for common queries ──────────────────────────────
            CREATE INDEX IF NOT EXISTS idx_projects_user       ON projects(user_id);
            CREATE INDEX IF NOT EXISTS idx_projects_org        ON projects(org_id);
            CREATE INDEX IF NOT EXISTS idx_bugs_project        ON bugs(project_id);
            CREATE INDEX IF NOT EXISTS idx_bugs_date           ON bugs(project_id, date);
            CREATE INDEX IF NOT EXISTS idx_testcases_project   ON test_cases(project_id);
            CREATE INDEX IF NOT EXISTS idx_testcases_date      ON test_cases(project_id, date);
            CREATE INDEX IF NOT EXISTS idx_scripts_project     ON scripts(project_id);
            CREATE INDEX IF NOT EXISTS idx_testruns_project    ON test_runs(project_id);
            CREATE INDEX IF NOT EXISTS idx_pages_project       ON pages(project_id);
        `);

        logger.info('[SQLite] Database initialized successfully');
        return db;

    } catch (error) {
        logger.error('[SQLite] Failed to initialize database — falling back to JSON/Firebase', error as Error);
        return null;
    }
}

// Singleton instance — null means SQLite is unavailable (fallback to other layers)
export const sqliteDb: Database.Database | null = createDatabase();
export const isSQLiteAvailable = (): boolean => sqliteDb !== null;
