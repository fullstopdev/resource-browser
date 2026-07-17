import type { OpenApiManifestEntry } from '../types';

const manifestCache = new Map<string, OpenApiManifestEntry[]>();

export function getOpenApiManifestCache(): Map<string, OpenApiManifestEntry[]> {
	return manifestCache;
}

export function clearOpenApiManifestCache(): void {
	manifestCache.clear();
}
