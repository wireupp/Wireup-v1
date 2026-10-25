import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  use: {
    // `localhost` rather than 127.0.0.1: `vite --host localhost` binds to ::1
    // on Windows, which 127.0.0.1 can never reach.
    baseURL: 'http://localhost:5173',
    launchOptions: {
      channel: 'chrome',
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
})
