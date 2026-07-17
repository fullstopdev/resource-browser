import type { OpenApiRelease } from './types';

export type OpenApiCatalogUrlState = {
	release?: string;
	spec?: string;
	query?: string;
};

export type OpenApiComparisonUrlState = {
	sourceRelease?: string;
	targetRelease?: string;
};

/** Default / latest OpenAPI release (`default: true`, else first in list). */
export function defaultOpenApiRelease(
	releases: OpenApiRelease[],
	fallback?: OpenApiRelease
): OpenApiRelease | null {
	return fallback ?? releases.find((r) => r.default) ?? releases[0] ?? null;
}

export function resolveOpenApiRelease(
	releases: OpenApiRelease[],
	name: string | null | undefined,
	fallback?: OpenApiRelease
): OpenApiRelease | null {
	if (!name) return defaultOpenApiRelease(releases, fallback);
	return releases.find((r) => r.name === name) ?? fallback ?? null;
}

/**
 * Map a CRD (or other) release name onto an OpenAPI release.
 * Prefer an exact match; otherwise fall back to the OpenAPI default/latest.
 */
export function resolveOpenApiReleaseName(
	releases: OpenApiRelease[],
	preferredName: string | null | undefined
): string {
	const preferred = preferredName?.trim() ?? '';
	if (preferred && releases.some((r) => r.name === preferred)) return preferred;
	return defaultOpenApiRelease(releases)?.name ?? preferred;
}

export function buildOpenApiCatalogPath(state: OpenApiCatalogUrlState): string {
	const params = new URLSearchParams();
	if (state.release) params.set('release', state.release);
	if (state.spec) params.set('spec', state.spec);
	if (state.query) params.set('q', state.query);
	const qs = params.toString();
	return qs ? `/openapi?${qs}` : '/openapi';
}

/** Build an OpenAPI browser URL for a specific spec (query-param based). */
export function buildOpenApiSpecPath(
	specId: string,
	release?: string,
	tab?: 'paths' | 'schemaGraph' | 'schemas',
	operationId?: string,
	options?: { schema?: string; op?: string }
): string {
	const params = new URLSearchParams();
	if (release) params.set('release', release);
	params.set('spec', specId);
	// Legacy `schemas` tab redirects to Schema Graph (Schemas browser removed).
	if (tab === 'schemaGraph' || tab === 'schemas') params.set('tab', 'schemaGraph');
	const op = options?.op?.trim();
	const schema = options?.schema?.trim();
	if (op) params.set('op', op);
	else if (schema) params.set('schema', schema);
	const qs = params.toString();
	const hash = operationId ? `#${operationId}` : '';
	return `/openapi?${qs}${hash}`;
}

/** Build a deep-link path under `/api-browser/<release>/<spec>#operationId`. */
export function buildApiBrowserDeepLinkPath(
	release: string,
	specId: string,
	operationId?: string
): string {
	const encoded = encodeSpecIdPathSegments(specId);
	const hash = operationId ? `#${operationId}` : '';
	return `/api-browser/${encodeURIComponent(release)}/${encoded}${hash}`;
}

export function encodeSpecIdPathSegments(specId: string): string {
	return specId
		.split('/')
		.filter(Boolean)
		.map((segment) => encodeURIComponent(segment))
		.join('/');
}

export function buildOpenApiComparisonPath(state: OpenApiComparisonUrlState): string {
	const params = new URLSearchParams();
	if (state.sourceRelease) params.set('sr', state.sourceRelease);
	if (state.targetRelease) params.set('tr', state.targetRelease);
	const qs = params.toString();
	return qs ? `/openapi-comparison?${qs}` : '/openapi-comparison';
}

export function parseOpenApiComparisonParams(
	searchParams: URLSearchParams
): OpenApiComparisonUrlState {
	return {
		sourceRelease: searchParams.get('sr') ?? undefined,
		targetRelease: searchParams.get('tr') ?? undefined
	};
}

export function encodeSpecIdForRoute(specId: string): string {
	return encodeURIComponent(specId);
}

export function decodeSpecIdFromRoute(param: string | undefined): string {
	if (!param) return '';
	return param
		.split('/')
		.filter(Boolean)
		.map((segment) => decodeURIComponent(segment))
		.join('/');
}
