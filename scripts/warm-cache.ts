/**
 * Pre-warm KV cache for deterministic AI actions after a release deploy.
 *
 * Usage:
 *   RELEASE=26.4.2 npm run warm:cache
 *   SITE_URL=https://eda-resource-browser.pages.dev RELEASE=26.4.2 npm run warm:cache
 */
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { assertSafeFolderPath } from '../src/lib/yaml-validation/schemaCache';
import type { ReleasesConfig } from '../src/lib/structure';

const proxyUrl =
	process.env.HTTPS_PROXY?.trim() ||
	process.env.https_proxy?.trim() ||
	process.env.HTTP_PROXY?.trim() ||
	process.env.http_proxy?.trim();
if (proxyUrl) {
	setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

const ROOT = process.cwd();
const STATIC_ROOT = path.join(ROOT, 'static');
const RELEASES_PATH = path.join(ROOT, 'src/lib/releases.yaml');

const SITE_URL = process.env.SITE_URL ?? 'https://eda-resource-browser.pages.dev';
const RELEASE = process.env.RELEASE;
const WARM_ACTIONS = ['explain', 'example'] as const;
const SLEEP_MS = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadKinds(releaseName: string): Promise<string[]> {
	const raw = await fs.readFile(RELEASES_PATH, 'utf8');
	const config = yaml.load(raw, { schema: yaml.CORE_SCHEMA }) as ReleasesConfig;
	const release = config.releases.find((r) => r.name === releaseName || r.label === releaseName);
	if (!release) {
		throw new Error(`Release not found in releases.yaml: ${releaseName}`);
	}

	const folder = assertSafeFolderPath(release.folder);
	const manifestPath = path.join(STATIC_ROOT, folder, 'manifest.json');
	const manifestRaw = await fs.readFile(manifestPath, 'utf8');
	const manifest = JSON.parse(manifestRaw) as { kind?: string }[];

	const kinds = new Set<string>();
	for (const entry of manifest) {
		if (entry.kind?.trim()) kinds.add(entry.kind.trim());
	}
	return [...kinds].sort();
}

async function main() {
	if (!RELEASE) {
		console.error('Error: RELEASE env var required. Usage: RELEASE=26.4.2 npm run warm:cache');
		process.exit(1);
	}

	console.log(`\nWarming AI cache for release ${RELEASE} at ${SITE_URL}\n`);

	let kinds: string[];
	try {
		kinds = await loadKinds(RELEASE);
	} catch (err) {
		console.error(err instanceof Error ? err.message : err);
		process.exit(1);
	}

	console.log(`Found ${kinds.length} CRD kinds to warm.\n`);

	let total = 0;
	let cached = 0;
	let fresh = 0;
	let errors = 0;

	for (const kind of kinds) {
		for (const action of WARM_ACTIONS) {
			total++;
			try {
				const res = await fetch(`${SITE_URL}/api/ai`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ release: RELEASE, kind, action })
				});

				if (!res.ok) {
					const errBody = await res.text().catch(() => '');
					console.warn(`  warn ${kind}:${action} -> HTTP ${res.status} ${errBody.slice(0, 80)}`);
					errors++;
					continue;
				}

				const data = (await res.json()) as { cached?: boolean };
				if (data.cached) {
					process.stdout.write('.');
					cached++;
				} else {
					process.stdout.write('✓');
					fresh++;
				}

				await sleep(SLEEP_MS);
			} catch (err) {
				console.warn(`\n  fail ${kind}:${action} -> ${err instanceof Error ? err.message : err}`);
				errors++;
			}
		}
	}

	console.log('\n\nDone!');
	console.log(`  Total:  ${total}`);
	console.log(`  Fresh:  ${fresh} (neurons used: ~${fresh * 10})`);
	console.log(`  Cached: ${cached} (already warm)`);
	console.log(`  Errors: ${errors}`);
	console.log(`\nFree tier budget used: ~${fresh * 10} / 10,000 neurons`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
