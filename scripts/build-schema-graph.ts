/**
 * Precompute OpenAPI component schema dependency graphs for every spec snapshot.
 *
 * Writes:
 * - `schema-graph.json` — schema-only graph (backward compatible)
 * - `api-graph.json` — unified paths + schemas graph for the Schema Graph UI
 */
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { buildSchemaGraph } from '../src/lib/schemaGraph/buildSchemaGraph';
import { buildUnifiedApiGraph } from '../src/lib/schemaGraph/unifiedApiGraph';

const ROOT = process.cwd();
const STATIC_OPENAPI = path.join(ROOT, 'static', 'openapi');

type OpenApiReleasesConfig = {
	releases: Array<{ name: string; label: string; folder: string; default?: boolean }>;
};

async function loadReleasesConfig(): Promise<OpenApiReleasesConfig> {
	const RELEASES_PATH = path.join(ROOT, 'src', 'lib', 'openapi-releases.yaml');
	const raw = await fs.readFile(RELEASES_PATH, 'utf8');
	return yaml.load(raw, { schema: yaml.CORE_SCHEMA }) as OpenApiReleasesConfig;
}

function defaultReleaseName(config: OpenApiReleasesConfig): string {
	const marked = config.releases.find((r) => r.default);
	if (marked) return marked.name;
	return config.releases[0]?.name ?? '';
}

function parseTargets(argv: string[]): { releases: string[]; all: boolean } {
	const args = argv.slice(2);
	const all = args.includes('--all');
	const releaseIdx = args.indexOf('--release');
	const releaseFromArg = releaseIdx >= 0 ? args[releaseIdx + 1]?.trim() : undefined;
	const releaseFromEnv = process.env.RELEASE?.trim();

	if (all) {
		if (releaseFromArg || releaseFromEnv) {
			throw new Error('Use either --all or a single release (--release / RELEASE), not both');
		}
		return { releases: [], all: true };
	}

	const release = releaseFromArg ?? releaseFromEnv;
	return { releases: release ? [release] : [], all: false };
}

async function walkJsonFiles(dir: string): Promise<string[]> {
	const results: string[] = [];
	async function walk(cur: string) {
		const entries = await fs.readdir(cur, { withFileTypes: true });
		for (const ent of entries) {
			const full = path.join(cur, ent.name);
			if (ent.isDirectory()) {
				await walk(full);
			} else if (ent.isFile() && ent.name.endsWith('.json') && ent.name !== 'manifest.json') {
				if (ent.name === 'schema-graph.json' || ent.name === 'api-graph.json') continue;
				results.push(full);
			}
		}
	}
	await walk(dir);
	return results.sort();
}

function specDirOutFromFile(releaseDir: string, jsonFilePath: string): string {
	const rel = path.relative(releaseDir, jsonFilePath).split(path.sep).join('/');
	return path.posix.dirname(rel);
}

async function buildForRelease(releaseName: string): Promise<void> {
	const releaseDir = path.join(STATIC_OPENAPI, releaseName);
	try {
		await fs.access(releaseDir);
	} catch {
		console.warn(`Skip ${releaseName} — directory not found: ${releaseDir}`);
		return;
	}

	const jsonFiles = await walkJsonFiles(releaseDir);
	if (jsonFiles.length === 0) {
		console.warn(`Skip ${releaseName} — no OpenAPI spec JSON files found`);
		return;
	}

	for (const jsonFilePath of jsonFiles) {
		const outDir = specDirOutFromFile(releaseDir, jsonFilePath);
		const schemaGraphPath = path.join(releaseDir, outDir, 'schema-graph.json');
		const apiGraphPath = path.join(releaseDir, outDir, 'api-graph.json');

		const raw = readFileSync(jsonFilePath, 'utf8');
		const spec = JSON.parse(raw) as Record<string, unknown>;
		const components = spec.components as Record<string, unknown> | undefined;
		const schemas = components?.schemas as Record<string, unknown> | undefined;
		if (!schemas || typeof schemas !== 'object') continue;

		const schemaGraph = buildSchemaGraph(schemas);
		const apiGraph = buildUnifiedApiGraph(spec);

		await fs.mkdir(path.dirname(schemaGraphPath), { recursive: true });
		await fs.writeFile(schemaGraphPath, JSON.stringify(schemaGraph) + '\n');
		await fs.writeFile(apiGraphPath, JSON.stringify(apiGraph) + '\n');

		console.log(`✓ ${path.relative(ROOT, apiGraphPath)}`);
	}
}

async function main() {
	const config = await loadReleasesConfig();
	const { releases: explicitReleases, all } = parseTargets(process.argv);

	const targets = all
		? config.releases.map((r) => r.name)
		: explicitReleases.length
			? explicitReleases
			: [defaultReleaseName(config)];
	if (!targets.length) throw new Error('No releases to build');

	for (const release of targets) {
		console.log(`== schema graph: ${release} ==`);
		await buildForRelease(release);
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
