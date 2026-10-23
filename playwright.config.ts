import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		// CI builds in its own step; locally, build first so tests run against fresh output.
		command: process.env.CI ? 'npm run preview' : 'npm run build && npm run preview',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		// prebuild generators + vite build take longer than the 60 s default.
		timeout: 300_000
	},
	testDir: 'e2e'
});
