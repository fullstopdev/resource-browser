import type { OpenApiManifestEntry } from './types';

/** Coerce manifest pathCount; missing/invalid values count as 0. */
export function openApiManifestPathCount(
	entry: Pick<OpenApiManifestEntry, 'pathCount'>
): number {
	const n = entry.pathCount;
	return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** True when the catalog entry exposes at least one OpenAPI path. */
export function openApiManifestEntryHasPaths(
	entry: Pick<OpenApiManifestEntry, 'pathCount'>
): boolean {
	return openApiManifestPathCount(entry) > 0;
}

/**
 * Hide schema-only / empty specs from OpenAPI browse and comparison catalogs.
 * Specs with `pathCount === 0` are excluded.
 */
export function filterOpenApiManifestEntriesWithPaths<
	T extends Pick<OpenApiManifestEntry, 'pathCount'>
>(entries: T[]): T[] {
	return entries.filter(openApiManifestEntryHasPaths);
}

/** Human-readable label for manifest entries in selectors and catalogs. */
export function formatOpenApiManifestLabel(entry: OpenApiManifestEntry): string {
	return entry.title;
}

/** Sort manifest groups with API Server first, then alphabetically. */
export function compareOpenApiManifestGroups(a: string, b: string): number {
	if (a === b) return 0;
	if (a === 'API Server') return -1;
	if (b === 'API Server') return 1;
	return a.localeCompare(b);
}

export const CORE_API_SERVER_SPEC_ID = 'core';

export function coreApiServerSpecHref(releaseName: string): string {
	const params = new URLSearchParams({ release: releaseName, spec: CORE_API_SERVER_SPEC_ID });
	return `/openapi?${params}`;
}

/** Default OpenAPI spec id when the catalog loads without an explicit selection. */
export function defaultOpenApiSpecId(manifest: { id: string }[]): string {
	return manifest.some((entry) => entry.id === CORE_API_SERVER_SPEC_ID)
		? CORE_API_SERVER_SPEC_ID
		: (manifest[0]?.id ?? '');
}

/**
 * Pick a spec for a release manifest: keep `preferredId` when present,
 * otherwise fall back to core / first entry via {@link defaultOpenApiSpecId}.
 */
export function resolveOpenApiSpecId(
	manifest: { id: string }[],
	preferredId?: string | null
): string {
	const preferred = preferredId?.trim() ?? '';
	if (preferred && manifest.some((entry) => entry.id === preferred)) {
		return preferred;
	}
	return defaultOpenApiSpecId(manifest);
}
