/**
 * Precompute dependency graph JSON for a release (served from static/resources).
 *
 * Usage:
 *   RELEASE=26.4.2 npm run build:dependency-graph
 */
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { buildDependencyGraphFromResources } from '../src/lib/dependency-map/buildGraphCore';
import { loadStaticYaml } from '../src/lib/yaml/safeYaml';
import type { CrdResource, ReleasesConfig } from '../src/lib/structure';

const ROOT = process.cwd();
const RELEASE = process.env.RELEASE ?? '26.4.2';

async function resolveReleaseFolder(releaseName: string): Promise<string> {
	const raw = await fs.readFile(path.join(ROOT, 'src/lib/releases.yaml'), 'utf8');
	const config = yaml.load(raw, { schema: yaml.CORE_SCHEMA }) as ReleasesConfig;
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

async function main() {
	const releaseFolder = await resolveReleaseFolder(RELEASE);
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

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
