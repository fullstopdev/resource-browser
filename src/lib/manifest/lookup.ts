import type { ManifestEntry } from '$lib/yaml-validation/types';

/** CRD short name (first label of the CRD FQDN). */
export function crdShortName(crdName: string): string {
	return crdName.split('.')[0] || crdName;
}

/** Fallback kind when manifest metadata omits kind (singular PascalCase from CRD short name). */
export function inferKindFromCrdName(crdName: string): string {
	let short = crdShortName(crdName);
	if (short.endsWith('states') && short.length > 6) {
		short = `${short.slice(0, -6)}state`;
	} else if (short.endsWith('s') && short.length > 1 && !short.endsWith('ss')) {
		short = short.slice(0, -1);
	}
	return short.charAt(0).toUpperCase() + short.slice(1);
}

/** Canonical Kubernetes kind for a manifest entry. */
export function resolveEntryKind(entry: Pick<ManifestEntry, 'kind' | 'name'>): string {
	const kind = entry.kind?.trim();
	if (kind) return kind;
	return inferKindFromCrdName(entry.name);
}

function kindLookupKeys(kind: string): string[] {
	const key = kind.replace(/\s+/g, '').toLowerCase();
	const keys = new Set<string>([key]);
	if (key.endsWith('ies') && key.length > 4) {
		keys.add(`${key.slice(0, -3)}y`);
	}
	if (key.endsWith('s') && key.length > 2) {
		keys.add(key.slice(0, -1));
	}
	if (!key.endsWith('s')) {
		keys.add(`${key}s`);
	}
	return [...keys];
}

function kindsMatchCaseInsensitive(a: string, b: string): boolean {
	const aKeys = kindLookupKeys(a);
	const bKeys = kindLookupKeys(b);
	return aKeys.some((k) => bKeys.includes(k));
}

function groupMatches(a: string, b: string): boolean {
	return a.toLowerCase() === b.toLowerCase();
}

/** Exact case-sensitive match on kind and apiVersion group. */
export function findManifestEntry(
	manifest: ManifestEntry[],
	kind: string,
	group: string
): ManifestEntry | undefined {
	if (!kind || !group) return undefined;
	const inGroup = manifest.filter((r) => r.group === group);
	const exact = inGroup.find((r) => resolveEntryKind(r) === kind);
	if (exact) return exact;
	// Manifest entries missing kind metadata (not yet in resources.yaml)
	const inferred = inGroup.filter(
		(r) => !r.kind?.trim() && kindsMatchCaseInsensitive(resolveEntryKind(r), kind)
	);
	return inferred.length === 1 ? inferred[0] : undefined;
}

/** Entry where group matches but kind differs only by case (Kubernetes kinds are case-sensitive). */
export function findManifestEntryCaseMismatch(
	manifest: ManifestEntry[],
	kind: string,
	group: string
): ManifestEntry | undefined {
	if (!kind || !group) return undefined;
	return manifest.find(
		(r) =>
			r.group === group &&
			resolveEntryKind(r) !== kind &&
			kindsMatchCaseInsensitive(resolveEntryKind(r), kind)
	);
}

/** Entry where kind matches exactly and group differs only by case. */
export function findManifestEntryGroupCaseMismatch(
	manifest: ManifestEntry[],
	kind: string,
	group: string
): ManifestEntry | undefined {
	if (!kind || !group) return undefined;
	return manifest.find(
		(r) =>
			resolveEntryKind(r) === kind &&
			r.group &&
			groupMatches(r.group, group) &&
			r.group !== group
	);
}

/** Entry where group matches case-insensitively and kind differs only by case. */
export function findManifestEntryKindCaseMismatchInsensitive(
	manifest: ManifestEntry[],
	kind: string,
	group: string
): ManifestEntry | undefined {
	if (!kind || !group) return undefined;
	return manifest.find(
		(r) =>
			r.group &&
			groupMatches(r.group, group) &&
			resolveEntryKind(r) !== kind &&
			kindsMatchCaseInsensitive(resolveEntryKind(r), kind)
	);
}

/**
 * Unique manifest entry when kind and group match case-insensitively.
 * For auto-correction only — does not bypass strict validation.
 */
export function findManifestEntryCaseInsensitive(
	manifest: ManifestEntry[],
	kind: string,
	group: string
): ManifestEntry | undefined {
	if (!kind || !group) return undefined;
	const matches = manifest.filter(
		(r) =>
			r.group &&
			kindsMatchCaseInsensitive(resolveEntryKind(r), kind) &&
			groupMatches(r.group, group)
	);
	return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Resolve user-provided kind to the manifest canonical kind (PascalCase).
 * When group is set, only entries in that API group are considered.
 */
export function normalizeKind(
	kind: string,
	manifest: ManifestEntry[],
	group?: string
): string | undefined {
	const trimmed = kind?.trim();
	if (!trimmed || !manifest.length) return undefined;

	const scoped = group
		? manifest.filter((r) => r.group && groupMatches(r.group, group))
		: manifest;

	const exact = scoped.find((r) => resolveEntryKind(r) === trimmed);
	if (exact) return resolveEntryKind(exact);

	const caseInsensitive = scoped.filter((r) =>
		kindsMatchCaseInsensitive(resolveEntryKind(r), trimmed)
	);
	if (caseInsensitive.length === 1) {
		return resolveEntryKind(caseInsensitive[0]);
	}

	return undefined;
}

export function findManifestEntriesByGroup(manifest: ManifestEntry[], group: string): ManifestEntry[] {
	if (!group) return [];
	return manifest.filter((r) => r.group === group);
}

export function findManifestEntriesByKind(manifest: ManifestEntry[], kind: string): ManifestEntry[] {
	if (!kind) return [];
	const exact = manifest.filter((r) => resolveEntryKind(r) === kind);
	if (exact.length > 0) return exact;
	return manifest.filter(
		(r) => !r.kind?.trim() && kindsMatchCaseInsensitive(resolveEntryKind(r), kind)
	);
}

export function findManifestEntriesByKindInsensitive(
	manifest: ManifestEntry[],
	kind: string
): ManifestEntry[] {
	if (!kind) return [];
	return manifest.filter((r) => kindsMatchCaseInsensitive(resolveEntryKind(r), kind));
}

/** Whether a YAML kind matches a manifest CRD name (including empty manifest kind metadata). */
export function kindMatchesManifestName(crdName: string, kind: string): boolean {
	if (!crdName || !kind) return false;
	const short = crdShortName(crdName);
	return (
		kindsMatchCaseInsensitive(short, kind) ||
		kindsMatchCaseInsensitive(inferKindFromCrdName(crdName), kind)
	);
}

export function formatKindCaseMismatchMessage(expected: string, got: string): string {
	return `Invalid kind: '${got}' must be '${expected}' (Kubernetes kinds are case-sensitive).`;
}

export function formatInvalidApiVersionMessage(
	apiVersion: string,
	suggestedApiVersion: string,
	kind: string
): string {
	return `Invalid apiVersion: '${apiVersion}' is not defined for this release. Use '${suggestedApiVersion}' for kind ${kind}.`;
}

export function formatCrdNotFoundMessage(
	apiVersion: string,
	kind: string,
	availableApiVersions?: string[]
): string {
	let message = `Could not find CRD for apiVersion '${apiVersion}' and kind '${kind}'`;
	if (availableApiVersions?.length) {
		message += `. Available apiVersions for this kind: ${availableApiVersions.join(', ')}`;
	}
	return message;
}
