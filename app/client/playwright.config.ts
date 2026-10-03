import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'tests', timeout: 30000, use: { baseURL: process.env.NOTIZFADEN_TEST_URL || 'http://localhost:5173', browserName: 'chromium', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/google-chrome', args: ['--no-sandbox'] } }, reporter: 'list' });
