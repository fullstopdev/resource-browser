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
import { getLatestVersion } from '$lib/versions';

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

const FETCH_CONCURRENCY = 16;
const PREFETCH_CONCURRENCY = 10;
const BATCH_YIELD_EVERY = 8;

/** Explicit opt-in to scan every API version per CRD. Empty version = latest only. */
export const ALL_VERSIONS_SCOPE = '*';

function resourceKey(name: string, ver: string): string {
	return `${name}::${ver}`;
}

function yamlCacheKey(releaseFolder: string, resName: string, ver: string): string {
	return `/${releaseFolder}/${resName}/${ver}.yaml`;
}

function wantsAllVersions(version: string): boolean {
	return version === ALL_VERSIONS_SCOPE || version === 'all';
}

function yieldToMain(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function finalizeParsedResource(rawSpec: unknown, rawStatus: unknown): ParsedResource {
	return {
		spec: rawSpec ? ensureRenderable(rawSpec) : undefined,
		status: rawStatus ? ensureRenderable(rawStatus) : undefined
	};
}

/** Build search indexes on demand — avoids expensive tree walks during background warm. */
function ensureSearchIndexes(parsed: ParsedResource, searchInDescription: boolean): void {
	const { spec, status } = parsed;

	if (spec && typeof spec === 'object') {
		if (searchInDescription) {
			if (!parsed.specIndexWithDesc) {
				parsed.specIndexWithDesc = buildSearchIndex(spec, true);
			}
		} else {
			if (!parsed.specStripped) parsed.specStripped = stripDescriptions(spec);
			if (!parsed.specIndex) parsed.specIndex = buildSearchIndex(parsed.specStripped, false);
		}
	}

	if (status && typeof status === 'object') {
		if (searchInDescription) {
			if (!parsed.statusIndexWithDesc) {
				parsed.statusIndexWithDesc = buildSearchIndex(status, true);
			}
		} else {
			if (!parsed.statusStripped) parsed.statusStripped = stripDescriptions(status);
			if (!parsed.statusIndex) parsed.statusIndex = buildSearchIndex(parsed.statusStripped, false);
		}
	}
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
	ensureSearchIndexes(parsed, searchInDescription);

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

export function buildSearchWorkQueue(manifest: ManifestResource[], version: string): WorkItem[] {
	const queue: WorkItem[] = [];
	for (const res of manifest) {
		if (!res?.name || res.name.toLowerCase().includes('states')) continue;
		const versions = wantsAllVersions(version)
			? (res.versions?.map((v) => v.name).filter(Boolean) ?? [])
			: version
				? [version]
				: [getLatestVersion(res)].filter(Boolean);
		for (const ver of versions) {
			queue.push({ res, ver });
		}
	}
	return queue;
}

function orderWorkQueue(
	workQueue: WorkItem[],
	releaseFolder: string,
	parsedCache: Map<string, ParsedResource>
): WorkItem[] {
	const cached: WorkItem[] = [];
	const pending: WorkItem[] = [];
	for (const item of workQueue) {
		const key = yamlCacheKey(releaseFolder, item.res.name, item.ver);
		if (parsedCache.has(key)) cached.push(item);
		else pending.push(item);
	}
	return cached.length > 0 ? [...cached, ...pending] : workQueue;
}

async function processWorkBatch(
	releaseFolder: string,
	batch: WorkItem[],
	q: string,
	searchInDescription: boolean,
	yamlCache: Map<string, string>,
	parsedCache: Map<string, ParsedResource>,
	isCancelled: () => boolean
): Promise<SearchMatch[][]> {
	return Promise.all(
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

	const workQueue = orderWorkQueue(
		buildSearchWorkQueue(manifest, version),
		releaseFolder,
		parsedCache
	);
	const matches: SearchMatch[] = [];
	const seenResources = new Set<string>();
	let resourcesScanned = 0;

	const emitProgress = (done: boolean) => {
		onProgress?.({ matches: [...matches], resourcesScanned, done });
	};

	for (let i = 0; i < workQueue.length; i += FETCH_CONCURRENCY) {
		if (isCancelled()) return matches;

		const batch = workQueue.slice(i, i + FETCH_CONCURRENCY);
		const batchResults = await processWorkBatch(
			releaseFolder,
			batch,
			q,
			searchInDescription,
			yamlCache,
			parsedCache,
			isCancelled
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
	return `${releaseFolder}::${version || 'latest'}`;
}

/** Fetch and parse CRD schemas for a release (optionally filtered by version). */
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

	const workQueue = buildSearchWorkQueue(manifest, version).filter(
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

/** Warm schema caches in the background so repeat searches avoid cold fetches. */
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
