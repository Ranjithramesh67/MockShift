import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e configuration.
 *
 * The webServer entry boots the Next.js dev server on port 3000 and waits for
 * it to be reachable before running any spec. `reuseExistingServer` keeps a
 * manually started dev server alive across runs.
 *
 * Every spec logs in as the same seeded demo account and drives the same
 * backend DB/workspace, so the suite must run serially: parallel workers race
 * on shared state (duplicate named environments, login contention). Run the
 * full suite on a freshly `reset:db` + `seed:dev` backend.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
