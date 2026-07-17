import { filterOpenApiManifestEntriesWithPaths } from '$lib/openapi/manifestPresentation';
import type {
	OpenApiDiffEntry,
	OpenApiDiffStatus,
	OpenApiManifestEntry,
	OpenApiPathChange
} from '$lib/openapi/types';
import { compareVersionDesc } from '$lib/versions';

export type OpenApiManifestSide = {
	entry: OpenApiManifestEntry;
	side: 'source' | 'target' | 'both';
};

export type OpenApiManifestCompareResult = {
	added: OpenApiManifestEntry[];
	removed: OpenApiManifestEntry[];
	shared: Array<{
		source: OpenApiManifestEntry;
		target: OpenApiManifestEntry;
		pathCountDelta: number;
	}>;
};

/** Trailing Kubernetes-style API version segment (`/v1`, `/v1alpha1`, `/v2beta1`, …). */
const API_VERSION_SUFFIX = /\/v[\w.]+$/i;

/**
 * Family key for cross-version pairing.
 * Prefer manifest `group` (stable across apiVersion); fall back to stripping `/v…` from id.
 */
export function openApiApiFamilyKey(specId: string, group?: string): string {
	if (group?.trim()) return group.trim();
	const trimmed = specId.trim();
	const base = trimmed.replace(API_VERSION_SUFFIX, '');
	return base || trimmed;
}

/** Version segment only, e.g. `v1alpha1`, or null when the id has no version suffix. */
export function openApiApiVersion(specId: string): string | null {
	const match = API_VERSION_SUFFIX.exec(specId.trim());
	return match ? match[0].slice(1) : null;
}

function preferLatestManifestEntry(entries: OpenApiManifestEntry[]): OpenApiManifestEntry {
	return [...entries].sort((a, b) => {
		const va = a.apiVersion || openApiApiVersion(a.id) || '';
		const vb = b.apiVersion || openApiApiVersion(b.id) || '';
		if (va && vb) {
			const byVersion = compareVersionDesc(va, vb);
			if (byVersion !== 0) return byVersion;
		}
		return a.id.localeCompare(b.id);
	})[0]!;
}

function groupByFamily(entries: OpenApiManifestEntry[]): Map<string, OpenApiManifestEntry[]> {
	const map = new Map<string, OpenApiManifestEntry[]>();
	for (const entry of entries) {
		const key = openApiApiFamilyKey(entry.id, entry.group);
		const list = map.get(key);
		if (list) list.push(entry);
		else map.set(key, [entry]);
	}
	return map;
}

/**
 * Whether a diff row should appear in the API Diff report.
 * Uses target path count for added/shared/modified; source for removed.
 */
export function openApiDiffEntryHasListedPaths(entry: OpenApiDiffEntry): boolean {
	if (entry.status === 'removed') {
		return (entry.sourcePathCount ?? 0) > 0;
	}
	if (entry.status === 'added') {
		return (entry.targetPathCount ?? 0) > 0;
	}
	return (entry.targetPathCount ?? entry.sourcePathCount ?? 0) > 0;
}

export function filterOpenApiDiffEntriesWithPaths(
	entries: OpenApiDiffEntry[]
): OpenApiDiffEntry[] {
	return entries.filter(openApiDiffEntryHasListedPaths);
}

/**
 * Deterministic manifest-only compare: specs added, removed, or present in both.
 * Exact id matches first; remaining ids are paired by API family across version
 * bumps (e.g. `…/v1alpha1` ↔ `…/v1`).
 * Zero-path specs are excluded so schema-only entries do not appear as noise.
 */
export function compareOpenApiManifests(
	source: OpenApiManifestEntry[],
	target: OpenApiManifestEntry[]
): OpenApiManifestCompareResult {
	source = filterOpenApiManifestEntriesWithPaths(source);
	target = filterOpenApiManifestEntriesWithPaths(target);
	const sourceById = new Map(source.map((e) => [e.id, e]));
	const targetById = new Map(target.map((e) => [e.id, e]));
	const allIds = [...new Set([...sourceById.keys(), ...targetById.keys()])].sort((a, b) =>
		a.localeCompare(b)
	);

	const added: OpenApiManifestEntry[] = [];
	const removed: OpenApiManifestEntry[] = [];
	const shared: OpenApiManifestCompareResult['shared'] = [];
	const unmatchedSource: OpenApiManifestEntry[] = [];
	const unmatchedTarget: OpenApiManifestEntry[] = [];

	for (const id of allIds) {
		const src = sourceById.get(id);
		const tgt = targetById.get(id);
		if (!src && tgt) {
			unmatchedTarget.push(tgt);
		} else if (src && !tgt) {
			unmatchedSource.push(src);
		} else if (src && tgt) {
			shared.push({
				source: src,
				target: tgt,
				pathCountDelta: tgt.pathCount - src.pathCount
			});
		}
	}

	const sourceByFamily = groupByFamily(unmatchedSource);
	const targetByFamily = groupByFamily(unmatchedTarget);
	const pairedSourceIds = new Set<string>();
	const pairedTargetIds = new Set<string>();

	const familyKeys = [...new Set([...sourceByFamily.keys(), ...targetByFamily.keys()])].sort(
		(a, b) => a.localeCompare(b)
	);

	for (const family of familyKeys) {
		const srcList = sourceByFamily.get(family);
		const tgtList = targetByFamily.get(family);
		if (!srcList?.length || !tgtList?.length) continue;

		const src = preferLatestManifestEntry(srcList);
		const tgt = preferLatestManifestEntry(tgtList);
		shared.push({
			source: src,
			target: tgt,
			pathCountDelta: tgt.pathCount - src.pathCount
		});
		pairedSourceIds.add(src.id);
		pairedTargetIds.add(tgt.id);
	}

	for (const entry of unmatchedSource) {
		if (!pairedSourceIds.has(entry.id)) removed.push(entry);
	}
	for (const entry of unmatchedTarget) {
		if (!pairedTargetIds.has(entry.id)) added.push(entry);
	}

	added.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
	removed.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
	shared.sort(
		(a, b) =>
			a.target.title.localeCompare(b.target.title) || a.target.id.localeCompare(b.target.id)
	);

	return { added, removed, shared };
}

export function summarizeOpenApiEntries(entries: OpenApiDiffEntry[]): {
	added: number;
	removed: number;
	modified: number;
	apiVersion: number;
	unchanged: number;
	shared: number;
	error: number;
} {
	return {
		added: entries.filter((e) => e.status === 'added').length,
		removed: entries.filter((e) => e.status === 'removed').length,
		modified: entries.filter((e) => e.status === 'modified').length,
		apiVersion: entries.filter((e) => e.status === 'api_version').length,
		unchanged: entries.filter((e) => e.status === 'unchanged').length,
		shared: entries.filter((e) => e.status === 'shared').length,
		error: entries.filter((e) => e.status === 'error').length
	};
}

/** Build report entries from manifests only — no OpenAPI JSON loaded. */
export function buildManifestDiffEntries(
	source: OpenApiManifestEntry[],
	target: OpenApiManifestEntry[]
): OpenApiDiffEntry[] {
	const { added, removed, shared } = compareOpenApiManifests(source, target);
	const entries: OpenApiDiffEntry[] = [];

	for (const entry of added) {
		entries.push({
			specId: entry.id,
			title: entry.title,
			group: entry.group,
			status: 'added',
			pathChanges: [],
			schemaChanges: [],
			schemaSummary: { added: 0, removed: 0, modified: 0, apiVersion: 0 },
			detailsLoaded: true,
			sourcePathCount: undefined,
			targetPathCount: entry.pathCount,
			sourceFile: undefined,
			targetFile: entry.file
		});
	}

	for (const entry of removed) {
		entries.push({
			specId: entry.id,
			sourceSpecId: entry.id,
			title: entry.title,
			group: entry.group,
			status: 'removed',
			pathChanges: [],
			schemaChanges: [],
			schemaSummary: { added: 0, removed: 0, modified: 0, apiVersion: 0 },
			detailsLoaded: true,
			sourcePathCount: entry.pathCount,
			targetPathCount: undefined,
			sourceFile: entry.file,
			targetFile: undefined
		});
	}

	for (const item of shared) {
		const versionBumped = item.source.id !== item.target.id;
		entries.push({
			specId: item.target.id,
			sourceSpecId: versionBumped ? item.source.id : undefined,
			title: item.target.title,
			group: item.target.group,
			// Provisional until enrich — content → modified; identical/version-only → shared (stable).
			status: 'shared',
			pathChanges: [],
			schemaChanges: [],
			schemaSummary: { added: 0, removed: 0, modified: 0, apiVersion: 0 },
			detailsLoaded: false,
			sourcePathCount: item.source.pathCount,
			targetPathCount: item.target.pathCount,
			sourceFile: item.source.file,
			targetFile: item.target.file
		});
	}

	return filterOpenApiDiffEntriesWithPaths(entries);
}

export function pathChangeCounts(pathChanges: OpenApiPathChange[]): {
	added: number;
	removed: number;
	modified: number;
} {
	return {
		added: pathChanges.filter((c) => c.changeType === 'added').length,
		removed: pathChanges.filter((c) => c.changeType === 'removed').length,
		modified: pathChanges.filter((c) => c.changeType === 'modified').length
	};
}

export function statusLabel(status: OpenApiDiffStatus): string {
	switch (status) {
		case 'added':
			return 'Added';
		case 'removed':
			return 'Removed';
		case 'modified':
			return 'Modified';
		case 'api_version':
			// Legacy status — no longer assigned; fold into Shared for display.
			return 'Shared';
		case 'unchanged':
			return 'Unchanged';
		case 'shared':
			return 'Shared';
		case 'error':
			return 'Error';
		default:
			return status;
	}
}
