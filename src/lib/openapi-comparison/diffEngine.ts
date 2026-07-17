import { fetchOpenApiManifest, loadOpenApiSpec } from '$lib/openapi';
import { filterOpenApiManifestEntriesWithPaths } from '$lib/openapi/manifestPresentation';
import type {
	OpenApiBulkDiffReport,
	OpenApiDiffEntry,
	OpenApiManifestEntry,
	OpenApiRelease
} from '$lib/openapi/types';
import {
	buildManifestDiffEntries,
	summarizeOpenApiEntries
} from './compareReleases';
import { classifyOpenApiDiffStatus, compareOpenApiSpecs } from './openapiDiff';

const BATCH_SIZE = 8;

export function mergeOpenApiCatalogs(
	source: OpenApiManifestEntry[],
	target: OpenApiManifestEntry[]
): OpenApiManifestEntry[] {
	const byId = new Map<string, OpenApiManifestEntry>();
	for (const entry of filterOpenApiManifestEntriesWithPaths([...source, ...target])) {
		if (!byId.has(entry.id)) byId.set(entry.id, entry);
	}
	return Array.from(byId.values()).sort(
		(a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
	);
}

export type OpenApiDiffLoadOptions = {
	manifestCache?: Map<string, OpenApiManifestEntry[]>;
	specCache?: Map<string, Record<string, unknown>>;
	fetcher?: typeof fetch;
	onProgress?: (current: number, total: number) => void;
};

/** Fast path: compare manifests only (no OpenAPI JSON). Dual-present specs stay provisional shared. */
export async function generateOpenApiManifestDiffReport(
	sourceRelease: OpenApiRelease,
	targetRelease: OpenApiRelease,
	options?: OpenApiDiffLoadOptions
): Promise<OpenApiBulkDiffReport> {
	const fetcher = options?.fetcher ?? fetch;
	const manifestCache = options?.manifestCache ?? new Map();

	const [sourceManifest, targetManifest] = await Promise.all([
		fetchOpenApiManifest(sourceRelease.folder, manifestCache, fetcher),
		fetchOpenApiManifest(targetRelease.folder, manifestCache, fetcher)
	]);

	if (!sourceManifest || !targetManifest) {
		throw new Error('Failed to load OpenAPI manifests for one or both releases');
	}

	const entries = buildManifestDiffEntries(sourceManifest, targetManifest);
	return {
		sourceRelease: sourceRelease.name,
		targetRelease: targetRelease.name,
		entries,
		summary: summarizeOpenApiEntries(entries)
	};
}

/** Load both specs for one shared entry and fill path/schema details. */
export async function enrichOpenApiDiffEntry(
	entry: OpenApiDiffEntry,
	sourceRelease: OpenApiRelease,
	targetRelease: OpenApiRelease,
	options?: OpenApiDiffLoadOptions
): Promise<OpenApiDiffEntry> {
	if (entry.status === 'added' || entry.status === 'removed') {
		return { ...entry, detailsLoaded: true };
	}
	if (entry.detailsLoaded) {
		return entry;
	}

	const fetcher = options?.fetcher ?? fetch;
	const specCache = options?.specCache ?? new Map();
	const sourceFile = entry.sourceFile;
	const targetFile = entry.targetFile;

	if (!sourceFile || !targetFile) {
		return {
			...entry,
			status: 'error',
			detailsLoaded: true,
			error: 'Missing spec file paths for comparison'
		};
	}

	const sourceKey = `${sourceRelease.folder}:${sourceFile}`;
	const targetKey = `${targetRelease.folder}:${targetFile}`;

	let sourceSpec = specCache.get(sourceKey);
	if (!sourceSpec) {
		sourceSpec = (await loadOpenApiSpec(sourceRelease.folder, sourceFile, fetcher)) ?? undefined;
		if (sourceSpec) specCache.set(sourceKey, sourceSpec);
	}
	let targetSpec = specCache.get(targetKey);
	if (!targetSpec) {
		targetSpec = (await loadOpenApiSpec(targetRelease.folder, targetFile, fetcher)) ?? undefined;
		if (targetSpec) specCache.set(targetKey, targetSpec);
	}

	if (!sourceSpec || !targetSpec) {
		return {
			...entry,
			status: 'error',
			detailsLoaded: true,
			error: 'Failed to load one or both spec files'
		};
	}

	const { pathChanges, schemaChanges, schemaSummary } = compareOpenApiSpecs(sourceSpec, targetSpec);
	const versionBumped = !!(entry.sourceSpecId && entry.sourceSpecId !== entry.specId);
	const status = classifyOpenApiDiffStatus(pathChanges, schemaChanges, schemaSummary, {
		versionBumped
	});

	return {
		...entry,
		status,
		pathChanges,
		schemaChanges,
		schemaSummary,
		detailsLoaded: true,
		error: undefined
	};
}

/**
 * Full report (CRD-style): manifest-first, then enrich every dual-present spec in batches.
 * After enrich, status is stable `modified` | `shared` | `error` — filters never reclassify.
 */
export async function generateOpenApiBulkDiffReport(
	sourceRelease: OpenApiRelease,
	targetRelease: OpenApiRelease,
	options?: OpenApiDiffLoadOptions
): Promise<OpenApiBulkDiffReport> {
	const report = await generateOpenApiManifestDiffReport(sourceRelease, targetRelease, options);
	const pending = report.entries.filter((e) => !e.detailsLoaded);
	const others = report.entries.filter((e) => e.detailsLoaded);
	const enriched: OpenApiDiffEntry[] = [...others];
	const specCache = options?.specCache ?? new Map();

	for (let i = 0; i < pending.length; i += BATCH_SIZE) {
		const batch = pending.slice(i, i + BATCH_SIZE);
		const results = await Promise.all(
			batch.map((entry) =>
				enrichOpenApiDiffEntry(entry, sourceRelease, targetRelease, {
					...options,
					specCache
				})
			)
		);
		enriched.push(...results);
		options?.onProgress?.(Math.min(i + batch.length, pending.length), pending.length);
	}

	enriched.sort((a, b) => a.title.localeCompare(b.title) || a.specId.localeCompare(b.specId));

	return {
		sourceRelease: sourceRelease.name,
		targetRelease: targetRelease.name,
		entries: enriched,
		summary: summarizeOpenApiEntries(enriched)
	};
}

export function replaceEntryInReport(
	report: OpenApiBulkDiffReport,
	updated: OpenApiDiffEntry
): OpenApiBulkDiffReport {
	const entries = report.entries.map((e) => (e.specId === updated.specId ? updated : e));
	return {
		...report,
		entries,
		summary: summarizeOpenApiEntries(entries)
	};
}
