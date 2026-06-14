/**
 * Audit dependency extraction coverage for a release corpus.
 *
 * Usage:
 *   RELEASE=26.4.2 npm run audit:dependencies
 */
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { auditManifestResources } from '../src/lib/dependency-map/auditCorpus';
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
			return parsed.schema?.openAPIV3Schema ?? null;
		} catch {
			return null;
		}
	};
}

async function main() {
	const releaseFolder = await resolveReleaseFolder(RELEASE);
	const manifestPath = path.join(ROOT, 'static', releaseFolder, 'manifest.json');
	const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as CrdResource[];

	const graphPath = path.join(ROOT, 'static', releaseFolder, 'dependency-graph.json');
	let graphLinks: Array<{ source: string; target: string }> | undefined;
	try {
		const graph = JSON.parse(await fs.readFile(graphPath, 'utf8')) as {
			links?: Array<{ source: string; target: string }>;
		};
		graphLinks = graph.links;
	} catch {
		graphLinks = undefined;
	}

	const { audits, refStemAudits, metaInterfaceAudits, selectorIntentAudits, summary } =
		auditManifestResources(releaseFolder, manifest, loadOpenApiFromDisk(releaseFolder), graphLinks);

	const outDir = path.join(ROOT, 'static', releaseFolder);
	await fs.writeFile(
		path.join(outDir, 'dependency-audit.json'),
		JSON.stringify(
			{ summary, audits, refStemAudits, metaInterfaceAudits, selectorIntentAudits },
			null,
			2
		)
	);

	const md = [
		`# Dependency corpus audit — ${RELEASE}`,
		'',
		`| Metric | Count |`,
		`|--------|------:|`,
		`| Total reference fields | ${summary.totalReferenceFields} |`,
		`| Matched | ${summary.matched} |`,
		`| Unmatched | ${summary.unmatched} |`,
		`| Unresolved | ${summary.unresolved} |`,
		`| Skipped (meta/selectors) | ${summary.skipped} |`,
		`| Match rate (excl. skipped) | ${(summary.matchRate * 100).toFixed(1)}% |`,
		`| *Ref stem match rate | ${(summary.refFieldStems.rate * 100).toFixed(1)}% |`,
		`| *Ref stems matched | ${summary.refFieldStems.matched}/${summary.refFieldStems.total} |`,
		`| Meta-interface match rate | ${(summary.metaInterface.rate * 100).toFixed(1)}% |`,
		`| Meta-interface matched | ${summary.metaInterface.matched}/${summary.metaInterface.total} |`,
		`| Selector intent match rate | ${(summary.selectorIntent.rate * 100).toFixed(1)}% |`,
		`| Selector intent matched | ${summary.selectorIntent.matched}/${summary.selectorIntent.total} |`,
		'',
		'## Dependency gap report (selector intent without graph edge)',
		'',
		...(summary.dependencyGapReport.length > 0
			? summary.dependencyGapReport
					.slice(0, 15)
					.map(
						(g) =>
							`- **${g.kind}** \`${g.fieldPath}\` → ${g.expectedKind} (${g.crdId})`
					)
			: ['- None']),
		'',
		'## Lowest coverage CRDs',
		'',
		...summary.byCrd
			.filter((c) => c.total >= 3)
			.slice(0, 15)
			.map((c) => `- **${c.kind}** (${c.crdId}): ${c.matched}/${c.total} (${(c.rate * 100).toFixed(0)}%)`)
	].join('\n');

	await fs.writeFile(path.join(outDir, 'dependency-audit.md'), md);

	console.log(summary);
	console.log(`Wrote ${outDir}/dependency-audit.json`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
