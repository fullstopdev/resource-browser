export type DiffLineType = 'add' | 'remove' | 'modify' | 'neutral';
export type DiffSection = 'spec' | 'status' | 'other';

export type ParsedDiffLine = {
	type: DiffLineType;
	section: DiffSection;
	path: string;
	label: string;
	raw: string;
	before?: string;
	after?: string;
};

export type DiffViewRow = {
	lineNum: number;
	left: string | null;
	right: string | null;
	leftType: DiffLineType | null;
	rightType: DiffLineType | null;
};

function detectSection(path: string): DiffSection {
	if (path.startsWith('status.')) return 'status';
	if (path.startsWith('spec.')) return 'spec';
	return 'other';
}

export function parseDiffLine(detail: string): ParsedDiffLine {
	const raw = detail.trim();
	let type: DiffLineType = 'neutral';
	let path = raw;
	let label = raw;
	let before: string | undefined;
	let after: string | undefined;

	if (raw.startsWith('+')) {
		type = 'add';
		const withValue = raw.match(/^\+\s*(?:Added:\s*)?(.+?) :: (.+)$/i);
		if (withValue) {
			path = withValue[1].trim();
			after = withValue[2].trim();
		} else {
			const m = raw.match(/^\+\s*(?:Added:\s*)?(.+)$/i);
			path = m?.[1]?.trim() ?? raw.slice(1).trim();
		}
		label = `+ ${path}`;
	} else if (raw.startsWith('-')) {
		type = 'remove';
		const withValue = raw.match(/^-\s*(?:Removed:\s*)?(.+?) :: (.+)$/i);
		if (withValue) {
			path = withValue[1].trim();
			before = withValue[2].trim();
		} else {
			const m = raw.match(/^-\s*(?:Removed:\s*)?(.+)$/i);
			path = m?.[1]?.trim() ?? raw.slice(1).trim();
		}
		label = `− ${path}`;
	} else if (raw.startsWith('~')) {
		type = 'modify';
		const withValues = raw.match(/^~\s*(?:Modified:\s*)?(.+?) :: (.+) → (.+)$/);
		if (withValues) {
			path = withValues[1].trim();
			before = withValues[2].trim();
			after = withValues[3].trim();
			label = `~ ${path}`;
		} else {
			const m = raw.match(/^~\s*(?:Modified:\s*)?(.+)$/i);
			path = m?.[1]?.trim() ?? raw.slice(1).trim();
			label = `~ ${path}`;
		}
	}

	return {
		type,
		section: detectSection(path),
		path,
		label,
		raw,
		before,
		after
	};
}

export function groupDiffLines(details: string[]): Record<DiffSection, ParsedDiffLine[]> {
	const groups: Record<DiffSection, ParsedDiffLine[]> = {
		spec: [],
		status: [],
		other: []
	};
	for (const detail of details) {
		const parsed = parseDiffLine(detail);
		groups[parsed.section].push(parsed);
	}
	return groups;
}

export function buildSideBySideRows(lines: ParsedDiffLine[]): DiffViewRow[] {
	const rows: DiffViewRow[] = [];
	let lineNum = 1;
	for (const line of lines) {
		if (line.type === 'add') {
			rows.push({
				lineNum: lineNum++,
				left: null,
				right: line.path,
				leftType: null,
				rightType: 'add'
			});
		} else if (line.type === 'remove') {
			rows.push({
				lineNum: lineNum++,
				left: line.path,
				right: null,
				leftType: 'remove',
				rightType: null
			});
		} else if (line.type === 'modify') {
			const left =
				line.before !== undefined ? `${line.path}: ${line.before}` : line.path;
			const right =
				line.after !== undefined ? `${line.path}: ${line.after}` : line.path;
			rows.push({
				lineNum: lineNum++,
				left,
				right,
				leftType: 'modify',
				rightType: 'modify'
			});
		} else {
			rows.push({
				lineNum: lineNum++,
				left: line.label,
				right: line.label,
				leftType: 'neutral',
				rightType: 'neutral'
			});
		}
	}
	return rows;
}

export function diffLineClass(type: DiffLineType | null): string {
	if (type === 'add') return 'comparison-diff-cell comparison-diff-cell--add';
	if (type === 'remove') return 'comparison-diff-cell comparison-diff-cell--remove';
	if (type === 'modify') return 'comparison-diff-cell comparison-diff-cell--modify';
	return 'comparison-diff-cell comparison-diff-cell--neutral';
}

export type DiffChangeKind = 'added' | 'removed' | 'modified';

export type DiffDetailModalPayload = {
	title: string;
	subtitle?: string;
	/** Short context label above the title (default: Schema diff). */
	eyebrow?: string;
	changeKind?: DiffChangeKind;
	sourceLabel: string;
	targetLabel: string;
	details: string[];
	/** 1-based line within `details` to highlight in the modal grid. */
	focusedLine?: number;
	secondaryAction?: { href: string; label: string };
};

export function diffChangeKindLabel(kind: DiffChangeKind): string {
	if (kind === 'added') return 'Added';
	if (kind === 'removed') return 'Removed';
	return 'Modified';
}

export function diffChangeKindBadgeClass(kind: DiffChangeKind): string {
	if (kind === 'removed') {
		return 'release-notes-change-badge release-notes-change-badge--breaking';
	}
	if (kind === 'modified') {
		return 'release-notes-change-badge release-notes-change-badge--warning';
	}
	return 'release-notes-change-badge release-notes-change-badge--safe';
}

/** Build a CRD-style detail line from structured field change data. */
export function buildDiffDetailLine(input: {
	field: string;
	kind: DiffChangeKind;
	before?: string;
	after?: string;
}): string {
	const { field, kind, before, after } = input;
	if (kind === 'added') {
		return after != null ? `+ Added: ${field} :: ${after}` : `+ Added: ${field}`;
	}
	if (kind === 'removed') {
		return before != null ? `- Removed: ${field} :: ${before}` : `- Removed: ${field}`;
	}
	if (before != null || after != null) {
		return `~ Modified: ${field} :: ${before ?? '—'} → ${after ?? '—'}`;
	}
	return `~ Modified: ${field}`;
}

export function syntheticPathDetailLine(
	changeKind: 'added' | 'removed',
	path: string
): string {
	return changeKind === 'added' ? `+ Added: ${path}` : `- Removed: ${path}`;
}

/** Map a parsed diff line to its 1-based index within a details list, if present. */
export function findDetailLineIndex(details: string[], parsed: ParsedDiffLine): number {
	const index = details.findIndex((detail) => detail.trim() === parsed.raw.trim());
	return index >= 0 ? index + 1 : 1;
}
