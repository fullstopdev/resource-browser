/**
 * Scan static/openapi/<release>/ and write manifest.json + update openapi-releases.yaml
 *
 *   npm run generate:openapi-manifest
 *   npm run generate:openapi-manifest -- --release 26.4.3
 *   npm run generate:openapi-manifest -- --all
 */
import fs from 'fs/promises';
import path from 'path';
import {
	compareReleaseDesc,
	discoverOpenApiReleaseFolders
} from '../src/lib/openapi/releaseDiscovery';

const ROOT = process.cwd();
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const GENERATED_GRAPH_FILES = new Set(['api-graph.json', 'schema-graph.json']);
const STATIC_OPENAPI = path.join(ROOT, 'static', 'openapi');
const RELEASES_YAML = path.join(ROOT, 'src', 'lib', 'openapi-releases.yaml');

interface OpenApiSpecFile {
	openapi?: string;
	info?: { title?: string; version?: string; description?: string };
	paths?: Record<string, unknown>;
	tags?: { name: string }[];
}

export interface OpenApiManifestEntry {
	id: string;
	title: string;
	group: string;
	apiVersion: string;
	file: string;
	pathCount: number;
	tags: string[];
}

async function findSpecFiles(releaseDir: string): Promise<string[]> {
	const results: string[] = [];
	async function walk(dir: string) {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const ent of entries) {
			const full = path.join(dir, ent.name);
			if (ent.isDirectory()) {
				await walk(full);
			} else if (
				ent.isFile() &&
				ent.name.endsWith('.json') &&
				ent.name !== 'manifest.json' &&
				!GENERATED_GRAPH_FILES.has(ent.name) &&
				!ent.name.startsWith('_')
			) {
				results.push(full);
			}
		}
	}
	await walk(releaseDir);
	return results.sort();
}

function specIdFromPath(releaseDir: string, filePath: string): {
	id: string;
	group: string;
	apiVersion: string;
	file: string;
} {
	const rel = path.relative(releaseDir, filePath).replace(/\\/g, '/');
	const parts = rel.split('/');

	if (parts[0] === 'core') {
		return { id: 'core', group: 'core', apiVersion: 'core', file: rel };
	}

	// apps/<group>/<apiVersion>/<name>.json
	const group = parts[1] ?? 'unknown';
	const apiVersion = parts[2] ?? 'unknown';
	const id = `${group}/${apiVersion}`;
	return { id, group, apiVersion, file: rel };
}

function collectSpecTags(spec: OpenApiSpecFile): string[] {
	const tags = new Set<string>();
	for (const tag of spec.tags ?? []) {
		if (tag.name) tags.add(tag.name);
	}
	for (const pathItem of Object.values(spec.paths ?? {})) {
		if (!pathItem || typeof pathItem !== 'object') continue;
		for (const [key, operation] of Object.entries(pathItem as Record<string, unknown>)) {
			if (!HTTP_METHODS.has(key) || !operation || typeof operation !== 'object') continue;
			for (const tag of (operation as { tags?: string[] }).tags ?? []) {
				if (tag) tags.add(tag);
			}
		}
	}
	return [...tags].sort((a, b) => a.localeCompare(b));
}

function manifestTitle(meta: { id: string }, spec: OpenApiSpecFile): string {
	if (meta.id === 'core') {
		return 'API Server (REST, Query & EQL)';
	}
	return spec.info?.title ?? meta.id;
}

function manifestGroup(meta: { id: string; group: string }): string {
	if (meta.id === 'core') return 'API Server';
	return meta.group;
}

function manifestFeatureTags(meta: { id: string }, spec: OpenApiSpecFile): string[] {
	const tags = collectSpecTags(spec);
	if (meta.id !== 'core') return tags;

	const featureTags = new Set(tags);
	featureTags.add('eql');
	featureTags.add('query');
	for (const path of Object.keys(spec.paths ?? {})) {
		const lower = path.toLowerCase();
		if (lower.includes('/eql')) featureTags.add('eql');
		if (lower.includes('/query/')) featureTags.add('query');
	}
	return [...featureTags].sort((a, b) => a.localeCompare(b));
}

async function buildManifestForRelease(release: string): Promise<OpenApiManifestEntry[]> {
	const releaseDir = path.join(STATIC_OPENAPI, release);
	try {
		await fs.access(releaseDir);
	} catch {
		console.warn(`Skip $release — directory not found: ${releaseDir}`);
		return [];
	}

	const files = await findSpecFiles(releaseDir);
	const entries: OpenApiManifestEntry[] = [];

	for (const filePath of files) {
		const raw = await fs.readFile(filePath, 'utf8');
		let spec: OpenApiSpecFile;
		try {
			spec = JSON.parse(raw) as OpenApiSpecFile;
		} catch {
			console.warn(`Skip invalid JSON: ${filePath}`);
			continue;
		}

		const meta = specIdFromPath(releaseDir, filePath);
		const pathCount = spec.paths ? Object.keys(spec.paths).length : 0;

		entries.push({
			id: meta.id,
			title: manifestTitle(meta, spec),
			group: manifestGroup(meta),
			apiVersion: meta.apiVersion,
			file: meta.file,
			pathCount,
			tags: manifestFeatureTags(meta, spec)
		});
	}

	entries.sort((a, b) => a.title.localeCompare(b.title));
	await fs.writeFile(path.join(releaseDir, 'manifest.json'), JSON.stringify(entries, null, 2) + '\n');
	console.log(`✓ Wrote manifest for ${release} (${entries.length} specs)`);
	return entries;
}

async function updateReleasesYaml(releases: string[]): Promise<void> {
	const sorted = [...releases].sort(compareReleaseDesc);
	const yamlEntries = sorted.map((name, i) => ({
		name,
		label: `EDA ${name}`,
		folder: `openapi/${name}`,
		...(i === 0 ? { default: true } : {})
	}));

	const content =
		'# OpenAPI Release Configuration\n' +
		'# Auto-generated by generate-openapi-manifest.ts\n' +
		'releases:\n' +
		yamlEntries
			.map((r) => {
				const lines = [`  - name: '${r.name}'`, `    label: '${r.label}'`, `    folder: '${r.folder}'`];
				if (r.default) lines.push(`    default: true`);
				return lines.join('\n');
			})
			.join('\n') +
		'\n';

	await fs.writeFile(RELEASES_YAML, content);
	console.log(`✓ Updated ${RELEASES_YAML} (${sorted.length} releases, latest: ${sorted[0]})`);
}

async function listExistingReleases(): Promise<string[]> {
	try {
		const dirs = await fs.readdir(STATIC_OPENAPI, { withFileTypes: true });
		return discoverOpenApiReleaseFolders(dirs.filter((d) => d.isDirectory()).map((d) => d.name));
	} catch {
		return [];
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const allFlag = args.includes('--all');
	const releaseIdx = args.findIndex((a) => a === '--release');
	const releaseArg = releaseIdx >= 0 ? args[releaseIdx + 1] : undefined;

	let releases: string[];
	if (allFlag) {
		releases = await listExistingReleases();
		if (releases.length === 0) {
			console.error('No releases found under static/openapi/');
			process.exit(1);
		}
	} else if (releaseArg) {
		releases = [releaseArg];
	} else {
		const existing = await listExistingReleases();
		if (existing.length === 0) {
			console.error('Usage: npm run generate:openapi-manifest -- --release <version>');
			process.exit(1);
		}
		releases = [existing.sort(compareReleaseDesc)[0]!];
	}

	for (const release of releases) {
		await buildManifestForRelease(release);
	}

	const allReleases = await listExistingReleases();
	if (allReleases.length > 0) {
		await updateReleasesYaml(allReleases.sort(compareReleaseDesc));
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
