import {
	parseEdaExtension,
	type EdaNokiaComExtension,
	type EdaUiAutoComplete
} from './vendorExtensions';

export type EdaChipTone = 'neutral' | 'info' | 'warn' | 'danger' | 'success';

export interface EdaChip {
	id: string;
	label: string;
	title?: string;
	tone: EdaChipTone;
}

export interface EdaPropertyLabel {
	/** Primary display label (`ui-title` when set, otherwise the property name). */
	title: string;
	/** Raw property name when it differs from `title`. */
	secondaryName?: string;
}

/** Elevated multi-line EDA details (conditions, defaults, auto-completes). */
export interface EdaFieldSection {
	id: string;
	label: string;
	items: string[];
}

export interface EdaFieldPresentation {
	label: EdaPropertyLabel;
	visibleIf?: string;
	visibleIfLabel: string;
	description?: string;
	summary?: string;
	group?: string;
	chips: EdaChip[];
	/** Structured lists for conditions / defaults / auto-completes. */
	sections: EdaFieldSection[];
	/** Remaining structured details not elevated to chips/sections. */
	detailRows: Array<{ key: string; label: string; value: string }>;
	hasUiMetadata: boolean;
}

const CHIP_SKIP_KEYS = new Set([
	'ui-title',
	'ui-title-key',
	'ui-order-priority',
	'ui-single-line-group',
	'ui-visible-if',
	'ui-description',
	'ui-summary',
	'ui-column-span'
]);

const ELEVATED_DETAIL_KEYS = new Set([
	'immutable',
	'ui-presence-toggle',
	'ui-advanced',
	'ui-unique-key',
	'ui-may-reorder',
	'ui-category',
	'ui-pattern-error',
	'ui-auto-completes',
	'ui-conditions',
	'ui-defaults',
	'ui-internal-feature'
]);

const DETAIL_LABELS: Record<string, string> = {
	'ui-auto-completes': 'Auto-completes',
	'ui-conditions': 'Conditions',
	'ui-defaults': 'Defaults',
	'ui-default-columns': 'Default columns',
	'ui-internal-feature': 'Internal features',
	'ui-pattern-error': 'Pattern error',
	'ui-render': 'Render rules',
	units: 'Units'
};

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

function formatCompactJson(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	try {
		const text = JSON.stringify(value);
		return text.length > 120 ? `${text.slice(0, 117)}…` : text;
	} catch {
		return String(value);
	}
}

function formatAutoComplete(entry: EdaUiAutoComplete): string {
	const parts = [entry.kind, entry.group, entry.version, entry.type].filter(
		(part): part is string => typeof part === 'string' && part.length > 0
	);
	const target = parts.length > 0 ? parts.join(' / ') : 'resource';
	if (entry.condition && entry.condition !== 'true') {
		return `${target} when ${entry.condition}`;
	}
	return target;
}

/** Format a single `ui-conditions` entry for display. */
export function formatEdaCondition(entry: unknown): string {
	if (typeof entry === 'string' && entry.trim()) return entry.trim();
	if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
		const obj = entry as Record<string, unknown>;
		const condition = asString(obj.condition);
		if (condition) {
			const message = asString(obj.message) ?? asString(obj.error);
			return message ? `${condition} — ${message}` : condition;
		}
	}
	return formatCompactJson(entry);
}

/** Format a single `ui-defaults` entry for display. */
export function formatEdaDefault(entry: unknown): string {
	if (typeof entry === 'string' && entry.trim()) return entry.trim();
	if (typeof entry === 'number' || typeof entry === 'boolean') return String(entry);
	if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
		const obj = entry as Record<string, unknown>;
		const path = asString(obj.path) ?? asString(obj.field) ?? asString(obj.key);
		const value =
			obj.value !== undefined
				? formatCompactJson(obj.value)
				: obj.default !== undefined
					? formatCompactJson(obj.default)
					: undefined;
		if (path && value !== undefined) return `${path} = ${value}`;
		if (path) return path;
		if (value !== undefined) return value;
	}
	return formatCompactJson(entry);
}

function listFromUnknown(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	if (value === null || value === undefined) return [];
	return [value];
}

/** Prefer EDA `ui-title` for display; keep the raw name as secondary when different. */
export function getEdaPropertyLabel(
	name: string,
	eda: EdaNokiaComExtension | null | undefined
): EdaPropertyLabel {
	const title = asString(eda?.['ui-title']) || name;
	if (title !== name) {
		return { title, secondaryName: name };
	}
	return { title: name };
}

/** Human-readable conditional visibility label. */
export function formatEdaVisibleIf(condition: string | undefined | null): string {
	const trimmed = condition?.trim();
	if (!trimmed) return '';
	return `shown when ${trimmed}`;
}

/**
 * Build elevated sections for auto-completes, conditions, and defaults.
 * These are shown as chips + compact lists instead of buried JSON detail rows.
 */
export function getEdaFieldSections(eda: EdaNokiaComExtension | null | undefined): EdaFieldSection[] {
	if (!eda) return [];

	const sections: EdaFieldSection[] = [];

	const autoCompletes = listFromUnknown(eda['ui-auto-completes']);
	if (autoCompletes.length > 0) {
		sections.push({
			id: 'auto-completes',
			label: autoCompletes.length === 1 ? 'Auto-complete' : 'Auto-completes',
			items: autoCompletes.map((entry) => formatAutoComplete(entry as EdaUiAutoComplete))
		});
	}

	const conditions = listFromUnknown(eda['ui-conditions']);
	if (conditions.length > 0) {
		sections.push({
			id: 'conditions',
			label: conditions.length === 1 ? 'Condition' : 'Conditions',
			items: conditions.map(formatEdaCondition)
		});
	}

	const defaults = listFromUnknown(eda['ui-defaults']);
	if (defaults.length > 0) {
		sections.push({
			id: 'defaults',
			label: defaults.length === 1 ? 'Default' : 'Defaults',
			items: defaults.map(formatEdaDefault)
		});
	}

	return sections;
}

/**
 * Build compact chips for high-signal EDA flags (immutable, category, advanced, …).
 * Omits fields already shown as title / visible-if / description.
 */
export function getEdaPresentationChips(eda: EdaNokiaComExtension | null | undefined): EdaChip[] {
	if (!eda) return [];

	const chips: EdaChip[] = [];

	if (asBoolean(eda.immutable)) {
		chips.push({ id: 'immutable', label: 'Immutable', tone: 'warn' });
	}
	if (asBoolean(eda['ui-presence-toggle'])) {
		chips.push({ id: 'presence', label: 'Presence toggle', tone: 'info' });
	}
	if (asBoolean(eda['ui-advanced'])) {
		chips.push({ id: 'advanced', label: 'Advanced', tone: 'neutral' });
	}
	if (asBoolean(eda['ui-unique-key'])) {
		chips.push({ id: 'unique-key', label: 'Unique key', tone: 'info' });
	}
	if (asBoolean(eda['ui-may-reorder'])) {
		chips.push({ id: 'may-reorder', label: 'Reorderable', tone: 'neutral' });
	}

	const category = asString(eda['ui-category']);
	if (category) {
		chips.push({ id: 'category', label: category, title: 'UI category', tone: 'info' });
	}

	const patternError = asString(eda['ui-pattern-error']);
	if (patternError) {
		chips.push({
			id: 'pattern-error',
			label: 'Pattern hint',
			title: patternError,
			tone: 'warn'
		});
	}

	const autoCompletes = listFromUnknown(eda['ui-auto-completes']);
	if (autoCompletes.length > 0) {
		const summary = autoCompletes
			.map((entry) => formatAutoComplete(entry as EdaUiAutoComplete))
			.join('; ');
		chips.push({
			id: 'auto-complete',
			label: autoCompletes.length === 1 ? 'Auto-complete' : `${autoCompletes.length} auto-completes`,
			title: summary,
			tone: 'success'
		});
	}

	const conditions = listFromUnknown(eda['ui-conditions']);
	if (conditions.length > 0) {
		const summary = conditions.map(formatEdaCondition).join('; ');
		chips.push({
			id: 'conditions',
			label: conditions.length === 1 ? 'Condition' : `${conditions.length} conditions`,
			title: summary,
			tone: 'warn'
		});
	}

	const defaults = listFromUnknown(eda['ui-defaults']);
	if (defaults.length > 0) {
		const summary = defaults.map(formatEdaDefault).join('; ');
		chips.push({
			id: 'defaults',
			label: defaults.length === 1 ? 'Default' : `${defaults.length} defaults`,
			title: summary,
			tone: 'info'
		});
	}

	const internal = eda['ui-internal-feature'];
	if (Array.isArray(internal) && internal.length > 0) {
		chips.push({
			id: 'internal',
			label: 'Internal',
			title: internal.map(String).join(', '),
			tone: 'danger'
		});
	}

	return chips;
}

function buildDetailRows(eda: EdaNokiaComExtension): Array<{ key: string; label: string; value: string }> {
	const rows: Array<{ key: string; label: string; value: string }> = [];

	for (const [key, value] of Object.entries(eda)) {
		if (CHIP_SKIP_KEYS.has(key)) continue;
		if (ELEVATED_DETAIL_KEYS.has(key)) continue;
		if (value === null || value === undefined) continue;
		rows.push({
			key,
			label: DETAIL_LABELS[key] ?? key.replace(/^ui-/, '').replace(/-/g, ' '),
			value: formatCompactJson(value)
		});
	}

	return rows.sort((a, b) => a.key.localeCompare(b.key));
}

/** Full presentation model for a property (or schema) carrying `x-eda-nokia-com`. */
export function getEdaFieldPresentation(
	name: string,
	edaInput: EdaNokiaComExtension | null | undefined | unknown
): EdaFieldPresentation {
	const eda =
		edaInput && typeof edaInput === 'object' && !Array.isArray(edaInput)
			? parseEdaExtension(edaInput) ?? (edaInput as EdaNokiaComExtension)
			: parseEdaExtension(edaInput);

	const label = getEdaPropertyLabel(name, eda);
	const visibleIf = asString(eda?.['ui-visible-if']);
	const description = asString(eda?.['ui-description']);
	const summary = asString(eda?.['ui-summary']);
	const group = asString(eda?.['ui-single-line-group']);
	const chips = getEdaPresentationChips(eda);
	const sections = getEdaFieldSections(eda);
	const detailRows = eda ? buildDetailRows(eda) : [];

	return {
		label,
		visibleIf,
		visibleIfLabel: formatEdaVisibleIf(visibleIf),
		description,
		summary,
		group,
		chips,
		sections,
		detailRows,
		hasUiMetadata: Boolean(
			eda &&
				(label.secondaryName ||
					visibleIf ||
					description ||
					summary ||
					group ||
					chips.length > 0 ||
					sections.length > 0 ||
					detailRows.length > 0 ||
					asString(eda['ui-title']))
		)
	};
}
