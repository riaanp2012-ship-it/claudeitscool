import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Use the preinstalled Chromium when present; otherwise fall back to Playwright's own download.
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath = existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined;
const PORT = Number(process.env.PORT ?? 5199);

export default defineConfig({
  testDir: 'tests',
  timeout: 180_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  projects: [
    { name: 'e2e', testMatch: /e2e\/.*\.spec\.ts/ },
    { name: 'bench', testMatch: /bench\/.*\.spec\.ts/ },
  ],
  webServer: {
    command: `npx vite build --mode test --outDir dist-test && npx vite preview --outDir dist-test --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
