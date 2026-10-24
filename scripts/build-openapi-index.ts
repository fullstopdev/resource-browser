/**
 * Writes static/openapi/<release>/api-index.json: every API of the release with its resources,
 * workflows and platform sections (titles, scope, action counts). The API Explorer uses it for the
 * overview page and for searching across APIs without loading every spec.
 *
 *   npm run build:openapi-index            # every release
 *   npm run build:openapi-index -- 26.8.2  # one release
 *
 * Deterministic (no timestamps).
 */
import fs from 'fs';
import path from 'path';
import { buildPathBrowserData } from '../src/lib/openapi/pathBrowser';
import { apiShortTitle, buildApiSections, type ApiIndex } from '../src/lib/openapi/apiReference';

const ROOT = 'static/openapi';

type ManifestEntry = {
	id: string;
	title: string;
	group: string;
	apiVersion: string;
	file: string;
	pathCount: number;
	tags?: string[];
};

function crdKinds(release: string): Map<string, string> {
	const file = path.join('static/resources', release, 'manifest.json');
	if (!fs.existsSync(file)) return new Map();
	const list = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<{ name: string; kind?: string }>;
	return new Map(list.filter((c) => c.kind).map((c) => [c.name, c.kind!]));
}

function buildRelease(release: string): void {
	const dir = path.join(ROOT, release);
	const manifest = JSON.parse(
		fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')
	) as ManifestEntry[];
	const kinds = crdKinds(release);
	const index: ApiIndex = { release, apis: [] };
	for (const entry of manifest) {
		if (!entry.pathCount) continue;
		const spec = JSON.parse(fs.readFileSync(path.join(dir, entry.file), 'utf8'));
		const operations = buildPathBrowserData(spec).tagGroups.flatMap((g) => g.operations);
		const sections = buildApiSections(operations, {
			kindFor: (plural, group) => kinds.get(`${plural}.${group}`)
		});
		index.apis.push({
			id: entry.id,
			title: apiShortTitle(entry.title, entry.id),
			group: entry.group,
			version: entry.apiVersion,
			platform: entry.id === 'core',
			operationCount: operations.length,
			sections: sections
				.filter((s) => s.type !== 'discovery')
				.map((s) => ({
					key: s.key,
					type: s.type,
					title: s.title,
					...(s.scope ? { scope: s.scope } : {}),
					actions: s.actions.length
				}))
		});
	}
	index.apis.sort(
		(a, b) => Number(b.platform) - Number(a.platform) || a.title.localeCompare(b.title)
	);
	fs.writeFileSync(path.join(dir, 'api-index.json'), `${JSON.stringify(index)}\n`);
	const resources = index.apis.reduce((n, a) => n + a.sections.length, 0);
	console.log(`${release}: ${index.apis.length} APIs, ${resources} sections`);
}

const only = process.argv[2];
const releases = fs
	.readdirSync(ROOT, { withFileTypes: true })
	.filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, d.name, 'manifest.json')))
	.map((d) => d.name)
	.filter((name) => !only || name === only)
	.sort();
for (const release of releases) buildRelease(release);
