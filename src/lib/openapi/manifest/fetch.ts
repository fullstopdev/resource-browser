import { getOpenApiManifestCache } from './cache';
import { filterOpenApiManifestEntriesWithPaths } from '../manifestPresentation';
import type { OpenApiManifestEntry } from '../types';

export async function fetchOpenApiManifest(
	releaseFolder: string,
	cache?: Map<string, OpenApiManifestEntry[]>,
	fetcher: typeof fetch = fetch
): Promise<OpenApiManifestEntry[] | null> {
	const store = cache ?? getOpenApiManifestCache();
	if (store.has(releaseFolder)) {
		return store.get(releaseFolder)!;
	}
	const resp = await fetcher(`/${releaseFolder}/manifest.json`);
	if (!resp.ok) return null;
	const manifest = filterOpenApiManifestEntriesWithPaths(
		(await resp.json()) as OpenApiManifestEntry[]
	);
	store.set(releaseFolder, manifest);
	return manifest;
}
