import { loadStaticYaml } from '$lib/yaml/safeYaml';
import {
	buildSearchIndex,
	ensureRenderable,
	indexMightMatch,
	prepareMatchSchema,
	pruneSchema,
	stripDescriptions
} from './schemaUtils';

import type { ManifestResource } from '$lib/manifest';
import { resolveEntryKind } from '$lib/manifest/lookup';

export type { ManifestResource };

export type SearchMatch = {
	name: string;
	kind?: string;
	version?: string;
	type: 'spec' | 'status';
	schema: unknown;
	fullSpec?: unknown;
	fullStatus?: unknown;
};

export type ParsedResource = {
	spec?: unknown;
	status?: unknown;
	specStripped?: unknown;
	statusStripped?: unknown;
	specIndex?: string;
	statusIndex?: string;
	specIndexWithDesc?: string;
	statusIndexWithDesc?: string;
};

export type SearchProgress = {
	matches: SearchMatch[];
	resourcesScanned: number;
	done: boolean;
};

export type SearchOptions = {
	releaseFolder: string;
	manifest: ManifestResource[];
	query: string;
	version: string;
	searchInDescription: boolean;
	maxResults: number;
	yamlCache: Map<string, string>;
	parsedCache: Map<string, ParsedResource>;
	isCancelled: () => boolean;
	onProgress?: (progress: SearchProgress) => void;
};

const FETCH_CONCURRENCY = 20;
const PREFETCH_CONCURRENCY = 12;
const BATCH_YIELD_EVERY = 8;

function resourceKey(name: string, ver: string): string {
	return `${name}::${ver}`;
}

function yamlCacheKey(releaseFolder: string, resName: string, ver: string): string {
	return `/${releaseFolder}/${resName}/${ver}.yaml`;
}

function yieldToMain(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function finalizeParsedResource(rawSpec: unknown, rawStatus: unknown): ParsedResource {
	const spec = rawSpec ? ensureRenderable(rawSpec) : undefined;
	const status = rawStatus ? ensureRenderable(rawStatus) : undefined;
	const entry: ParsedResource = { spec, status };

	if (spec && typeof spec === 'object') {
		entry.specStripped = stripDescriptions(spec);
		entry.specIndex = buildSearchIndex(entry.specStripped, false);
		entry.specIndexWithDesc = buildSearchIndex(spec, true);
	}
	if (status && typeof status === 'object') {
		entry.statusStripped = stripDescriptions(status);
		entry.statusIndex = buildSearchIndex(entry.statusStripped, false);
		entry.statusIndexWithDesc = buildSearchIndex(status, true);
	}

	return entry;
}

async function fetchYamlText(
	cacheKey: string,
	yamlCache: Map<string, string>
): Promise<string | null> {
	let txt = yamlCache.get(cacheKey);
	if (txt) return txt;

	const resp = await fetch(cacheKey);
	if (!resp.ok) return null;
	txt = await resp.text();
	yamlCache.set(cacheKey, txt);
	return txt;
}

async function loadParsedResource(
	releaseFolder: string,
	resName: string,
	ver: string,
	yamlCache: Map<string, string>,
	parsedCache: Map<string, ParsedResource>
): Promise<ParsedResource | null> {
	const cacheKey = yamlCacheKey(releaseFolder, resName, ver);
	if (parsedCache.has(cacheKey)) {
		return parsedCache.get(cacheKey)!;
	}

	const txt = await fetchYamlText(cacheKey, yamlCache);
	if (!txt) return null;

	try {
		const parsed = loadStaticYaml(txt) as {
			schema?: { openAPIV3Schema?: { properties?: { spec?: unknown; status?: unknown } } };
		};
		const rawSpec = parsed?.schema?.openAPIV3Schema?.properties?.spec;
		const rawStatus = parsed?.schema?.openAPIV3Schema?.properties?.status;
		const entry = finalizeParsedResource(rawSpec, rawStatus);
		parsedCache.set(cacheKey, entry);
		return entry;
	} catch {
		return null;
	}
}

function searchResourceVersion(
	res: ManifestResource,
	ver: string,
	parsed: ParsedResource,
	q: string,
	searchInDescription: boolean
): SearchMatch[] {
	const matches: SearchMatch[] = [];
	const { spec, status } = parsed;
	const fullSpec = spec;
	const fullStatus = status;

	if (spec && typeof spec === 'object') {
		const index = searchInDescription ? parsed.specIndexWithDesc : parsed.specIndex;
		if (!index || indexMightMatch(index, q)) {
			const searchNode = searchInDescription ? spec : (parsed.specStripped ?? spec);
			const pruned = pruneSchema(searchNode, q, searchInDescription);
			if (pruned) {
				matches.push({
					name: res.name,
					kind: resolveEntryKind(res),
					version: ver,
					type: 'spec',
					schema: prepareMatchSchema(pruned as Record<string, unknown>, spec as Record<string, unknown>),
					fullSpec,
					fullStatus
				});
			}
		}
	}

	if (status && typeof status === 'object') {
		const index = searchInDescription ? parsed.statusIndexWithDesc : parsed.statusIndex;
		if (!index || indexMightMatch(index, q)) {
			const searchNode = searchInDescription ? status : (parsed.statusStripped ?? status);
			const prunedStatus = pruneSchema(searchNode, q, searchInDescription);
			if (prunedStatus) {
				matches.push({
					name: res.name,
					kind: resolveEntryKind(res),
					version: ver,
					type: 'status',
					schema: prepareMatchSchema(
						prunedStatus as Record<string, unknown>,
						status as Record<string, unknown>
					),
					fullSpec,
					fullStatus
				});
			}
		}
	}

	return matches;
}

type WorkItem = { res: ManifestResource; ver: string };

function buildWorkQueue(manifest: ManifestResource[], version: string): WorkItem[] {
	const queue: WorkItem[] = [];
	for (const res of manifest) {
		if (!res?.name || res.name.toLowerCase().includes('states')) continue;
		const versions = version
			? [version]
			: (res.versions?.map((v) => v.name).filter(Boolean) ?? []);
		for (const ver of versions) {
			queue.push({ res, ver });
		}
	}
	return queue;
}

export async function searchManifest(options: SearchOptions): Promise<SearchMatch[]> {
	const {
		releaseFolder,
		manifest,
		query,
		version,
		searchInDescription,
		maxResults,
		yamlCache,
		parsedCache,
		isCancelled,
		onProgress
	} = options;

	const q = String(query ?? '').trim();
	if (!q) return [];

	const workQueue = buildWorkQueue(manifest, version);
	const matches: SearchMatch[] = [];
	const seenResources = new Set<string>();
	let resourcesScanned = 0;

	const emitProgress = (done: boolean) => {
		onProgress?.({ matches: [...matches], resourcesScanned, done });
	};

	for (let i = 0; i < workQueue.length; i += FETCH_CONCURRENCY) {
		if (isCancelled()) return matches;

		const batch = workQueue.slice(i, i + FETCH_CONCURRENCY);
		const batchResults = await Promise.all(
			batch.map(async ({ res, ver }) => {
				if (isCancelled()) return [] as SearchMatch[];
				const parsed = await loadParsedResource(
					releaseFolder,
					res.name,
					ver,
					yamlCache,
					parsedCache
				);
				if (!parsed) return [] as SearchMatch[];
				return searchResourceVersion(res, ver, parsed, q, searchInDescription);
			})
		);

		for (const resourceMatches of batchResults) {
			resourcesScanned++;
			for (const match of resourceMatches) {
				matches.push(match);
				seenResources.add(resourceKey(match.name, match.version ?? ''));
			}
			if (seenResources.size >= maxResults) {
				emitProgress(true);
				return matches;
			}
		}

		emitProgress(false);

		if ((i / FETCH_CONCURRENCY) % BATCH_YIELD_EVERY === 0) {
			await yieldToMain();
		}

		if (seenResources.size >= maxResults) break;
	}

	emitProgress(true);
	return matches;
}

const warmInFlight = new Map<string, Promise<void>>();

function warmKey(releaseFolder: string, version: string): string {
	return `${releaseFolder}::${version || '*'}`;
}

/** Fetch, parse, and index CRD schemas for a release (optionally filtered by version). */
export async function warmReleaseSchemas(
	releaseFolder: string,
	manifest: ManifestResource[],
	yamlCache: Map<string, string>,
	parsedCache: Map<string, ParsedResource>,
	version = ''
): Promise<void> {
	const key = warmKey(releaseFolder, version);
	const existing = warmInFlight.get(key);
	if (existing) return existing;

	const workQueue = buildWorkQueue(manifest, version).filter(
		({ res, ver }) => !parsedCache.has(yamlCacheKey(releaseFolder, res.name, ver))
	);
	if (workQueue.length === 0) return;

	const task = (async () => {
		for (let i = 0; i < workQueue.length; i += PREFETCH_CONCURRENCY) {
			const batch = workQueue.slice(i, i + PREFETCH_CONCURRENCY);
			await Promise.all(
				batch.map(({ res, ver }) =>
					loadParsedResource(releaseFolder, res.name, ver, yamlCache, parsedCache)
				)
			);
			await yieldToMain();
		}
	})().finally(() => {
		warmInFlight.delete(key);
	});

	warmInFlight.set(key, task);
	return task;
}

/** Warm schema caches in the background so the first search avoids cold fetches and parsing. */
export function prefetchReleaseSchemas(
	releaseFolder: string,
	manifest: ManifestResource[],
	yamlCache: Map<string, string>,
	parsedCache: Map<string, ParsedResource>,
	version = ''
): void {
	void warmReleaseSchemas(releaseFolder, manifest, yamlCache, parsedCache, version);
}

export { fetchManifest } from '$lib/manifest';
