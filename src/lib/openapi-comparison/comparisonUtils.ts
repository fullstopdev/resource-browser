import type { OpenApiDiffEntry, OpenApiDiffStatus } from '$lib/openapi/types';

/**
 * OpenAPI comparison filters — mirrors CRD release-diff chips.
 * Shared = present in both with no content changes (CRD's Unchanged).
 * Unchanged is kept for legacy rows and folds into Shared for display.
 */
export const STATUS_FILTERS: {
	status: OpenApiDiffStatus;
	label: string;
	chipClass: string;
}[] = [
	{ status: 'added', label: 'Added', chipClass: 'comparison-filter-chip--added' },
	{ status: 'removed', label: 'Removed', chipClass: 'comparison-filter-chip--removed' },
	{ status: 'modified', label: 'Modified', chipClass: 'comparison-filter-chip--modified' },
	{ status: 'shared', label: 'Shared', chipClass: 'comparison-filter-chip--unchanged' },
	{ status: 'unchanged', label: 'Unchanged', chipClass: 'comparison-filter-chip--unchanged' }
];

export const STATUS_SECTIONS: {
	status: OpenApiDiffStatus;
	title: string;
	description: string;
	icon: 'plus' | 'minus' | 'pencil' | 'check';
}[] = [
	{
		status: 'added',
		title: 'Added APIs',
		description: 'Present in target release only',
		icon: 'plus'
	},
	{
		status: 'removed',
		title: 'Removed APIs',
		description: 'Present in source release only',
		icon: 'minus'
	},
	{
		status: 'modified',
		title: 'Modified APIs',
		description: 'Endpoint or schema content changes between releases',
		icon: 'pencil'
	},
	{
		status: 'shared',
		title: 'Shared APIs',
		description: 'Present in both — no path or schema content changes',
		icon: 'check'
	},
	{
		status: 'unchanged',
		title: 'Unchanged APIs',
		description: 'No path or schema content diff detected',
		icon: 'check'
	},
	{
		status: 'error',
		title: 'Errors',
		description: 'Specs that failed to load or compare',
		icon: 'pencil'
	}
];

/** Fold legacy `api_version` into Shared. Unchanged stays distinct for CRD parity / legacy rows. */
export function displayOpenApiStatus(status: OpenApiDiffStatus): OpenApiDiffStatus {
	if (status === 'api_version') return 'shared';
	return status;
}

export function statusChipClass(status: OpenApiDiffStatus): string {
	const display = displayOpenApiStatus(status);
	if (display === 'added') return 'comparison-status-chip comparison-status-chip--added';
	if (display === 'removed') return 'comparison-status-chip comparison-status-chip--removed';
	if (display === 'modified') return 'comparison-status-chip comparison-status-chip--modified';
	if (display === 'error') return 'comparison-status-chip comparison-status-chip--removed';
	return 'comparison-status-chip comparison-status-chip--unchanged';
}

export function sectionIconModifier(status: OpenApiDiffStatus): string {
	const display = displayOpenApiStatus(status);
	if (display === 'error') return 'removed';
	if (display === 'shared' || display === 'unchanged') return 'unchanged';
	return display;
}

export function summaryCardModifier(status: OpenApiDiffStatus): string {
	const display = displayOpenApiStatus(status);
	if (display === 'shared' || display === 'unchanged') return 'unchanged';
	return display;
}

export function matchesOpenApiSearch(entry: OpenApiDiffEntry, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	return (
		entry.title.toLowerCase().includes(q) ||
		entry.specId.toLowerCase().includes(q) ||
		(entry.sourceSpecId?.toLowerCase().includes(q) ?? false) ||
		entry.group.toLowerCase().includes(q) ||
		entry.pathChanges.some(
			(pc) =>
				pc.path.toLowerCase().includes(q) ||
				pc.method.toLowerCase().includes(q) ||
				(pc.operationId?.toLowerCase().includes(q) ?? false)
		) ||
		entry.schemaChanges.some((s) => s.toLowerCase().includes(q))
	);
}

/** Filter predicate only — never mutates or reclassifies entry.status. */
export function entryMatchesStatusFilter(
	entry: OpenApiDiffEntry,
	statusFilter: OpenApiDiffStatus[]
): boolean {
	return statusFilter.includes(displayOpenApiStatus(entry.status));
}

export function compareOpenApiHint(
	canCompare: boolean,
	generating: boolean,
	sourceReleaseLabel: string | undefined,
	targetReleaseLabel: string | undefined
): string {
	if (generating) return 'Comparison in progress…';
	if (canCompare) {
		return `Ready — compare ${sourceReleaseLabel} → ${targetReleaseLabel}. Press Enter to run.`;
	}
	if (!sourceReleaseLabel || !targetReleaseLabel) return 'Select source and target releases to compare.';
	if (sourceReleaseLabel === targetReleaseLabel) return 'Source and target must differ.';
	return 'Choose different source and target releases to compare.';
}
