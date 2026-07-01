/**
 * Pre-warm KV cache for deterministic AI actions after a release deploy.
 *
 * Usage:
 *   RELEASE=26.4.3 npm run warm:cache
 *   npm run warm:cache -- --release 26.4.3
 *   npm run warm:cache -- --release 26.4.3 --local
 *   npm run warm:cache -- --release 26.4.3 --base-url http://localhost:8788
 *   WARM_CACHE_BASE_URL=https://eda-resource-browser.pages.dev npm run warm:cache
 *
 * Targets production by default. Use --local (or --base-url) to warm against a local
 * wrangler pages dev server before deploy. A preflight check verifies
 * dependency-graph.json is available on the target before warming CRDs.
 *
 * Actions warmed:
 *   dependency-map — full release topology from dependency-graph.json (once per release)
 *   Per CRD: schema-summary, relationships, full-context (deterministic, 0 neurons)
 *   Optional LLM: explain, example via WARM_ACTIONS=explain,example or npm run warm:cache:llm
 *
 * Optional env:
 *   WARM_CACHE_BASE_URL / SITE_URL       — target site (default: production pages.dev)
 *   WARM_ACTIONS=schema-summary,explain   — subset of actions (default: all five)
 *   SLEEP_MS=300                           — delay between batch rounds
 *   CONCURRENCY=5                          — parallel CRDs per batch
 *   WARM_RETRIES=3                         — retries per request on transient fetch errors
 *   FETCH_TIMEOUT_MS=120000                — per-request timeout (70B explain/example can be slow)
 *   NODE_EXTRA_CA_CERTS=/etc/ssl/certs/... — required on many corporate networks (MITM proxy)
 *   HTTP_PROXY / HTTPS_PROXY               — corporate proxy (uses undici ProxyAgent)
 */
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { DETERMINISTIC_WARM_ACTIONS, LLM_WARM_ACTIONS, RELEASE_CACHE_KIND } from '../src/lib/ai/kvCache';
import { activeApiVersion, filterActiveManifest } from '../src/lib/manifest/activeCrds';
import { assertSafeFolderPath, releaseAssetPath } from '../src/lib/yaml-validation/schemaCache';
import type { ReleasesConfig } from '../src/lib/structure';

const PRODUCTION_URL = 'https://eda-resource-browser.pages.dev';
const LOCAL_URL = 'http://localhost:8788';

function configureFetchDispatcher(): void {
	const proxyUrl =
		process.env.HTTPS_PROXY?.trim() ||
		process.env.https_proxy?.trim() ||
		process.env.HTTP_PROXY?.trim() ||
		process.env.http_proxy?.trim();
	const extraCaPath = process.env.NODE_EXTRA_CA_CERTS?.trim();
	const ca = extraCaPath ? fs.readFileSync(extraCaPath) : undefined;
	const tls = ca ? { ca } : undefined;

	if (proxyUrl) {
		setGlobalDispatcher(
			new ProxyAgent({
				uri: proxyUrl,
				...(tls ? { requestTls: tls, proxyTls: tls } : {})
			})
		);
	}
}

configureFetchDispatcher();

const ROOT = process.cwd();
const STATIC_ROOT = path.join(ROOT, 'static');
const RELEASES_PATH = path.join(ROOT, 'src/lib/releases.yaml');

const SLEEP_MS = Number(process.env.SLEEP_MS) || 300;
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY) || 5);
const WARM_RETRIES = Math.max(1, Number(process.env.WARM_RETRIES) || 3);
const RETRY_DELAY_MS = Number(process.env.WARM_RETRY_DELAY_MS) || 1500;
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 120_000;
const PREFLIGHT_TIMEOUT_MS = Number(process.env.PREFLIGHT_TIMEOUT_MS) || 15_000;

function normalizeBaseUrl(url: string): string {
	return url.replace(/\/+$/, '');
}

function parseCliArgs(): { release?: string; baseUrl: string; local: boolean } {
	const args = process.argv.slice(2);
	const local = args.includes('--local');
	const releaseIdx = args.indexOf('--release');
	const release = releaseIdx >= 0 ? args[releaseIdx + 1]?.trim() : undefined;
	if (releaseIdx >= 0 && !release) {
		throw new Error('Missing value for --release');
	}

	const baseUrlIdx = args.indexOf('--base-url');
	const baseUrlFromArg = baseUrlIdx >= 0 ? args[baseUrlIdx + 1]?.trim() : undefined;
	if (baseUrlIdx >= 0 && !baseUrlFromArg) {
		throw new Error('Missing value for --base-url');
	}
	if (local && baseUrlFromArg) {
		throw new Error('Use either --local or --base-url, not both');
	}

	const baseUrlRaw =
		(local ? LOCAL_URL : undefined) ??
		baseUrlFromArg ??
		process.env.WARM_CACHE_BASE_URL?.trim() ??
		process.env.SITE_URL?.trim() ??
		PRODUCTION_URL;

	return { release, baseUrl: normalizeBaseUrl(baseUrlRaw), local };
}

function parseWarmActions(): string[] {
	const raw = process.env.WARM_ACTIONS?.trim();
	const valid = new Set<string>([...DETERMINISTIC_WARM_ACTIONS, ...LLM_WARM_ACTIONS]);
	if (!raw) return [...DETERMINISTIC_WARM_ACTIONS];
	const requested = raw.split(',').map((s) => s.trim()).filter(Boolean);
	const actions = requested.filter((a) => valid.has(a));
	if (!actions.length) {
		throw new Error(
			`WARM_ACTIONS must include at least one of: ${[...DETERMINISTIC_WARM_ACTIONS, ...LLM_WARM_ACTIONS].join(', ')}`
		);
	}
	return actions;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadReleasesConfig(): Promise<ReleasesConfig> {
	const raw = await fsPromises.readFile(RELEASES_PATH, 'utf8');
	return yaml.load(raw, { schema: yaml.CORE_SCHEMA }) as ReleasesConfig;
}

async function resolveReleaseFolder(releaseName: string): Promise<string> {
	const config = await loadReleasesConfig();
	const release = config.releases.find((r) => r.name === releaseName || r.label === releaseName);
	if (!release) {
		throw new Error(`Release not found in releases.yaml: ${releaseName}`);
	}
	return assertSafeFolderPath(release.folder);
}

async function loadCrdTargets(
	releaseName: string
): Promise<{ kind: string; group: string; version: string }[]> {
	const folder = await resolveReleaseFolder(releaseName);
	const manifestPath = path.join(STATIC_ROOT, folder, 'manifest.json');
	const manifestRaw = await fsPromises.readFile(manifestPath, 'utf8');
	const manifest = JSON.parse(manifestRaw) as {
		kind?: string;
		group?: string;
		versions?: { name: string; deprecated?: boolean }[];
	}[];

	const targets: { kind: string; group: string; version: string }[] = [];
	for (const entry of filterActiveManifest(manifest)) {
		const kind = entry.kind?.trim();
		const group = entry.group?.trim();
		const version = activeApiVersion(entry);
		if (kind && group && version) {
			targets.push({ kind, group, version });
		}
	}
	return targets.sort((a, b) => `${a.kind}:${a.group}`.localeCompare(`${b.kind}:${b.group}`));
}

function isConnectionError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const msg = err.message.toLowerCase();
	return (
		msg.includes('econnrefused') ||
		msg.includes('fetch failed') ||
		msg.includes('network') ||
		msg.includes('connect')
	);
}

function printLocalServerHelp(): void {
	console.error(
		'\nLocal wrangler server does not appear to be running.\n' +
			'  Terminal 1: npm run dev:ai\n' +
			'  Terminal 2: npm run warm:cache -- --release <release> --local\n'
	);
}

async function preflightDependencyGraph(
	release: string,
	baseUrl: string,
	releaseFolder: string,
	local: boolean
): Promise<void> {
	const assetPath = releaseAssetPath(releaseFolder, 'dependency-graph.json');
	const assetUrl = `${baseUrl}${assetPath}`;
	const localGraphPath = path.join(STATIC_ROOT, releaseFolder, 'dependency-graph.json');
	const localExists = fs.existsSync(localGraphPath);

	console.log(`Preflight: ${assetUrl}`);

	let response: Response | undefined;
	let fetchError: unknown;

	try {
		response = await fetch(assetUrl, {
			method: 'GET',
			signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS)
		});
	} catch (err) {
		fetchError = err;
	}

	if (fetchError) {
		if (local && isConnectionError(fetchError)) {
			printLocalServerHelp();
			process.exit(1);
		}
		console.error(
			`\nPreflight failed: could not reach ${baseUrl} (${fetchError instanceof Error ? fetchError.message : fetchError})`
		);
		process.exit(1);
	}

	if (response?.ok) {
		console.log('Preflight OK: dependency-graph.json found on target.\n');
		return;
	}

	const status = response?.status ?? 'unknown';
	console.error(`\nPreflight failed: dependency-graph.json returned HTTP ${status} at ${assetUrl}`);

	if (localExists) {
		if (baseUrl === PRODUCTION_URL || !local) {
			console.error(
				`\nFile exists locally (${localGraphPath}) but not on ${baseUrl}.` +
					`\nDeploy first, then re-run warm:cache:\n` +
					`  npm run deploy:cloudflare\n` +
					`  npm run warm:cache -- --release ${release}\n` +
					`\nOr warm against a local server before deploy:\n` +
					`  npm run dev:ai\n` +
					`  npm run warm:cache -- --release ${release} --local`
			);
		} else {
			console.error(
				`\nFile exists locally (${localGraphPath}) but the local server does not serve it yet.` +
					`\nRebuild and restart the local server:\n` +
					`  npm run dev:ai\n` +
					`  npm run warm:cache -- --release ${release} --local`
			);
		}
	} else {
		console.error(
			`\nNo local dependency-graph.json at ${localGraphPath}.` +
				`\nGenerate it first:\n` +
				`  RELEASE=${release} npm run build:dependency-graph`
		);
	}

	process.exit(1);
}

async function main() {
	let cli: ReturnType<typeof parseCliArgs>;
	try {
		cli = parseCliArgs();
	} catch (err) {
		console.error(`Error: ${err instanceof Error ? err.message : err}`);
		process.exit(1);
	}

	const RELEASE = cli.release ?? process.env.RELEASE?.trim();
	if (!RELEASE) {
		console.error(
			'Error: RELEASE required. Usage: RELEASE=26.4.3 npm run warm:cache\n' +
				'       npm run warm:cache -- --release 26.4.3\n' +
				'       npm run warm:cache -- --release 26.4.3 --local'
		);
		process.exit(1);
	}

	const baseUrl = cli.baseUrl;
	const warmActions = parseWarmActions();
	const releaseActions = warmActions.filter((a) => a === 'dependency-map');
	const crdActions = warmActions.filter((a) => a !== 'dependency-map');

	console.log(`\nWarming AI cache for release ${RELEASE} at ${baseUrl}`);
	if (cli.local) {
		console.log('Mode: local wrangler pages dev');
	}
	console.log(
		`Actions: ${releaseActions.length ? `${releaseActions.join(' → ')} → ` : ''}${crdActions.join(' → ')}\n`
	);

	let releaseFolder: string;
	try {
		releaseFolder = await resolveReleaseFolder(RELEASE);
	} catch (err) {
		console.error(err instanceof Error ? err.message : err);
		process.exit(1);
	}

	if (releaseActions.length) {
		await preflightDependencyGraph(RELEASE, baseUrl, releaseFolder, cli.local);
	}

	let targets: { kind: string; group: string; version: string }[];
	try {
		targets = await loadCrdTargets(RELEASE);
	} catch (err) {
		console.error(err instanceof Error ? err.message : err);
		process.exit(1);
	}

	console.log(`Found ${targets.length} CRD kind/group pairs to warm.`);
	console.log(`Concurrency: ${CONCURRENCY}, sleep between batches: ${SLEEP_MS}ms`);
	if (process.env.NODE_EXTRA_CA_CERTS?.trim()) {
		console.log(`TLS: NODE_EXTRA_CA_CERTS=${process.env.NODE_EXTRA_CA_CERTS.trim()}`);
	}
	console.log(`Retries: ${WARM_RETRIES}, fetch timeout: ${FETCH_TIMEOUT_MS}ms\n`);

	let total = 0;
	let cached = 0;
	let fresh = 0;
	let errors = 0;
	let neuronsUsed = 0;

	type Job = { kind: string; group: string; version: string; action: string };
	const failedJobs: Job[] = [];

	async function postAi(job: Job): Promise<Response> {
		let lastErr: unknown;
		for (let attempt = 1; attempt <= WARM_RETRIES; attempt++) {
			try {
				return await fetch(`${baseUrl}/api/ai`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						release: RELEASE,
						kind: job.kind,
						group: job.group,
						version: job.version,
						action: job.action
					}),
					signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
				});
			} catch (err) {
				lastErr = err;
				if (attempt < WARM_RETRIES) {
					await sleep(RETRY_DELAY_MS * attempt);
				}
			}
		}
		throw lastErr;
	}

	async function warmOne(job: Job, mode: 'batch' | 'retry' = 'batch'): Promise<void> {
		if (mode === 'batch') total++;
		const { kind, group, action } = job;
		try {
			const res = await postAi(job);

			if (!res.ok) {
				const errBody = await res.text().catch(() => '');
				console.warn(
					`\n  warn ${kind}/${group}:${action} -> HTTP ${res.status} ${errBody.slice(0, 120)}`
				);
				if (mode === 'batch') {
					errors++;
					failedJobs.push(job);
				}
				return;
			}

			const data = (await res.json()) as { cached?: boolean };
			if (mode === 'retry') errors = Math.max(0, errors - 1);
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
			if (mode === 'batch') {
				errors++;
				failedJobs.push(job);
			}
		}
	}

	async function runBatches(jobs: Job[], concurrency: number): Promise<void> {
		for (let i = 0; i < jobs.length; i += concurrency) {
			const batch = jobs.slice(i, i + concurrency);
			await Promise.all(batch.map((j) => warmOne(j)));
			if (i + concurrency < jobs.length) {
				await sleep(SLEEP_MS);
			}
		}
	}

	const jobs: Job[] = [];
	for (const { kind, group, version } of targets) {
		for (const action of crdActions) {
			jobs.push({ kind, group, version, action });
		}
	}

	if (releaseActions.length) {
		console.log(`Warming release-scoped: ${releaseActions.join(', ')}`);
		for (const action of releaseActions) {
			await warmOne({ kind: RELEASE_CACHE_KIND, group: '', version: '', action }, 'batch');
		}
		console.log('');
	}

	await runBatches(jobs, CONCURRENCY);

	if (failedJobs.length) {
		console.log(`\n\nRetrying ${failedJobs.length} failed job(s) sequentially...`);
		const retryJobs = [...failedJobs];
		failedJobs.length = 0;
		for (const job of retryJobs) {
			await warmOne(job, 'retry');
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
