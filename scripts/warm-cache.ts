/**
 * Pre-warm KV cache for deterministic AI actions after a release deploy.
 *
 * Usage:
 *   RELEASE=26.4.2 npm run warm:cache
 *   SITE_URL=https://eda-resource-browser.pages.dev RELEASE=26.4.2 npm run warm:cache
 *
 * Actions warmed (in order per CRD):
 *   schema-summary — deterministic OpenAPI summary (no neurons)
 *   relationships  — deterministic schema reference edges (no neurons)
 *   explain        — LLM-generated CRD overview (~10 neurons each)
 *   example        — LLM-generated YAML examples (~10 neurons each)
 *   full-context   — deterministic assembly of the above (no neurons)
 *
 * Optional env:
 *   WARM_ACTIONS=schema-summary,explain   — subset of actions (default: all five)
 *   SLEEP_MS=300                           — delay between batch rounds
 *   CONCURRENCY=5                          — parallel CRDs per batch
 */
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { ASK_WARM_ACTIONS } from '../src/lib/ai/kvCache';
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
const SLEEP_MS = Number(process.env.SLEEP_MS) || 300;
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY) || 5);

function parseWarmActions(): string[] {
	const raw = process.env.WARM_ACTIONS?.trim();
	if (!raw) return [...ASK_WARM_ACTIONS];
	const requested = raw.split(',').map((s) => s.trim()).filter(Boolean);
	const valid = new Set<string>(ASK_WARM_ACTIONS);
	const actions = requested.filter((a) => valid.has(a));
	if (!actions.length) {
		throw new Error(
			`WARM_ACTIONS must include at least one of: ${ASK_WARM_ACTIONS.join(', ')}`
		);
	}
	return actions;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadCrdTargets(
	releaseName: string
): Promise<{ kind: string; group: string }[]> {
	const raw = await fs.readFile(RELEASES_PATH, 'utf8');
	const config = yaml.load(raw, { schema: yaml.CORE_SCHEMA }) as ReleasesConfig;
	const release = config.releases.find((r) => r.name === releaseName || r.label === releaseName);
	if (!release) {
		throw new Error(`Release not found in releases.yaml: ${releaseName}`);
	}

	const folder = assertSafeFolderPath(release.folder);
	const manifestPath = path.join(STATIC_ROOT, folder, 'manifest.json');
	const manifestRaw = await fs.readFile(manifestPath, 'utf8');
	const manifest = JSON.parse(manifestRaw) as { kind?: string; group?: string }[];

	const targets: { kind: string; group: string }[] = [];
	for (const entry of manifest) {
		const kind = entry.kind?.trim();
		const group = entry.group?.trim();
		if (kind && group) targets.push({ kind, group });
	}
	return targets.sort((a, b) => `${a.kind}:${a.group}`.localeCompare(`${b.kind}:${b.group}`));
}

async function main() {
	if (!RELEASE) {
		console.error('Error: RELEASE env var required. Usage: RELEASE=26.4.2 npm run warm:cache');
		process.exit(1);
	}

	const warmActions = parseWarmActions();

	console.log(`\nWarming AI cache for release ${RELEASE} at ${SITE_URL}`);
	console.log(`Actions: ${warmActions.join(' → ')}\n`);

	let targets: { kind: string; group: string }[];
	try {
		targets = await loadCrdTargets(RELEASE);
	} catch (err) {
		console.error(err instanceof Error ? err.message : err);
		process.exit(1);
	}

	console.log(`Found ${targets.length} CRD kind/group pairs to warm.`);
	console.log(`Concurrency: ${CONCURRENCY}, sleep between batches: ${SLEEP_MS}ms\n`);

	let total = 0;
	let cached = 0;
	let fresh = 0;
	let errors = 0;
	let neuronsUsed = 0;

	async function warmOne(kind: string, group: string, action: string): Promise<void> {
		total++;
		try {
			const res = await fetch(`${SITE_URL}/api/ai`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ release: RELEASE, kind, group, action })
			});

			if (!res.ok) {
				const errBody = await res.text().catch(() => '');
				console.warn(
					`\n  warn ${kind}/${group}:${action} -> HTTP ${res.status} ${errBody.slice(0, 120)}`
				);
				errors++;
				return;
			}

			const data = (await res.json()) as { cached?: boolean };
			if (data.cached) {
				process.stdout.write('.');
				cached++;
			} else {
				process.stdout.write('✓');
				fresh++;
				if (action === 'explain' || action === 'example') {
					neuronsUsed += 10;
				}
			}
		} catch (err) {
			console.warn(
				`\n  fail ${kind}/${group}:${action} -> ${err instanceof Error ? err.message : err}`
			);
			errors++;
		}
	}

	type Job = { kind: string; group: string; action: string };
	const jobs: Job[] = [];
	for (const { kind, group } of targets) {
		for (const action of warmActions) {
			jobs.push({ kind, group, action });
		}
	}

	for (let i = 0; i < jobs.length; i += CONCURRENCY) {
		const batch = jobs.slice(i, i + CONCURRENCY);
		await Promise.all(batch.map((j) => warmOne(j.kind, j.group, j.action)));
		if (i + CONCURRENCY < jobs.length) {
			await sleep(SLEEP_MS);
		}
	}

	console.log('\n\nDone!');
	console.log(`  Total:  ${total}`);
	console.log(`  Fresh:  ${fresh}`);
	console.log(`  Cached: ${cached} (already warm)`);
	console.log(`  Errors: ${errors}`);
	console.log(`\nLLM actions (explain/example) neurons used: ~${neuronsUsed} / 10,000 daily free tier`);
	console.log(
		`Deterministic actions (schema-summary/relationships/full-context) use 0 neurons.`
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
