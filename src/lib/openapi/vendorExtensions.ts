export interface EdaUiAutoComplete {
	condition?: string;
	group?: string;
	kind?: string;
	type?: string;
	version?: string;
}

/** Common `x-eda-nokia-com` fields observed in EDA OpenAPI specs. */
export interface EdaNokiaComExtension {
	immutable?: boolean;
	'ui-advanced'?: boolean;
	'ui-auto-completes'?: EdaUiAutoComplete[];
	'ui-category'?: string;
	'ui-column-span'?: number;
	'ui-description'?: string;
	'ui-internal-feature'?: string[];
	'ui-may-reorder'?: boolean;
	'ui-order-priority'?: number;
	'ui-pattern-error'?: string;
	'ui-presence-toggle'?: boolean;
	'ui-single-line-group'?: string;
	'ui-summary'?: string;
	'ui-title'?: string;
	'ui-title-key'?: string;
	'ui-unique-key'?: boolean;
	'ui-visible-if'?: string;
	[key: string]: unknown;
}

export interface VendorExtensionField {
	key: string;
	label: string;
	value: string;
	valueType: 'string' | 'boolean' | 'number' | 'json';
}

export interface VendorExtensionEntry {
	key: string;
	label: string;
	fields: VendorExtensionField[];
	raw: unknown;
}

const EDA_FIELD_LABELS: Record<string, string> = {
	immutable: 'Immutable',
	'ui-advanced': 'Advanced',
	'ui-auto-completes': 'Auto-completes',
	'ui-category': 'Category',
	'ui-column-span': 'Column span',
	'ui-description': 'UI description',
	'ui-internal-feature': 'Internal features',
	'ui-may-reorder': 'May reorder',
	'ui-order-priority': 'Order priority',
	'ui-pattern-error': 'Pattern error',
	'ui-presence-toggle': 'Presence toggle',
	'ui-single-line-group': 'Single-line group',
	'ui-summary': 'UI summary',
	'ui-title': 'UI title',
	'ui-title-key': 'Title key',
	'ui-unique-key': 'Unique key',
	'ui-visible-if': 'Visible if'
};

const EXTENSION_LABELS: Record<string, string> = {
	'x-eda-nokia-com': 'EDA extensions'
};

function asObject(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function extensionLabel(key: string): string {
	if (EXTENSION_LABELS[key]) return EXTENSION_LABELS[key];
	const stripped = key.replace(/^x-/, '').replace(/-/g, ' ');
	return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

function fieldLabel(key: string): string {
	return EDA_FIELD_LABELS[key] ?? key.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format a vendor extension value for display in the UI. */
export function formatExtensionValue(value: unknown): { text: string; valueType: VendorExtensionField['valueType'] } {
	if (value === null || value === undefined) {
		return { text: '—', valueType: 'string' };
	}
	if (typeof value === 'boolean') {
		return { text: value ? 'yes' : 'no', valueType: 'boolean' };
	}
	if (typeof value === 'number') {
		return { text: String(value), valueType: 'number' };
	}
	if (typeof value === 'string') {
		return { text: value, valueType: 'string' };
	}
	return { text: JSON.stringify(value, null, 2), valueType: 'json' };
}

function fieldsFromObject(value: Record<string, unknown>): VendorExtensionField[] {
	return Object.entries(value)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, fieldValue]) => {
			const formatted = formatExtensionValue(fieldValue);
			return {
				key,
				label: fieldLabel(key),
				value: formatted.text,
				valueType: formatted.valueType
			};
		});
}

/** Parse a raw `x-eda-nokia-com` object into a typed shape. */
export function parseEdaExtension(value: unknown): EdaNokiaComExtension | null {
	const obj = asObject(value);
	return obj ? (obj as EdaNokiaComExtension) : null;
}

/** Build structured display entries for every `x-*` key on an OpenAPI object. */
export function extractVendorExtensions(obj: Record<string, unknown>): VendorExtensionEntry[] {
	const entries: VendorExtensionEntry[] = [];

	for (const [key, value] of Object.entries(obj)) {
		if (!key.startsWith('x-')) continue;

		const nested = asObject(value);
		entries.push({
			key,
			label: extensionLabel(key),
			fields: nested ? fieldsFromObject(nested) : [],
			raw: value
		});
	}

	return entries.sort((a, b) => a.key.localeCompare(b.key));
}

/** Whether an object carries any `x-*` vendor extensions. */
export function hasVendorExtensions(obj: Record<string, unknown>): boolean {
	return Object.keys(obj).some((key) => key.startsWith('x-'));
}

export interface VendorExtensionSummary {
	/** Total `x-*` extension objects in the spec. */
	total: number;
	/** `x-eda-nokia-com` occurrences (Nokia EDA UI metadata). */
	edaCount: number;
	/** Extensions on path items or operations. */
	pathLevel: number;
	/** Extensions under `components.schemas`. */
	schemaLevel: number;
	/** Extensions on the spec root or `info` object. */
	specLevel: number;
}

function countExtensionsInObject(obj: Record<string, unknown>): { total: number; eda: number } {
	let total = 0;
	let eda = 0;
	for (const key of Object.keys(obj)) {
		if (!key.startsWith('x-')) continue;
		total++;
		if (key === 'x-eda-nokia-com') eda++;
	}
	return { total, eda };
}

/** Count vendor extensions by location for discoverability hints in the UI. */
export function summarizeVendorExtensionsInSpec(
	spec: Record<string, unknown>
): VendorExtensionSummary {
	let total = 0;
	let edaCount = 0;
	let pathLevel = 0;
	let schemaLevel = 0;
	let specLevel = 0;

	const rootCounts = countExtensionsInObject(spec);
	total += rootCounts.total;
	edaCount += rootCounts.eda;
	specLevel += rootCounts.total;

	const info = asObject(spec.info);
	if (info) {
		const infoCounts = countExtensionsInObject(info);
		total += infoCounts.total;
		edaCount += infoCounts.eda;
		specLevel += infoCounts.total;
	}

	const paths = asObject(spec.paths);
	if (paths) {
		for (const pathItem of Object.values(paths)) {
			if (!pathItem || typeof pathItem !== 'object' || Array.isArray(pathItem)) continue;
			const walk = (node: unknown): void => {
				if (!node || typeof node !== 'object' || Array.isArray(node)) return;
				const counts = countExtensionsInObject(node as Record<string, unknown>);
				pathLevel += counts.total;
				total += counts.total;
				edaCount += counts.eda;
				for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
					if (key.startsWith('x-')) continue;
					walk(value);
				}
			};
			walk(pathItem);
		}
	}

	const schemas = asObject(asObject(spec.components)?.schemas);
	if (schemas) {
		const walk = (node: unknown): void => {
			if (!node || typeof node !== 'object') return;
			if (Array.isArray(node)) {
				for (const item of node) walk(item);
				return;
			}
			const counts = countExtensionsInObject(node as Record<string, unknown>);
			schemaLevel += counts.total;
			total += counts.total;
			edaCount += counts.eda;
			for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
				if (key.startsWith('x-')) continue;
				walk(value);
			}
		};
		walk(schemas);
	}

	return { total, edaCount, pathLevel, schemaLevel, specLevel };
}

/** Vendor extensions declared on the OpenAPI document root or `info` block. */
export function extractSpecLevelExtensions(spec: Record<string, unknown>): VendorExtensionEntry[] {
	const byKey = new Map<string, VendorExtensionEntry>();

	for (const entry of extractVendorExtensions(spec)) {
		byKey.set(entry.key, entry);
	}

	const info = asObject(spec.info);
	if (info) {
		for (const entry of extractVendorExtensions(info)) {
			if (!byKey.has(entry.key)) byKey.set(entry.key, entry);
		}
	}

	return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}
