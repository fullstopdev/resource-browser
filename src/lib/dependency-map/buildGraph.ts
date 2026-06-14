import { loadStaticYaml } from '$lib/yaml/safeYaml';
import { fetchManifest, getManifestCache } from '$lib/manifest';
import type { ManifestResource } from '$lib/manifest';
import type { CrdResource, EdaRelease } from '$lib/structure';
import { releaseAssetPath } from '$lib/yaml-validation/schemaCache';
import { buildDependencyGraphFromResources, type ParsedCrdSchema } from './buildGraphCore';
import type { BuildProgress, DependencyGraph } from './types';
import { extractSubgraph } from './transitiveClosure';

const FETCH_CONCURRENCY = 10;
const graphCache = new Map<string, DependencyGraph>();

function yieldToMain(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadCrdSchema(
	releaseFolder: string,
	resourceName: string,
	version: string,
	yamlCache: Map<string, string>
): Promise<ParsedCrdSchema | null> {
	const cacheKey = `/${releaseFolder}/${resourceName}/${version}.yaml`;
	let txt = yamlCache.get(cacheKey);
	if (!txt) {
		const resp = await fetch(cacheKey);
		if (!resp.ok) return null;
		txt = await resp.text();
		yamlCache.set(cacheKey, txt);
	}

	try {
		const parsed = loadStaticYaml(txt) as {
			schema?: {
				openAPIV3Schema?: {
					description?: string;
					properties?: { spec?: unknown; status?: unknown; metadata?: unknown };
				};
			};
			spec?: {
				validation?: { openAPIV3Schema?: unknown };
				versions?: Array<{ schema?: { openAPIV3Schema?: unknown } }>;
			};
		};
		const root =
			parsed?.schema?.openAPIV3Schema ??
			parsed?.spec?.validation?.openAPIV3Schema ??
			null;
		return {
			openApiRoot: root ?? undefined,
			spec: root?.properties?.spec,
			status: root?.properties?.status,
			metadata: root?.properties?.metadata,
			description: root?.description
		};
	} catch {
		return null;
	}
}

async function tryLoadPrecomputedGraph(
	releaseFolder: string
): Promise<{ graph: DependencyGraph | null; missing: boolean }> {
	try {
		const resp = await fetch(releaseAssetPath(releaseFolder, 'dependency-graph.json'));
		if (resp.status === 404) return { graph: null, missing: true };
		if (!resp.ok) return { graph: null, missing: false };
		const graph = (await resp.json()) as DependencyGraph;
		if (!graph?.nodes?.length || !graph?.links) return { graph: null, missing: false };
		return { graph: { ...graph, precomputed: true }, missing: false };
	} catch {
		return { graph: null, missing: false };
	}
}

async function mapConcurrent<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	async function worker() {
		while (nextIndex < items.length) {
			const i = nextIndex++;
			results[i] = await fn(items[i], i);
		}
	}

	const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
	await Promise.all(workers);
	return results;
}

export function resolveFocusNodeId(
	resources: CrdResource[],
	params: { resource?: string | null; kind?: string | null; group?: string | null }
): string | null {
	const { resource, kind, group } = params;

	if (kind && group) {
		const match = resources.find((r) => r.kind === kind && r.group === group);
		if (match) return match.name;
	}

	if (!resource) return null;

	const byName = resources.find((r) => r.name === resource);
	if (byName) return byName.name;

	const byKind = resources.filter((r) => r.kind === resource);
	if (byKind.length === 1) return byKind[0].name;
	if (byKind.length > 1 && group) {
		const match = byKind.find((r) => r.group === group);
		if (match) return match.name;
	}

	const lower = resource.toLowerCase();
	const byShort = resources.find(
		(r) =>
			r.name.split('.')[0].toLowerCase() === lower ||
			(r.kind && r.kind.toLowerCase() === lower)
	);
	return byShort?.name ?? null;
}

export function buildFocusSubgraph(
	graph: DependencyGraph,
	focusNodeId: string
): DependencyGraph | null {
	return extractSubgraph(graph, focusNodeId);
}

export function clearDependencyGraphCache(releaseFolder?: string): void {
	if (releaseFolder) graphCache.delete(releaseFolder);
	else graphCache.clear();
}

export async function buildDependencyGraph(
	release: EdaRelease,
	options?: {
		cache?: Map<string, ManifestResource[]>;
		yamlCache?: Map<string, string>;
		onProgress?: (progress: BuildProgress) => void;
		signal?: AbortSignal;
		skipPrecomputed?: boolean;
	}
): Promise<DependencyGraph> {
	const manifestCache = options?.cache ?? getManifestCache();
	const yamlCache = options?.yamlCache ?? new Map<string, string>();

	if (graphCache.has(release.folder)) {
		return graphCache.get(release.folder)!;
	}

	if (!options?.skipPrecomputed) {
		const { graph: precomputed, missing } = await tryLoadPrecomputedGraph(release.folder);
		if (precomputed) {
			graphCache.set(release.folder, precomputed);
			options?.onProgress?.({
				phase: 'done',
				current: 1,
				total: 1,
				message: 'Loaded precomputed dependency graph'
			});
			return precomputed;
		}
		if (missing) {
			options?.onProgress?.({
				phase: 'manifest',
				current: 0,
				total: 1,
				message: 'Precomputed graph not found; building from schemas…'
			});
		}
	}

	options?.onProgress?.({
		phase: 'manifest',
		current: 0,
		total: 1,
		message: 'Loading manifest…'
	});

	const manifest = await fetchManifest(release.folder, manifestCache);
	if (!manifest) {
		return {
			nodes: [],
			links: [],
			releaseFolder: release.folder,
			generatedAt: new Date().toISOString()
		};
	}

	const resources = manifest as CrdResource[];
	const total = resources.length;

	options?.onProgress?.({
		phase: 'schemas',
		current: 0,
		total,
		message: 'Loading CRD schemas…'
	});

	let processed = 0;
	const schemaCache = new Map<string, ParsedCrdSchema | null>();

	await mapConcurrent(resources, FETCH_CONCURRENCY, async (res) => {
		if (options?.signal?.aborted) return;

		for (const version of res.versions.filter((v) => v?.name && !v.deprecated)) {
			const key = `${res.name}|${version.name}`;
			if (!schemaCache.has(key)) {
				schemaCache.set(key, await loadCrdSchema(release.folder, res.name, version.name, yamlCache));
			}
		}

		processed++;
		if (processed % 8 === 0 || processed === total) {
			options?.onProgress?.({
				phase: 'schemas',
				current: processed,
				total,
				message: `Analyzing schemas (${processed}/${total})…`
			});
			await yieldToMain();
		}
	});

	if (options?.signal?.aborted) {
		throw new DOMException('Aborted', 'AbortError');
	}

	options?.onProgress?.({
		phase: 'edges',
		current: total,
		total,
		message: 'Building dependency graph…'
	});

	const graph = await buildDependencyGraphFromResources(
		release.folder,
		resources,
		(resourceName, apiVersion) => schemaCache.get(`${resourceName}|${apiVersion}`) ?? null
	);

	graphCache.set(release.folder, graph);

	options?.onProgress?.({
		phase: 'done',
		current: total,
		total,
		message: 'Done'
	});

	return graph;
}

export { extractSubgraph } from './transitiveClosure';
