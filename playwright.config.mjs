import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 90000,
  expect: { timeout: 12000 },
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5178',
    viewport: { width: 1400, height: 1000 },
    launchOptions: { channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: { command: 'node server.mjs 5178', url: 'http://localhost:5178', reuseExistingServer: false },
});
