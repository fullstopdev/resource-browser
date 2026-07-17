export type SchemaCategory =
	| 'crd'
	| 'crd-list'
	| 'crd-internal'
	| 'query'
	| 'shared'
	| 'core-api'
	| 'platform'
	| 'other';

export interface SchemaPresentation {
	/** Raw OpenAPI component schema name */
	name: string;
	/** Human-readable primary label, e.g. "Alarm" */
	label: string;
	/** Secondary hint shown under the label */
	subtitle: string;
	category: SchemaCategory;
	/** CRD kind when this schema represents a Kubernetes resource */
	kind: string | null;
	/** Whether this is a generated/internal helper schema */
	isInternal: boolean;
	/** EQL / query-related schema */
	isQueryRelated: boolean;
}

const INTERNAL_SUFFIXES = [
	'_metadata',
	'_alarms',
	'_deviations',
	'_DeletedResourceEntry',
	'_DeletedResources'
] as const;

/**
 * EQL / streaming query language types (including autocomplete helpers under
 * `/core/query/*` and `/core/autocomplete/*`).
 *
 * Excludes domain-specific *Query DTOs that are not the EQL engine:
 * - `AccessQuery` — RBAC check payload nested in `CheckAccessRequest`
 * - `TopoOverlayAttrQuery` — topology overlay attribute selector
 */
const QUERY_SCHEMA_PATTERN =
	/^Query(?:Field|Where|Eql|Convert|Completion|OrderBy|Response)|^CompletionsQuery$|^Eql/i;

/** Autocomplete request/response types used when building or parsing EQL/NQL queries. */
const QUERY_AUTOCOMPLETE_PATTERN = /^AutoComplet|^GetLabelCompletion|^LabelCompletion/;

/** Cross-cutting API building blocks reused across many endpoints and CRD payloads. */
const SHARED_SCHEMAS = new Set([
	'CrAnnotation',
	'Credentials',
	'ErrorResponse',
	'GroupVersionKind',
	'GroupVersionResource',
	'Health',
	'HealthServiceStatus',
	'Identifier',
	'K8SPatchOp',
	'Metadata',
	'NameNamespace',
	'NsCrGvkName',
	'Patch'
]);

const PLATFORM_SCHEMAS = new Set(['AppGroup', 'AppGroupVersion']);

function schemaBaseName(schemaName: string): string {
	return schemaName.includes('.') ? (schemaName.split('.').pop() ?? schemaName) : schemaName;
}

function isFqdnCrdName(schemaName: string): boolean {
	return schemaName.includes('.');
}

export function isQueryRelatedSchemaName(schemaName: string): boolean {
	const base = schemaBaseName(schemaName);
	return QUERY_SCHEMA_PATTERN.test(base) || QUERY_AUTOCOMPLETE_PATTERN.test(base);
}

export function extractKindFromSchemaName(schemaName: string): string | null {
	const base = schemaBaseName(schemaName);

	for (const suffix of INTERNAL_SUFFIXES) {
		if (base.endsWith(suffix)) {
			return base.slice(0, -suffix.length) || null;
		}
	}

	if (base.endsWith('List')) {
		return base.slice(0, -4) || null;
	}

	if (isFqdnCrdName(schemaName) && /^[A-Z]/.test(base) && !PLATFORM_SCHEMAS.has(base)) {
		return base;
	}

	return null;
}

function internalSuffixLabel(schemaName: string): string | null {
	const base = schemaBaseName(schemaName);
	for (const suffix of INTERNAL_SUFFIXES) {
		if (base.endsWith(suffix)) {
			return suffix.replace(/^_/, '').replace(/_/g, ' ');
		}
	}
	return null;
}

export function classifySchemaName(schemaName: string): SchemaPresentation {
	const base = schemaBaseName(schemaName);
	const kind = extractKindFromSchemaName(schemaName);
	const internalSuffix = internalSuffixLabel(schemaName);
	const isInternal = internalSuffix !== null;
	const isList = base.endsWith('List') && !isInternal;
	const isQueryRelated = isQueryRelatedSchemaName(schemaName);
	const fqPrefix = schemaName.includes('.') ? schemaName.split('.').slice(0, -1).join('.') : '';

	if (PLATFORM_SCHEMAS.has(base)) {
		return {
			name: schemaName,
			label: base,
			subtitle: 'Application platform metadata',
			category: 'platform',
			kind: null,
			isInternal: false,
			isQueryRelated: false
		};
	}

	if (isInternal && kind) {
		return {
			name: schemaName,
			label: kind,
			subtitle: `Generated ${internalSuffix} wrapper`,
			category: 'crd-internal',
			kind,
			isInternal: true,
			isQueryRelated: false
		};
	}

	if (isQueryRelated) {
		return {
			name: schemaName,
			label: base,
			subtitle: 'Query / EQL related type',
			category: 'query',
			kind: null,
			isInternal: false,
			isQueryRelated: true
		};
	}

	if (SHARED_SCHEMAS.has(base)) {
		return {
			name: schemaName,
			label: base,
			subtitle: 'Shared API type',
			category: 'shared',
			kind: null,
			isInternal: false,
			isQueryRelated: false
		};
	}

	if (isList && kind) {
		return {
			name: schemaName,
			label: `${kind} list`,
			subtitle: isFqdnCrdName(schemaName) ? 'Paginated CRD list response' : 'Paginated list response',
			category: 'crd-list',
			kind: isFqdnCrdName(schemaName) ? kind : null,
			isInternal: false,
			isQueryRelated: false
		};
	}

	if (isFqdnCrdName(schemaName) && kind && /^[A-Z]/.test(kind)) {
		return {
			name: schemaName,
			label: kind,
			subtitle: fqPrefix ? `CRD resource · ${fqPrefix}` : 'CRD resource',
			category: 'crd',
			kind,
			isInternal: false,
			isQueryRelated: false
		};
	}

	// Flat REST DTOs — PascalCase or camelCase (OpenAPI generator style), excluding
	// query/EQL, shared, list, CRD, and platform buckets above.
	if (/^[A-Za-z]/.test(base)) {
		return {
			name: schemaName,
			label: base,
			subtitle: 'Core API model',
			category: 'core-api',
			kind: null,
			isInternal: false,
			isQueryRelated: false
		};
	}

	return {
		name: schemaName,
		label: base,
		subtitle: schemaName,
		category: 'other',
		kind: null,
		isInternal: false,
		isQueryRelated: false
	};
}

export const SCHEMA_CATEGORY_ORDER: SchemaCategory[] = [
	'query',
	'shared',
	'core-api',
	'crd',
	'platform',
	'crd-list',
	'other',
	'crd-internal'
];

export const SCHEMA_CATEGORY_LABELS: Record<SchemaCategory, string> = {
	crd: 'CRD resources',
	query: 'Query & EQL',
	shared: 'Shared / common types',
	'core-api': 'Core API models',
	platform: 'Platform',
	'crd-list': 'List responses',
	other: 'Other schemas',
	'crd-internal': 'Internal / generated'
};
