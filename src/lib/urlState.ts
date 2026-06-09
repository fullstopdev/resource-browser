import { displayKind } from '$lib/resourceSearch';
import type { CrdResource, EdaRelease } from '$lib/structure';
import { ALL_VERSIONS_SCOPE } from '$lib/spec-search/searchEngine';

/**
 * Deep-link query param conventions (shareable permalinks):
 *
 * Catalog (`/`):
 *   - `release` — EDA release version, e.g. `26.4.2`
 *   - `crd` — CRD kind (e.g. `NetworkInstance`) or manifest FQDN; legacy aliases: `resource`, `kind`
 *   - `version` — API version when the CRD modal is open, e.g. `v1`
 *   - `browse=true` — legacy; browse mode is implied when `release` or `crd` is present
 *
 * Comparison (`/comparison`):
 *   - `sr` / `sv` — source release name and API version
 *   - `tr` / `tv` — target release name and API version
 *
 * Spec search (`/spec-search`):
 *   - `release` — EDA release version
 *   - `version` — API version filter; omitted for “Latest per CRD”; `*` for all versions
 *   - `q` — search query
 */

export type CatalogUrlState = {
	release?: string;
	/** Kind name or manifest FQDN */
	crd?: string;
	version?: string;
	/** Legacy flag; parsed but not emitted when building URLs */
	browse?: boolean;
};

export type ComparisonUrlState = {
	sourceRelease?: string;
	sourceVersion?: string;
	targetRelease?: string;
	targetVersion?: string;
};

export type SpecSearchUrlState = {
	release?: string;
	version?: string;
	query?: string;
};

export function resolveReleaseByName(
	releases: EdaRelease[],
	name: string | null | undefined
): EdaRelease | null {
	if (!name) return null;
	return releases.find((r) => r.name === name) ?? null;
}

export function resolveReleaseName(
	releases: EdaRelease[],
	name: string | null | undefined,
	fallback?: EdaRelease
): string {
	const found = resolveReleaseByName(releases, name);
	if (found) return found.name;
	return fallback?.name ?? releases.find((r) => r.default)?.name ?? releases[0]?.name ?? '';
}

/** Resolve a catalog `crd` param to a manifest entry (FQDN, kind, or short name). */
export function resolveCrdFromParam(
	resources: CrdResource[],
	param: string | null | undefined
): CrdResource | null {
	if (!param?.trim()) return null;
	const trimmed = param.trim();

	const byName = resources.find((r) => r.name === trimmed);
	if (byName) return byName;

	const lower = trimmed.toLowerCase();
	const byKind = resources.find((r) => displayKind(r).toLowerCase() === lower);
	if (byKind) return byKind;

	const byShort = resources.find((r) => r.name.split('.')[0].toLowerCase() === lower);
	return byShort ?? null;
}

/** Prefer kind for shareable catalog links; fall back to manifest FQDN. */
export function crdParamForResource(resource: CrdResource): string {
	const kind = displayKind(resource);
	return kind || resource.name;
}

export function parseCatalogParams(params: URLSearchParams): CatalogUrlState {
	const release = params.get('release')?.trim() || undefined;
	const crd =
		params.get('crd')?.trim() ||
		params.get('resource')?.trim() ||
		params.get('kind')?.trim() ||
		undefined;
	const version = params.get('version')?.trim() || undefined;
	const browse = params.get('browse') === 'true';
	return { release, crd, version, browse: browse || undefined };
}

export function buildCatalogSearchParams(state: CatalogUrlState): URLSearchParams {
	const params = new URLSearchParams();
	if (state.release) params.set('release', state.release);
	if (state.crd) params.set('crd', state.crd);
	if (state.version) params.set('version', state.version);
	return params;
}

export function buildCatalogPath(state: CatalogUrlState): string {
	const params = buildCatalogSearchParams(state);
	const qs = params.toString();
	return qs ? `/?${qs}` : '/';
}

export function catalogBrowseFromParams(params: URLSearchParams): boolean {
	const parsed = parseCatalogParams(params);
	return !!(parsed.browse || parsed.release || parsed.crd);
}

export function parseComparisonParams(params: URLSearchParams): ComparisonUrlState {
	return {
		sourceRelease: params.get('sr')?.trim() || undefined,
		sourceVersion: params.get('sv')?.trim() || undefined,
		targetRelease: params.get('tr')?.trim() || undefined,
		targetVersion: params.get('tv')?.trim() || undefined
	};
}

export function buildComparisonSearchParams(state: ComparisonUrlState): URLSearchParams {
	const params = new URLSearchParams();
	if (state.sourceRelease) params.set('sr', state.sourceRelease);
	if (state.sourceVersion) params.set('sv', state.sourceVersion);
	if (state.targetRelease) params.set('tr', state.targetRelease);
	if (state.targetVersion) params.set('tv', state.targetVersion);
	return params;
}

export function buildComparisonPath(state: ComparisonUrlState): string {
	const params = buildComparisonSearchParams(state);
	const qs = params.toString();
	return qs ? `/comparison?${qs}` : '/comparison';
}

export function parseSpecSearchParams(params: URLSearchParams): SpecSearchUrlState {
	return {
		release: params.get('release')?.trim() || undefined,
		version: params.get('version')?.trim() || undefined,
		query: params.get('q')?.trim() || undefined
	};
}

/** Omit `version` for “Latest per CRD”; keep `*` for all-versions scope. */
export function buildSpecSearchSearchParams(state: SpecSearchUrlState): URLSearchParams {
	const params = new URLSearchParams();
	if (state.release) params.set('release', state.release);
	if (state.version) params.set('version', state.version);
	if (state.query?.trim()) params.set('q', state.query.trim());
	return params;
}

export function buildSpecSearchPath(state: SpecSearchUrlState): string {
	const params = buildSpecSearchSearchParams(state);
	const qs = params.toString();
	return qs ? `/spec-search?${qs}` : '/spec-search';
}

export function normalizeSpecSearchVersion(
	version: string | null | undefined,
	validVersions: string[]
): string {
	if (!version) return '';
	if (version === ALL_VERSIONS_SCOPE) return ALL_VERSIONS_SCOPE;
	return validVersions.includes(version) ? version : '';
}
