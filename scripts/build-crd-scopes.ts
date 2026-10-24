/**
 * Record each CRD's scope (Namespaced / Cluster) in static/resources/<release>/manifest.json,
 * derived from the release's OpenAPI specs: a namespaced resource is served at
 * `/apps/<group>/<version>/namespaces/{namespace}/<plural>/{name}`, a cluster-scoped one at
 * `/apps/<group>/<version>/<plural>/{name}`. Releases without OpenAPI specs are left unchanged.
 *
 *   npm run build:crd-scopes
 *
 * Deterministic (no timestamps), so re-running on unchanged data changes nothing.
 */
import fs from 'fs/promises';
import path from 'path';

type Scope = 'Namespaced' | 'Cluster';
type ManifestEntry = { name: string; group?: string; kind?: string; scope?: Scope };

const NAMESPACED = /^\/apps\/([^/]+)\/[^/]+\/namespaces\/\{namespace\}\/([^/{}]+)\/\{name\}$/;
const CLUSTER = /^\/apps\/([^/]+)\/[^/]+\/([^/{}]+)\/\{name\}$/;

async function specFiles(dir: string): Promise<string[]> {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map(async (e) => {
			const full = path.join(dir, e.name);
			if (e.isDirectory()) return specFiles(full);
			return /\.json$/.test(e.name) && !/(api-index|manifest|_discovery)/.test(e.name) ? [full] : [];
		})
	);
	return nested.flat();
}

/** CRD name (`<plural>.<group>`) → scope, from the paths of every spec of one OpenAPI release. */
export async function scopesFromOpenApi(openapiDir: string): Promise<Map<string, Scope>> {
	const scopes = new Map<string, Scope>();
	for (const file of await specFiles(openapiDir)) {
		const spec = JSON.parse(await fs.readFile(file, 'utf8')) as { paths?: Record<string, unknown> };
		for (const p of Object.keys(spec.paths ?? {})) {
			const ns = NAMESPACED.exec(p);
			if (ns) {
				scopes.set(`${ns[2]}.${ns[1]}`, 'Namespaced');
				continue;
			}
			const cluster = CLUSTER.exec(p);
			if (cluster && cluster[2] !== 'namespaces') {
				const name = `${cluster[2]}.${cluster[1]}`;
				// A namespaced path seen elsewhere wins over a cluster-wide list/get path.
				if (scopes.get(name) !== 'Namespaced') scopes.set(name, 'Cluster');
			}
		}
	}
	return scopes;
}

async function main(): Promise<void> {
	const releases = (await fs.readdir('static/resources', { withFileTypes: true }))
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.sort();

	for (const release of releases) {
		const manifestPath = path.join('static/resources', release, 'manifest.json');
		const openapiDir = path.join('static/openapi', release);
		const hasOpenApi = await fs
			.stat(openapiDir)
			.then((s) => s.isDirectory())
			.catch(() => false);
		if (!hasOpenApi) {
			console.log(`${release}: no OpenAPI specs, skipped`);
			continue;
		}

		const scopes = await scopesFromOpenApi(openapiDir);
		const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as ManifestEntry[];
		let known = 0;
		let cluster = 0;
		const updated = manifest.map((entry) => {
			const scope = scopes.get(entry.name);
			if (!scope) return entry;
			known += 1;
			if (scope === 'Cluster') cluster += 1;
			return { ...entry, scope };
		});
		await fs.writeFile(manifestPath, `${JSON.stringify(updated, null, 2)}\n`);
		console.log(
			`${release}: scope for ${known}/${manifest.length} CRDs (${cluster} cluster-scoped)`
		);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
