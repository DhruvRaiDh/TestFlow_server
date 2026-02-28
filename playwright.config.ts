import { defineConfig } from '@playwright/test';

/**
 * Playwright config used by CodeExecutorService when running scripts
 * exported from Web Recorder or saved in Dev Studio.
 * All scripts are written to temp_execution/ before being run.
 */
export default defineConfig({
    testDir: './temp_execution',
    testMatch: '**/*.ts',      // Pick up any .ts file written by CodeExecutorService
    timeout: 120_000,
    globalTimeout: 300_000,
    retries: 0,
    workers: 1,
    reporter: [['list']],
    use: {
        headless: true,
        screenshot: 'off',
        video: 'off',
    },
});
