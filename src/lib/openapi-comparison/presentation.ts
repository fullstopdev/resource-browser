import { buildOpenApiSpecPath } from '$lib/openapi';
import type { OpenApiDiffEntry, OpenApiPathChange } from '$lib/openapi/types';
import { parseDiffLine } from '$lib/comparison/diffDetails';
import { openApiApiVersion } from './compareReleases';
import { humanizeFieldPath } from '$lib/release-notes/presentation';

export type PathChangeGroup = {
	changeType: 'added' | 'removed' | 'modified';
	title: string;
	changes: OpenApiPathChange[];
};

export type SchemaChangeKind = 'added' | 'removed' | 'modified' | 'api_version';

export type ParsedSchemaChange = {
	kind: SchemaChangeKind;
	name: string;
	raw: string;
	/** CRD-style leaf lines for modified schemas (`~ Modified: path :: before → after`). */
	details?: string[];
	/** Source schema name for version-only renames. */
	fromName?: string;
	/** Target schema name for version-only renames. */
	toName?: string;
};

const SCHEMA_LINE =
	/^[+\-~]\s+(?:Added|Removed|Modified)\s+schema:\s+(.+)$/i;
/** Per-schema version-only rename: `~ API version schema: old → new`. */
const SCHEMA_API_VERSION_PAIR_LINE =
	/^~\s+API version schema:\s+(.+?)\s+→\s+(.+)$/i;
/** Legacy aggregate footnote. */
const SCHEMA_API_VERSION_SUMMARY_LINE =
	/^~\s+(?:API version\s+(\d+)\s+schemas?|Renamed\s+(\d+)\s+schemas?\s+with\s+API\s+version)(?:\s+\(([^)]+)\))?$/i;

/** Group path changes into Added / Removed / Modified for changelog UI. */
export function groupPathChanges(pathChanges: OpenApiPathChange[]): PathChangeGroup[] {
	const order: Array<'added' | 'removed' | 'modified'> = ['added', 'removed', 'modified'];
	const titles = {
		added: 'Added endpoints',
		removed: 'Removed endpoints',
		modified: 'Modified endpoints'
	} as const;

	return order
		.map((changeType) => ({
			changeType,
			title: titles[changeType],
			changes: pathChanges.filter((c) => c.changeType === changeType)
		}))
		.filter((g) => g.changes.length > 0);
}

/** Prefer operationId + METHOD path as the primary label. */
export function pathChangePrimaryLabel(change: OpenApiPathChange): string {
	const methodPath = `${change.method} ${change.path}`;
	if (change.operationId?.trim()) return `${change.operationId} · ${methodPath}`;
	return methodPath;
}

/** Turn opaque operation detail lines into short human bullets (legacy / tests). */
export function humanizeOperationDetail(detail: string): string {
	const trimmed = detail.trim();
	const map: Array<[RegExp, string]> = [
		[/^\+\s*Added:\s*(\S+)\s*::\s*(.+)$/i, 'Added $1: $2'],
		[/^\+\s*Added:\s*(.+)$/i, 'Added $1'],
		[/^-\s*Removed:\s*(\S+)\s*::\s*(.+)$/i, 'Removed $1: $2'],
		[/^-\s*Removed:\s*(.+)$/i, 'Removed $1'],
		[/^~\s*Modified:\s*(.+?)\s*::\s*(.+?)\s*→\s*(.+)$/i, '$1: $2 → $3'],
		[/^~\s*Modified:\s*(.+)$/i, '$1 changed'],
		// Legacy formats
		[/^\+\s*Added\s+operationId:\s*(.+)$/i, 'Added operationId: $1'],
		[/^\+\s*Added\s+summary:\s*(.+)$/i, 'Added summary: $1'],
		[/^\+\s*Added\s+description:\s*(.+)$/i, 'Added description'],
		[/^\+\s*Added\s+deprecated:\s*(.+)$/i, 'Marked deprecated'],
		[/^\+\s*Added\s+tags:\s*(.+)$/i, 'Added tags: $1'],
		[/^\+\s*Added\s+parameters:\s*(.+)$/i, 'Added parameters'],
		[/^\+\s*Added\s+requestBody:\s*(.+)$/i, 'Added request body'],
		[/^\+\s*Added\s+responses:\s*(.+)$/i, 'Added responses'],
		[/^-\s*Removed\s+operationId:\s*(.+)$/i, 'Removed operationId: $1'],
		[/^-\s*Removed\s+summary:\s*(.+)$/i, 'Removed summary'],
		[/^-\s*Removed\s+description:\s*(.+)$/i, 'Removed description'],
		[/^-\s*Removed\s+deprecated:\s*(.+)$/i, 'Cleared deprecated flag'],
		[/^-\s*Removed\s+tags:\s*(.+)$/i, 'Removed tags'],
		[/^-\s*Removed\s+parameters:\s*(.+)$/i, 'Removed parameters'],
		[/^-\s*Removed\s+requestBody:\s*(.+)$/i, 'Removed request body'],
		[/^-\s*Removed\s+responses:\s*(.+)$/i, 'Removed responses'],
		[/^~\s*Modified\s+operationId:\s*(.+)$/i, 'operationId changed: $1'],
		[/^~\s*Modified\s+summary:\s*(.+)$/i, 'Summary changed: $1'],
		[/^~\s*Modified\s+description:\s*(.+)$/i, 'Description changed'],
		[/^~\s*Modified\s+deprecated:\s*(.+)$/i, 'Deprecated flag changed: $1'],
		[/^~\s*Modified\s+tags$/i, 'Tags changed'],
		[/^~\s*Modified\s+parameters$/i, 'Parameters changed'],
		[/^~\s*Modified\s+requestBody$/i, 'Request body changed'],
		[/^~\s*Modified\s+responses$/i, 'Responses changed']
	];

	for (const [re, replacement] of map) {
		if (re.test(trimmed)) return trimmed.replace(re, replacement);
	}
	return trimmed.replace(/^[+\-~]\s*/, '');
}

export function parseSchemaChangeLine(line: string): ParsedSchemaChange | null {
	const trimmed = line.trim();
	const pair = SCHEMA_API_VERSION_PAIR_LINE.exec(trimmed);
	if (pair?.[1] && pair[2]) {
		const fromName = pair[1].trim();
		const toName = pair[2].trim();
		return {
			kind: 'api_version',
			name: toName,
			fromName,
			toName,
			raw: trimmed
		};
	}
	const apiVersion = SCHEMA_API_VERSION_SUMMARY_LINE.exec(trimmed);
	if (apiVersion) {
		const count = apiVersion[1] ?? apiVersion[2] ?? '?';
		const bump = apiVersion[3] ? ` (${apiVersion[3]})` : '';
		return {
			kind: 'api_version',
			name: `${count} schemas version bump only${bump}`,
			raw: trimmed
		};
	}
	const match = SCHEMA_LINE.exec(trimmed);
	if (!match?.[1]) return null;
	const name = match[1].trim();
	if (!name) return null;
	let kind: SchemaChangeKind = 'modified';
	if (trimmed.startsWith('+')) kind = 'added';
	else if (trimmed.startsWith('-')) kind = 'removed';
	return { kind, name, raw: trimmed };
}

const SCHEMA_LEAF_LINE = /^[+\-~]\s+(?:Added|Removed|Modified):\s+/i;

export function groupSchemaChanges(schemaChanges: string[]): {
	added: ParsedSchemaChange[];
	removed: ParsedSchemaChange[];
	modified: ParsedSchemaChange[];
	apiVersion: ParsedSchemaChange[];
} {
	const added: ParsedSchemaChange[] = [];
	const removed: ParsedSchemaChange[] = [];
	const modified: ParsedSchemaChange[] = [];
	const apiVersion: ParsedSchemaChange[] = [];
	let currentModified: ParsedSchemaChange | null = null;

	for (const line of schemaChanges) {
		const parsed = parseSchemaChangeLine(line);
		if (parsed) {
			currentModified = null;
			if (parsed.kind === 'added') added.push(parsed);
			else if (parsed.kind === 'removed') removed.push(parsed);
			else if (parsed.kind === 'api_version') apiVersion.push(parsed);
			else {
				currentModified = parsed;
				modified.push(parsed);
			}
			continue;
		}
		// Attach CRD-style leaf diffs that follow a `~ Modified schema:` header.
		if (currentModified && SCHEMA_LEAF_LINE.test(line.trim())) {
			if (!currentModified.details) currentModified.details = [];
			currentModified.details.push(line.trim());
		}
	}
	return { added, removed, modified, apiVersion };
}

/** Last dotted segment of a schema component name. */
export function schemaShortName(fullName: string): string {
	const dot = fullName.lastIndexOf('.');
	return dot >= 0 ? fullName.slice(dot + 1) : fullName;
}

/**
 * Strip companion suffixes (`List`, `State`, `_alarms`, …) to the root resource name.
 * e.g. `AuthenticationPolicyState_alarms` → `AuthenticationPolicy`.
 */
export function schemaRootShortName(fullName: string): string {
	const short = schemaShortName(fullName);
	const root = short.replace(
		/(?:State)?(?:List)?(?:_(?:DeletedResourceEntry|DeletedResources|alarms|deviations|metadata))?$/,
		''
	);
	return root || short;
}

export type SchemaNameGroup = {
	/** Root resource short name (e.g. AuthenticationPolicy). */
	root: string;
	/** Preferred link target — the root schema when present, else first member. */
	primaryName: string;
	/** All full schema names in this group. */
	names: string[];
	/** Companions beyond the root itself. */
	companionCount: number;
};

/**
 * Group added/removed schema names under their root resource so companion floods
 * (`_alarms`, `_metadata`, `List`, `State`, …) collapse to one chip + count.
 */
export type SchemaKindFilter = 'added' | 'removed' | 'modified' | 'api_version';

/** Deep schema filters inside an expanded API card — mirrors top-level CRD chips. */
export const SCHEMA_KIND_FILTERS: {
	kind: SchemaKindFilter;
	label: string;
	chipClass: string;
}[] = [
	{ kind: 'added', label: 'Added', chipClass: 'comparison-filter-chip--added' },
	{ kind: 'removed', label: 'Removed', chipClass: 'comparison-filter-chip--removed' },
	{ kind: 'modified', label: 'Modified', chipClass: 'comparison-filter-chip--modified' },
	{ kind: 'api_version', label: 'API version', chipClass: 'comparison-filter-chip--api-version' }
];

export type SchemaDisplayRow = {
	/** Stable key for expand/collapse state. */
	id: string;
	kind: SchemaChangeKind;
	/** Short label in the row header (root or leaf schema name). */
	label: string;
	/** Preferred link target. */
	primaryName: string;
	/** All full schema names represented by this row. */
	names: string[];
	/** Companion schemas beyond the primary (added/removed/version groups). */
	companions: { name: string; shortName: string; fromName?: string; toName?: string }[];
	details?: string[];
	fromName?: string;
	toName?: string;
};

export type SchemaChangeUiGroup = {
	kind: SchemaChangeKind;
	title: string;
	rows: SchemaDisplayRow[];
};

function schemaRowSearchText(row: SchemaDisplayRow): string {
	return [
		row.label,
		...row.names,
		...row.companions.flatMap((c) => [c.shortName, c.name, c.fromName, c.toName]),
		row.fromName,
		row.toName
	]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();
}

function companionEntriesForGroup(
	group: SchemaNameGroup,
	items: ParsedSchemaChange[]
): SchemaDisplayRow['companions'] {
	const byName = new Map(items.map((item) => [item.name, item]));
	return group.names
		.filter((name) => name !== group.primaryName)
		.map((name) => {
			const item = byName.get(name);
			return {
				name,
				shortName: schemaShortName(name),
				fromName: item?.fromName,
				toName: item?.toName
			};
		});
}

/** Build path-style display rows from grouped schema changes (no truncation). */
export function buildSchemaDisplayRows(grouped: {
	added: ParsedSchemaChange[];
	removed: ParsedSchemaChange[];
	modified: ParsedSchemaChange[];
	apiVersion: ParsedSchemaChange[];
}): SchemaDisplayRow[] {
	const rows: SchemaDisplayRow[] = [];

	for (const kind of ['added', 'removed'] as const) {
		for (const group of groupSchemaNamesByRoot(grouped[kind])) {
			rows.push({
				id: `${kind}:${group.root}`,
				kind,
				label: group.root,
				primaryName: group.primaryName,
				names: group.names,
				companions: companionEntriesForGroup(group, grouped[kind])
			});
		}
	}

	for (const sc of grouped.modified) {
		rows.push({
			id: `modified:${sc.name}`,
			kind: 'modified',
			label: schemaShortName(sc.name),
			primaryName: sc.name,
			names: [sc.name],
			companions: [],
			details: sc.details
		});
	}

	const versionPairs = grouped.apiVersion.filter((sc) => sc.fromName && sc.toName);
	const versionSummaries = grouped.apiVersion.filter((sc) => !sc.fromName || !sc.toName);

	for (const group of groupSchemaNamesByRoot(versionPairs)) {
		const primaryItem = versionPairs.find((sc) => sc.name === group.primaryName);
		rows.push({
			id: `api_version:${group.root}`,
			kind: 'api_version',
			label: group.root,
			primaryName: group.primaryName,
			names: group.names,
			companions: companionEntriesForGroup(group, versionPairs),
			fromName: primaryItem?.fromName,
			toName: primaryItem?.toName
		});
	}

	for (const sc of versionSummaries) {
		rows.push({
			id: `api_version:summary:${sc.name}`,
			kind: 'api_version',
			label: sc.name,
			primaryName: sc.name,
			names: [sc.name],
			companions: [],
			fromName: sc.fromName,
			toName: sc.toName
		});
	}

	return rows;
}

/** Group schema rows into Added / Removed / API version / Modified sections (paths parity). */
export function groupSchemaChangesForUI(schemaChanges: string[]): SchemaChangeUiGroup[] {
	const grouped = groupSchemaChanges(schemaChanges);
	const rows = buildSchemaDisplayRows(grouped);
	const order: SchemaChangeKind[] = ['added', 'removed', 'api_version', 'modified'];
	const titles: Record<SchemaChangeKind, string> = {
		added: 'Added schemas',
		removed: 'Removed schemas',
		modified: 'Modified schemas',
		api_version: 'API version upgrade'
	};

	return order
		.map((kind) => ({
			kind,
			title: titles[kind],
			rows: rows.filter((row) => row.kind === kind)
		}))
		.filter((group) => group.rows.length > 0);
}

/** Filter predicate only — never reclassifies row.kind. */
export function filterSchemaDisplayRows(
	rows: SchemaDisplayRow[],
	kindFilter: SchemaKindFilter[],
	searchQuery: string
): SchemaDisplayRow[] {
	const q = searchQuery.trim().toLowerCase();
	return rows.filter((row) => {
		if (!kindFilter.includes(row.kind as SchemaKindFilter)) return false;
		if (!q) return true;
		return schemaRowSearchText(row).includes(q);
	});
}

export function schemaKindFilterCounts(
	rows: SchemaDisplayRow[]
): Record<SchemaKindFilter, number> {
	return {
		added: rows.filter((row) => row.kind === 'added').length,
		removed: rows.filter((row) => row.kind === 'removed').length,
		modified: rows.filter((row) => row.kind === 'modified').length,
		api_version: rows.filter((row) => row.kind === 'api_version').length
	};
}

/** Default deep filters: every non-empty bucket enabled. */
export function defaultSchemaKindFilters(rows: SchemaDisplayRow[]): SchemaKindFilter[] {
	const counts = schemaKindFilterCounts(rows);
	return SCHEMA_KIND_FILTERS.map((item) => item.kind).filter((kind) => counts[kind] > 0);
}

/** Version bump between paired schema renames, e.g. `v1alpha1 → v1`. */
export function schemaPairBump(sc: { fromName?: string; toName?: string }): string | null {
	if (!sc.fromName || !sc.toName) return null;
	const extractVersion = (name: string): string | null => {
		const parts = name.split('.');
		for (let i = parts.length - 1; i >= 0; i--) {
			const part = parts[i];
			if (part && /^v[\da-z]+$/i.test(part)) return part;
		}
		return null;
	};
	const from = extractVersion(sc.fromName);
	const to = extractVersion(sc.toName);
	if (from && to && from !== to) return `${from} → ${to}`;
	return null;
}

export function groupSchemaNamesByRoot(items: ParsedSchemaChange[]): SchemaNameGroup[] {
	const byRoot = new Map<string, ParsedSchemaChange[]>();
	for (const item of items) {
		const root = schemaRootShortName(item.name);
		const list = byRoot.get(root);
		if (list) list.push(item);
		else byRoot.set(root, [item]);
	}

	return [...byRoot.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([root, group]) => {
			const names = group.map((g) => g.name);
			const primary =
				group.find((g) => schemaShortName(g.name) === root)?.name ??
				group.find((g) => schemaShortName(g.name) === `${root}List`)?.name ??
				names[0]!;
			const hasRoot = group.some((g) => schemaShortName(g.name) === root);
			return {
				root,
				primaryName: primary,
				names,
				companionCount: Math.max(0, names.length - (hasRoot ? 1 : 0))
			};
		});
}

export function buildOpenApiDiffSpecHref(
	specId: string,
	release: string,
	options?: { operationId?: string; schema?: string }
): string {
	if (options?.schema) {
		return buildOpenApiSpecPath(specId, release, 'schemaGraph', undefined, {
			schema: options.schema
		});
	}
	return buildOpenApiSpecPath(specId, release, 'paths', options?.operationId);
}

export type OpenApiOpFieldRow = {
	field: string;
	label: string;
	kind: 'added' | 'removed' | 'modified';
	before?: string;
	after?: string;
};

/** Parse CRD-style detail lines into release-changes table rows. */
export function opFieldRowsFromDetails(details: string[]): OpenApiOpFieldRow[] {
	const rows: OpenApiOpFieldRow[] = [];
	for (const detail of details) {
		const parsed = parseDiffLine(detail);
		if (parsed.type === 'neutral') continue;
		const kind =
			parsed.type === 'add' ? 'added' : parsed.type === 'remove' ? 'removed' : 'modified';
		const field = parsed.path;
		const leaf = field.includes('.') ? field.slice(field.lastIndexOf('.') + 1) : field;
		rows.push({
			field,
			label: humanizeFieldPath(leaf),
			kind,
			before: parsed.before,
			after: parsed.after
		});
	}
	return rows;
}

export function opFieldChangeBadgeClass(kind: OpenApiOpFieldRow['kind']): string {
	if (kind === 'removed') {
		return 'release-notes-change-badge release-notes-change-badge--breaking';
	}
	if (kind === 'modified') {
		return 'release-notes-change-badge release-notes-change-badge--warning';
	}
	return 'release-notes-change-badge release-notes-change-badge--safe';
}

export function entryChangeMetricsLabel(
	pathCounts: { added: number; removed: number; modified: number },
	schemaSummary?: {
		added: number;
		removed: number;
		modified: number;
		apiVersion?: number;
	} | null
): string {
	const parts: string[] = [];
	const pathTotal = pathCounts.added + pathCounts.removed + pathCounts.modified;
	const schemaTotal =
		(schemaSummary?.added ?? 0) +
		(schemaSummary?.removed ?? 0) +
		(schemaSummary?.modified ?? 0) +
		(schemaSummary?.apiVersion ?? 0);

	if (pathTotal > 0) {
		const bits: string[] = [];
		if (pathCounts.added) bits.push(`+${pathCounts.added}`);
		if (pathCounts.removed) bits.push(`−${pathCounts.removed}`);
		if (pathCounts.modified) bits.push(`~${pathCounts.modified}`);
		parts.push(`${bits.join(' ')} paths`);
	}
	if (schemaTotal > 0) {
		const bits: string[] = [];
		if (schemaSummary?.added) bits.push(`+${schemaSummary.added}`);
		if (schemaSummary?.removed) bits.push(`−${schemaSummary.removed}`);
		if (schemaSummary?.modified) bits.push(`~${schemaSummary.modified}`);
		if (schemaSummary?.apiVersion) bits.push(`↻${schemaSummary.apiVersion}`);
		parts.push(`${bits.join(' ')} schemas`);
	}
	if (parts.length === 0) return 'No changes';
	return parts.join(' · ');
}

/** Compact API version bump label, e.g. `v1alpha1 → v1`. */
export function versionBumpLabel(entry: Pick<OpenApiDiffEntry, 'specId' | 'sourceSpecId'>): string | null {
	if (!entry.sourceSpecId || entry.sourceSpecId === entry.specId) return null;
	const from = openApiApiVersion(entry.sourceSpecId);
	const to = openApiApiVersion(entry.specId);
	if (from && to) return `${from} → ${to}`;
	return `${entry.sourceSpecId} → ${entry.specId}`;
}

/** Spec id line for a row: show both ids when the API version changed. */
export function entrySpecIdLabel(entry: Pick<OpenApiDiffEntry, 'specId' | 'sourceSpecId'>): string {
	if (!entry.sourceSpecId || entry.sourceSpecId === entry.specId) return entry.specId;
	return `${entry.sourceSpecId} → ${entry.specId}`;
}

/** Sort releases older → newer using numeric-aware version compare. */
export function sortOpenApiReleasesOlderFirst<T extends { name: string }>(releases: T[]): T[] {
	return [...releases].sort((a, b) =>
		a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
	);
}

/** Default source/target: adjacent step (penultimate → latest) when URL does not specify. */
export function defaultOpenApiComparisonPair(
	releases: { name: string; default?: boolean }[]
): { sourceRelease: string; targetRelease: string } {
	const ordered = sortOpenApiReleasesOlderFirst(releases);
	if (ordered.length === 0) return { sourceRelease: '', targetRelease: '' };
	if (ordered.length === 1) {
		return { sourceRelease: ordered[0].name, targetRelease: ordered[0].name };
	}
	return {
		sourceRelease: ordered[ordered.length - 2].name,
		targetRelease: ordered[ordered.length - 1].name
	};
}
