import type { ReleaseNotesEntry, ReleaseNotesSummary } from './types';
import { countDeprecatedApiVersions } from './deprecation';
import { countOperationalChanges } from './presentation';

export type ReleaseNotesIndexEntry = {
	toVer: string;
	fromVer: string;
	source: 'comparison' | 'mock';
	timestamp: number;
	summary: ReleaseNotesSummary;
};

export type ReleaseNotesIndex = {
	generatedAt: string;
	latest: string;
	entries: ReleaseNotesIndexEntry[];
};

export type ReleaseNotesBundle = {
	generatedAt: string;
	latest: string;
	entries: ReleaseNotesEntry[];
};

type FetchFn = typeof fetch;

function fallbackSummary(entry: ReleaseNotesEntry): ReleaseNotesSummary {
	return {
		added: entry.notes.newResources.length,
		removed: entry.notes.removedResources.length,
		modified: entry.notes.modifiedResources.length,
		deprecated: countDeprecatedApiVersions(entry.notes.deprecated),
		unchanged: 0,
		specChanges: countOperationalChanges(entry.notes)
	};
}

export function normalizeReleaseNotesEntry(entry: ReleaseNotesEntry): ReleaseNotesEntry {
	return entry.summary ? entry : { ...entry, summary: fallbackSummary(entry) };
}

function sortReleaseHistory(entries: ReleaseNotesEntry[]): ReleaseNotesEntry[] {
	return entries
		.map(normalizeReleaseNotesEntry)
		.sort((a, b) => b.toVer.localeCompare(a.toVer, undefined, { numeric: true }));
}

export function indexFromHistory(
	generatedAt: string,
	latest: string,
	entries: ReleaseNotesEntry[]
): ReleaseNotesIndex {
	return {
		generatedAt,
		latest,
		entries: sortReleaseHistory(entries).map((entry) => ({
			toVer: entry.toVer,
			fromVer: entry.fromVer,
			source: entry.source,
			timestamp: entry.timestamp,
			summary: entry.summary ?? fallbackSummary(entry)
		}))
	};
}

export async function fetchReleaseNotesBundle(
	fetchFn: FetchFn = fetch
): Promise<ReleaseNotesBundle | null> {
	const resp = await fetchFn('/release-notes/bundle.json');
	if (!resp.ok) return null;
	return (await resp.json()) as ReleaseNotesBundle;
}

export async function fetchReleaseNotesIndex(
	fetchFn: FetchFn = fetch
): Promise<ReleaseNotesIndex | null> {
	const resp = await fetchFn('/release-notes/index.json');
	if (!resp.ok) return null;
	return (await resp.json()) as ReleaseNotesIndex;
}

export async function fetchReleaseNotesEntry(
	toVer: string,
	fetchFn: FetchFn = fetch
): Promise<ReleaseNotesEntry | null> {
	const resp = await fetchFn(`/release-notes/${encodeURIComponent(toVer)}.json`);
	if (!resp.ok) return null;
	return normalizeReleaseNotesEntry((await resp.json()) as ReleaseNotesEntry);
}

export async function fetchAllReleaseNotes(
	index: ReleaseNotesIndex,
	fetchFn: FetchFn = fetch
): Promise<ReleaseNotesEntry[]> {
	const results = await Promise.allSettled(
		index.entries.map((meta) => fetchReleaseNotesEntry(meta.toVer, fetchFn))
	);

	return sortReleaseHistory(
		results
			.filter(
				(r): r is PromiseFulfilledResult<ReleaseNotesEntry | null> => r.status === 'fulfilled'
			)
			.map((r) => r.value)
			.filter((entry): entry is ReleaseNotesEntry => entry !== null)
	);
}

export function resolveInitialReleaseSelection(
	releaseHistory: ReleaseNotesEntry[],
	latest?: string
): string {
	if (latest && releaseHistory.some((entry) => entry.toVer === latest)) {
		return latest;
	}
	return releaseHistory[0]?.toVer ?? '';
}

export async function loadReleaseNotesPageData(fetchFn: FetchFn = fetch): Promise<{
	index: ReleaseNotesIndex | null;
	releaseHistory: ReleaseNotesEntry[];
	error: string | null;
}> {
	const bundle = await fetchReleaseNotesBundle(fetchFn);
	if (bundle?.entries?.length) {
		const releaseHistory = sortReleaseHistory(bundle.entries);
		return {
			index: indexFromHistory(bundle.generatedAt, bundle.latest, releaseHistory),
			releaseHistory,
			error: null
		};
	}

	const index = await fetchReleaseNotesIndex(fetchFn);
	if (!index) {
		return {
			index: null,
			releaseHistory: [],
			error: 'Release changes not found — run npm run generate:release-notes'
		};
	}

	const releaseHistory = await fetchAllReleaseNotes(index, fetchFn);
	if (releaseHistory.length === 0) {
		return {
			index,
			releaseHistory: [],
			error: 'Release change entries missing — run npm run generate:release-notes'
		};
	}

	if (releaseHistory.length < index.entries.length) {
		console.warn(
			`release-notes: loaded ${releaseHistory.length}/${index.entries.length} entries; regenerate with npm run generate:release-notes`
		);
	}

	return { index, releaseHistory, error: null };
}
