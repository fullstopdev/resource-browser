#!/usr/bin/env node
/**
 * One-off script to capture README screenshots from the live demo.
 * Usage: node scripts/capture-readme-screenshots.mjs
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'docs', 'images');
const BASE = process.env.SCREENSHOT_BASE_URL || 'https://eda-resource-browser.pages.dev';

/** @type {{ file: string; url: string; waitFor?: string; timeout?: number; extraWait?: number }[]} */
const CAPTURES = [
	{
		file: 'catalog.png',
		url: `${BASE}/?release=26.4.2`,
		waitFor: 'input[placeholder*="Search kind"]',
		timeout: 45_000
	},
	{
		file: 'crd-detail.png',
		url: `${BASE}/?release=26.4.2&crd=Topology&version=v1alpha1`,
		waitFor: 'text=Topology',
		timeout: 60_000,
		extraWait: 2000
	},
	{
		file: 'comparison.png',
		url: `${BASE}/comparison?sr=25.12.3&sv=all&tr=26.4.2&tv=all`,
		waitFor: 'text=modified',
		timeout: 120_000,
		extraWait: 1500
	},
	{
		file: 'validate-yaml.png',
		url: `${BASE}/validate-yaml?release=26.4.2`,
		waitFor: 'text=Validate YAML',
		timeout: 60_000,
		extraWait: 3000
	},
	{
		file: 'dependency-map.png',
		url: `${BASE}/dependency-map?release=26.4.2&resource=topologies.topologies.eda.nokia.com`,
		waitFor: '.svelte-flow',
		timeout: 120_000,
		extraWait: 2000
	},
	{
		file: 'release-notes.png',
		url: `${BASE}/release-changes`,
		waitFor: 'text=Release Intelligence',
		timeout: 45_000,
		extraWait: 1500
	}
];

async function main() {
	await mkdir(OUT_DIR, { recursive: true });

	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 1,
		ignoreHTTPSErrors: true,
		colorScheme: 'light'
	});
	const page = await context.newPage();

	const results = [];

	for (const shot of CAPTURES) {
		const outPath = path.join(OUT_DIR, shot.file);
		process.stdout.write(`Capturing ${shot.file} from ${shot.url} … `);
		try {
			await page.goto(shot.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
			await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

			if (shot.waitFor) {
				await page.waitForSelector(shot.waitFor, { timeout: shot.timeout ?? 45_000 });
			}
			if (shot.extraWait) {
				await page.waitForTimeout(shot.extraWait);
			}

			await page.screenshot({ path: outPath, type: 'png', fullPage: false });
			const { size } = await import('node:fs/promises').then((fs) =>
				fs.stat(outPath).then((s) => ({ size: s.size }))
			);
			results.push({ file: shot.file, url: shot.url, size, ok: true });
			console.log(`OK (${(size / 1024).toFixed(1)} KB)`);
		} catch (err) {
			results.push({
				file: shot.file,
				url: shot.url,
				ok: false,
				error: err instanceof Error ? err.message : String(err)
			});
			console.log(`FAILED: ${err instanceof Error ? err.message : err}`);
		}
	}

	await browser.close();

	console.log('\n--- Summary ---');
	for (const r of results) {
		if (r.ok) {
			console.log(`${r.file}: ${(r.size / 1024).toFixed(1)} KB — ${r.url}`);
		} else {
			console.log(`${r.file}: FAILED — ${r.error}`);
		}
	}

	const failed = results.filter((r) => !r.ok);
	process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
