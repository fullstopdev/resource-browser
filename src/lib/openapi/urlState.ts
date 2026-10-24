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

/** API reference URL for an API (spec id), optionally at an operation (`#operationId`). */
export function buildOpenApiSpecPath(specId: string, release?: string, operationId?: string): string {
	const params = new URLSearchParams();
	if (release) params.set('release', release);
	params.set('spec', specId);
	const hash = operationId ? `#${operationId}` : '';
	return `/openapi?${params.toString()}${hash}`;
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
