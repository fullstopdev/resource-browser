/**
 * Precompute dependency graph JSON for a release (served from static/resources).
 *
 * Usage:
 *   npm run build:dependency-graph
 *   RELEASE=26.4.3 npm run build:dependency-graph
 *   npm run build:dependency-graph -- --release 26.4.3
 *   npm run build:dependency-graph -- --all
 */
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { buildDependencyGraphFromResources } from '../src/lib/dependency-map/buildGraphCore';
import { sortReleasesByVersion } from '../src/lib/release-notes/generateNotes';
import { loadStaticYaml } from '../src/lib/yaml/safeYaml';
import type { CrdResource, ReleasesConfig } from '../src/lib/structure';

const ROOT = process.cwd();
const RELEASES_PATH = path.join(ROOT, 'src/lib/releases.yaml');

async function loadReleasesConfig(): Promise<ReleasesConfig> {
	const raw = await fs.readFile(RELEASES_PATH, 'utf8');
	return yaml.load(raw, { schema: yaml.CORE_SCHEMA }) as ReleasesConfig;
}

function defaultReleaseName(config: ReleasesConfig): string {
	const marked = config.releases.find((r) => r.default);
	if (marked) return marked.name;
	const sorted = sortReleasesByVersion(config.releases);
	if (!sorted.length) throw new Error('No releases defined in releases.yaml');
	return sorted[0].name;
}

function parseTargets(argv: string[]): { releases: string[]; all: boolean } {
	const args = argv.slice(2);
	const all = args.includes('--all');
	const releaseIdx = args.indexOf('--release');
	const releaseFromArg = releaseIdx >= 0 ? args[releaseIdx + 1]?.trim() : undefined;
	if (releaseIdx >= 0 && !releaseFromArg) {
		throw new Error('Missing value for --release');
	}
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

async function resolveReleaseFolder(
	config: ReleasesConfig,
	releaseName: string
): Promise<string> {
	const release = config.releases.find((r) => r.name === releaseName || r.label === releaseName);
	if (!release) throw new Error(`Release not found: ${releaseName}`);
	return release.folder;
}

function loadOpenApiFromDisk(releaseFolder: string) {
	return (resourceName: string, apiVersion: string) => {
		const filePath = path.join(ROOT, 'static', releaseFolder, resourceName, `${apiVersion}.yaml`);
		try {
			const txt = readFileSync(filePath, 'utf8');
			const parsed = loadStaticYaml(txt) as {
				schema?: { openAPIV3Schema?: unknown };
			};
			const root = parsed.schema?.openAPIV3Schema;
			if (!root) return null;
			return {
				openApiRoot: root,
				description: (root as { description?: string }).description
			};
		} catch {
			return null;
		}
	};
}

async function buildForRelease(config: ReleasesConfig, releaseName: string): Promise<void> {
	const releaseFolder = await resolveReleaseFolder(config, releaseName);
	const manifestPath = path.join(ROOT, 'static', releaseFolder, 'manifest.json');
	const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as CrdResource[];

	const graph = await buildDependencyGraphFromResources(
		releaseFolder,
		manifest,
		loadOpenApiFromDisk(releaseFolder),
		{ precomputed: true }
	);

	const outPath = path.join(ROOT, 'static', releaseFolder, 'dependency-graph.json');
	await fs.writeFile(outPath, JSON.stringify(graph));

	const rate = graph.coverage?.referenceDescriptions.rate ?? graph.coverage?.rate ?? 0;
	console.log(
		`Wrote ${outPath} — ${graph.links.length} links, ${graph.nodes.length} nodes, coverage ${(rate * 100).toFixed(1)}%`
	);
}

async function main() {
	const config = await loadReleasesConfig();
	const { releases: explicitReleases, all } = parseTargets(process.argv);

	const targets = all
		? sortReleasesByVersion(config.releases).map((r) => r.name)
		: explicitReleases.length
			? explicitReleases
			: [defaultReleaseName(config)];

	if (!targets.length) {
		throw new Error('No releases to build');
	}

	if (targets.length > 1) {
		console.log(`Building dependency graphs for ${targets.length} releases...\n`);
	}

	for (const release of targets) {
		if (targets.length > 1) {
			console.log(`== ${release} ==`);
		}
		await buildForRelease(config, release);
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
