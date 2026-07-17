import type { OpenApiDiffStatus, OpenApiPathChange, OpenApiSchemaSummary } from '$lib/openapi/types';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'] as const;

const OP_COMPARE_KEYS = [
	'operationId',
	'summary',
	'description',
	'tags',
	'deprecated',
	'parameters',
	'requestBody',
	'responses'
] as const;

/**
 * Normalize API version tokens so `…/v1alpha1/…`, `…v1alpha1.…`,
 * operationIds like `…V1alpha1Mirrors`, and JSON string values like `"v1alpha1"`
 * pair with their `v1` / `V1` counterparts.
 */
export function normalizeOpenApiVersionToken(value: string): string {
	if (value == null) return '';
	return value
		// Dotted package segments: .v1alpha1. / .v1" / .v1$
		.replace(/\.v\d+(?:alpha|beta)?\d*(?![A-Za-z0-9])/gi, '.VERSION')
		// Path / apiVersion segments: /v1alpha1/ /v1" /v1$
		.replace(/\/v\d+(?:alpha|beta)?\d*(?![A-Za-z0-9])/gi, '/VERSION')
		// CamelCase operationId tokens: listFooV1alpha1Bar / …ComV1alpha1" (JSON) / …ComV1
		// Lookahead allows end-of-string OR non-alnum (e.g. closing JSON quote).
		.replace(/V\d+(?:[Aa]lpha|[Bb]eta)?\d*(?=[A-Z]|[^A-Za-z0-9]|$)/g, 'VERSION')
		// Standalone version string values (e.g. x-eda ui-auto-completes.version)
		.replace(/"v\d+(?:alpha|beta)?\d*"/gi, '"VERSION"')
		// Free-text / description tokens: "…nokia.com v1alpha1" ↔ "…nokia.com v1"
		.replace(/(^|[^A-Za-z0-9./])v\d+(?:alpha|beta)?\d*(?=[^A-Za-z0-9]|$)/gi, '$1VERSION');
}

export function openApiSchemaLogicalKey(name: string): string {
	return normalizeOpenApiVersionToken(name);
}

export function openApiPathLogicalKey(path: string): string {
	return normalizeOpenApiVersionToken(path);
}

/** Extract `v1alpha1`-style segment from a schema name or path, if present. */
export function extractEmbeddedApiVersion(text: string): string | null {
	const dotted = /\.(v\d+(?:alpha|beta)?\d*)(?=\.|$)/i.exec(text);
	if (dotted?.[1]) return dotted[1];
	const slashed = /\/(v\d+(?:alpha|beta)?\d*)(?=\/|$)/i.exec(text);
	return slashed?.[1] ?? null;
}

function shortRefName(ref: string): string {
	const cleaned = ref.replace(/^#\/components\/schemas\//, '');
	const dot = cleaned.lastIndexOf('.');
	return dot >= 0 ? cleaned.slice(dot + 1) : cleaned;
}

function isPrimitiveScalar(value: unknown): boolean {
	return (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	);
}

function isPrimitiveArray(list: unknown[]): boolean {
	return list.every(isPrimitiveScalar);
}

/** Summarize a JSON Schema-ish object for add/remove leaves — never `{N keys}`. */
function formatSchemaObject(value: Record<string, unknown>): string {
	if (typeof value.$ref === 'string') {
		return `$ref:${shortRefName(value.$ref)}`;
	}

	const bits: string[] = [];
	if (typeof value.type === 'string') bits.push(value.type);
	if (typeof value.format === 'string') bits.push(`format:${value.format}`);
	if (value.items != null) {
		if (typeof value.items === 'object' && !Array.isArray(value.items)) {
			const items = value.items as Record<string, unknown>;
			if (typeof items.$ref === 'string') {
				bits.push(`items:$ref:${shortRefName(items.$ref)}`);
			} else if (typeof items.type === 'string') {
				bits.push(`items:${items.type}`);
			} else {
				bits.push('items:{…}');
			}
		} else {
			bits.push(`items:${formatValue(value.items)}`);
		}
	}
	if (value.deprecated === true) bits.push('deprecated');
	if (bits.length > 0) return `{${bits.join(', ')}}`;

	const keys = Object.keys(value);
	if (keys.length === 0) return '{}';
	if (keys.length <= 5) return `{${keys.join(', ')}}`;
	return `{${keys.slice(0, 4).join(', ')}, …+${keys.length - 4}}`;
}

/**
 * Format enum / primitive-array changes like CRD release-changes:
 * full JSON when small; otherwise `− "a", + "b"` style — never `[N items] → [N items]`.
 */
function formatPrimitiveArrayChange(sourceList: unknown[], targetList: unknown[]): string {
	const srcJson = JSON.stringify(sourceList);
	const tgtJson = JSON.stringify(targetList);
	const compact =
		sourceList.length <= 12 &&
		targetList.length <= 12 &&
		srcJson.length + tgtJson.length <= 240;

	if (compact) {
		return `${srcJson} → ${tgtJson}`;
	}

	const beforeSet = new Set(sourceList.map(String));
	const afterSet = new Set(targetList.map(String));
	const removed = sourceList.filter((v) => !afterSet.has(String(v)));
	const added = targetList.filter((v) => !beforeSet.has(String(v)));
	if (removed.length === 0 && added.length === 0) {
		return `${srcJson} → ${tgtJson}`;
	}
	const before =
		removed.length > 0 ? removed.map((v) => `− ${JSON.stringify(v)}`).join(', ') : '—';
	const after = added.length > 0 ? added.map((v) => `+ ${JSON.stringify(v)}`).join(', ') : '—';
	return `${before} → ${after}`;
}

function formatValue(value: unknown): string {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	if (typeof value === 'string') {
		const q = JSON.stringify(value);
		// Keep table cells readable — long descriptions truncate like CRD summaries.
		if (q.length > 120) return `${q.slice(0, 117)}…"`;
		return q;
	}
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (Array.isArray(value)) {
		if (value.length === 0) return '[]';
		if (isPrimitiveArray(value)) {
			if (value.length <= 12) return JSON.stringify(value);
			return `[${value.length} values]`;
		}
		return `[${value.length} items]`;
	}
	if (typeof value === 'object') {
		return formatSchemaObject(value as Record<string, unknown>);
	}
	return String(value);
}

function stableStringify(value: unknown): string {
	if (value === undefined) return '__undefined__';
	try {
		const json = JSON.stringify(value);
		// JSON.stringify(undefined) is undefined — never pass that to .replace().
		return json ?? '__undefined__';
	} catch {
		return String(value);
	}
}

/** Stringify for equality checks, ignoring embedded API version renames in $refs/names. */
function comparableJson(value: unknown): string {
	return normalizeOpenApiVersionToken(stableStringify(value));
}

/**
 * CRD-style recursive object diff — leaf adds/removes/modifies with before → after.
 * Skips changes that are only API-version renames after normalization.
 */
function compareObjects(source: unknown, target: unknown, path = ''): string[] {
	const changes: string[] = [];
	if (comparableJson(source) === comparableJson(target)) return changes;

	const sourceObj =
		source && typeof source === 'object' && !Array.isArray(source)
			? (source as Record<string, unknown>)
			: null;
	const targetObj =
		target && typeof target === 'object' && !Array.isArray(target)
			? (target as Record<string, unknown>)
			: null;

	if (!sourceObj || !targetObj) {
		changes.push(`~ Modified: ${path || '(value)'} :: ${formatValue(source)} → ${formatValue(target)}`);
		return changes;
	}

	const sourceKeys = new Set(Object.keys(sourceObj));
	const targetKeys = new Set(Object.keys(targetObj));

	for (const key of [...targetKeys].sort((a, b) => a.localeCompare(b))) {
		if (!sourceKeys.has(key)) {
			changes.push(`+ Added: ${path}${key} :: ${formatValue(targetObj[key])}`);
		}
	}
	for (const key of [...sourceKeys].sort((a, b) => a.localeCompare(b))) {
		if (!targetKeys.has(key)) {
			changes.push(`- Removed: ${path}${key} :: ${formatValue(sourceObj[key])}`);
		}
	}
	for (const key of [...sourceKeys].sort((a, b) => a.localeCompare(b))) {
		if (!targetKeys.has(key)) continue;
		const sourceVal = sourceObj[key];
		const targetVal = targetObj[key];
		if (comparableJson(sourceVal) === comparableJson(targetVal)) continue;

		const bothObjects =
			sourceVal &&
			targetVal &&
			typeof sourceVal === 'object' &&
			typeof targetVal === 'object' &&
			!Array.isArray(sourceVal) &&
			!Array.isArray(targetVal);

		if (bothObjects) {
			changes.push(...compareObjects(sourceVal, targetVal, `${path}${key}.`));
			continue;
		}

		// Arrays: prefer element identity when items look like parameters/schemas with name+in
		if (Array.isArray(sourceVal) && Array.isArray(targetVal)) {
			changes.push(...compareArrays(sourceVal, targetVal, `${path}${key}`));
			continue;
		}

		changes.push(
			`~ Modified: ${path}${key} :: ${formatValue(sourceVal)} → ${formatValue(targetVal)}`
		);
	}

	return changes;
}

function compareArrays(sourceList: unknown[], targetList: unknown[], path: string): string[] {
	const keyOf = (item: unknown, index: number): string => {
		if (item && typeof item === 'object' && !Array.isArray(item)) {
			const rec = item as Record<string, unknown>;
			if (typeof rec.name === 'string') {
				const loc = typeof rec.in === 'string' ? rec.in : '';
				return loc ? `${loc}.${rec.name}` : rec.name;
			}
			if (typeof rec.status === 'string' || typeof rec.code === 'string') {
				return String(rec.status ?? rec.code);
			}
		}
		return String(index);
	};

	const sourceByKey = new Map<string, unknown>();
	const targetByKey = new Map<string, unknown>();
	sourceList.forEach((item, i) => sourceByKey.set(keyOf(item, i), item));
	targetList.forEach((item, i) => targetByKey.set(keyOf(item, i), item));

	// Indexed primitive arrays (enums, required lists): expand value deltas, never `[N items] → [N items]`.
	const allKeys = [...new Set([...sourceByKey.keys(), ...targetByKey.keys()])];
	const mostlyIndexed = allKeys.every((k) => /^\d+$/.test(k));
	if (mostlyIndexed && comparableJson(sourceList) !== comparableJson(targetList)) {
		if (isPrimitiveArray(sourceList) && isPrimitiveArray(targetList)) {
			return [`~ Modified: ${path} :: ${formatPrimitiveArrayChange(sourceList, targetList)}`];
		}
		return [
			`~ Modified: ${path} :: ${formatValue(sourceList)} → ${formatValue(targetList)}`
		];
	}

	const changes: string[] = [];
	for (const key of allKeys.sort((a, b) => a.localeCompare(b))) {
		const src = sourceByKey.get(key);
		const tgt = targetByKey.get(key);
		const childPath = `${path}.${key}`;
		if (!src && tgt) {
			changes.push(`+ Added: ${childPath} :: ${formatValue(tgt)}`);
		} else if (src && !tgt) {
			changes.push(`- Removed: ${childPath} :: ${formatValue(src)}`);
		} else if (src && tgt) {
			changes.push(...compareObjects(src, tgt, `${childPath}.`));
		}
	}
	return changes;
}

function operationIdOf(op: unknown): string | undefined {
	if (!op || typeof op !== 'object') return undefined;
	const id = (op as Record<string, unknown>).operationId;
	return typeof id === 'string' && id.trim() ? id : undefined;
}

function compareParameterLists(sourceVal: unknown, targetVal: unknown): string[] {
	const sourceList = Array.isArray(sourceVal) ? sourceVal : [];
	const targetList = Array.isArray(targetVal) ? targetVal : [];
	return compareArrays(sourceList, targetList, 'parameters');
}

function compareResponseMaps(sourceVal: unknown, targetVal: unknown): string[] {
	if (comparableJson(sourceVal) === comparableJson(targetVal)) return [];
	const source = (sourceVal ?? {}) as Record<string, unknown>;
	const target = (targetVal ?? {}) as Record<string, unknown>;
	const changes = compareObjects(source, target, 'responses.');
	// If deep diff exploded into noise-only version renames, comparableJson already filtered;
	// still guard empty.
	return changes.length > 0 ? changes : ['~ Modified: responses'];
}

function compareOperationFields(sourceOp: unknown, targetOp: unknown): string[] {
	const source = (sourceOp ?? {}) as Record<string, unknown>;
	const target = (targetOp ?? {}) as Record<string, unknown>;
	const changes: string[] = [];

	for (const key of OP_COMPARE_KEYS) {
		const srcVal = source[key];
		const tgtVal = target[key];
		if (srcVal === undefined && tgtVal === undefined) continue;

		if (srcVal === undefined && tgtVal !== undefined) {
			if (key === 'parameters' && Array.isArray(tgtVal)) {
				changes.push(...compareParameterLists([], tgtVal));
			} else {
				changes.push(`+ Added: ${key} :: ${formatValue(tgtVal)}`);
			}
			continue;
		}
		if (srcVal !== undefined && tgtVal === undefined) {
			if (key === 'parameters' && Array.isArray(srcVal)) {
				changes.push(...compareParameterLists(srcVal, []));
			} else {
				changes.push(`- Removed: ${key} :: ${formatValue(srcVal)}`);
			}
			continue;
		}

		if (comparableJson(srcVal) === comparableJson(tgtVal)) continue;

		if (key === 'parameters') {
			changes.push(...compareParameterLists(srcVal, tgtVal));
		} else if (key === 'responses') {
			changes.push(...compareResponseMaps(srcVal, tgtVal));
		} else if (key === 'requestBody') {
			changes.push(...compareObjects(srcVal, tgtVal, 'requestBody.'));
		} else if (key === 'tags' && Array.isArray(srcVal) && Array.isArray(tgtVal)) {
			// Version-normalized tag equality already handled above; remaining = real change.
			changes.push(
				`~ Modified: tags :: ${formatValue(srcVal)} → ${formatValue(tgtVal)}`
			);
		} else {
			changes.push(
				`~ Modified: ${key} :: ${formatValue(srcVal)} → ${formatValue(tgtVal)}`
			);
		}
	}

	return changes;
}

type NamedEntry<T> = { name: string; value: T };

function indexByLogicalKey<T>(
	entries: NamedEntry<T>[],
	logicalKey: (name: string) => string
): Map<string, NamedEntry<T>> {
	const map = new Map<string, NamedEntry<T>>();
	for (const entry of entries) {
		const key = logicalKey(entry.name);
		const existing = map.get(key);
		// Prefer the lexicographically greatest name so v2 wins over v1 if duplicates ever appear.
		if (!existing || entry.name.localeCompare(existing.name) > 0) {
			map.set(key, entry);
		}
	}
	return map;
}

export function compareOpenApiPaths(
	sourcePaths: Record<string, Record<string, unknown>> | undefined,
	targetPaths: Record<string, Record<string, unknown>> | undefined
): OpenApiPathChange[] {
	const changes: OpenApiPathChange[] = [];
	const source = sourcePaths ?? {};
	const target = targetPaths ?? {};

	const sourceByKey = indexByLogicalKey(
		Object.entries(source).map(([name, value]) => ({ name, value })),
		openApiPathLogicalKey
	);
	const targetByKey = indexByLogicalKey(
		Object.entries(target).map(([name, value]) => ({ name, value })),
		openApiPathLogicalKey
	);
	const allKeys = [...new Set([...sourceByKey.keys(), ...targetByKey.keys()])].sort((a, b) =>
		a.localeCompare(b)
	);

	for (const logicalPath of allKeys) {
		const srcEntry = sourceByKey.get(logicalPath);
		const tgtEntry = targetByKey.get(logicalPath);
		const pathKey = tgtEntry?.name ?? srcEntry?.name ?? logicalPath;
		const sourceOps = (srcEntry?.value ?? {}) as Record<string, unknown>;
		const targetOps = (tgtEntry?.value ?? {}) as Record<string, unknown>;

		const allMethods = new Set([
			...Object.keys(sourceOps).filter((m) =>
				HTTP_METHODS.includes(m as (typeof HTTP_METHODS)[number])
			),
			...Object.keys(targetOps).filter((m) =>
				HTTP_METHODS.includes(m as (typeof HTTP_METHODS)[number])
			)
		]);

		for (const method of [...allMethods].sort((a, b) => a.localeCompare(b))) {
			const srcOp = sourceOps[method];
			const tgtOp = targetOps[method];
			if (!srcOp && tgtOp) {
				changes.push({
					path: pathKey,
					method: method.toUpperCase(),
					operationId: operationIdOf(tgtOp),
					changeType: 'added',
					details: [`+ Added ${method.toUpperCase()} ${pathKey}`]
				});
			} else if (srcOp && !tgtOp) {
				changes.push({
					path: srcEntry?.name ?? pathKey,
					method: method.toUpperCase(),
					operationId: operationIdOf(srcOp),
					changeType: 'removed',
					details: [`- Removed ${method.toUpperCase()} ${srcEntry?.name ?? pathKey}`]
				});
			} else if (srcOp && tgtOp) {
				const opChanges = compareOperationFields(srcOp, tgtOp);
				if (opChanges.length > 0) {
					changes.push({
						path: pathKey,
						method: method.toUpperCase(),
						operationId: operationIdOf(tgtOp) ?? operationIdOf(srcOp),
						changeType: 'modified',
						details: opChanges
					});
				}
			}
		}
	}

	return changes;
}

export function compareOpenApiSchemas(
	sourceSchemas: Record<string, unknown> | undefined,
	targetSchemas: Record<string, unknown> | undefined
): { schemaChanges: string[]; schemaSummary: OpenApiSchemaSummary } {
	const source = sourceSchemas ?? {};
	const target = targetSchemas ?? {};
	const sourceByKey = indexByLogicalKey(
		Object.entries(source).map(([name, value]) => ({ name, value })),
		openApiSchemaLogicalKey
	);
	const targetByKey = indexByLogicalKey(
		Object.entries(target).map(([name, value]) => ({ name, value })),
		openApiSchemaLogicalKey
	);

	const schemaChanges: string[] = [];
	let added = 0;
	let removed = 0;
	let modified = 0;
	let apiVersion = 0;
	const versionPairs: Array<{ source: string; target: string }> = [];

	const allKeys = [...new Set([...sourceByKey.keys(), ...targetByKey.keys()])].sort((a, b) =>
		a.localeCompare(b)
	);

	for (const key of allKeys) {
		const src = sourceByKey.get(key);
		const tgt = targetByKey.get(key);
		if (!src && tgt) {
			added += 1;
			schemaChanges.push(`+ Added schema: ${tgt.name}`);
			continue;
		}
		if (src && !tgt) {
			removed += 1;
			schemaChanges.push(`- Removed schema: ${src.name}`);
			continue;
		}
		if (!src || !tgt) continue;

		const sameContent = comparableJson(src.value) === comparableJson(tgt.value);
		if (src.name !== tgt.name && sameContent) {
			apiVersion += 1;
			versionPairs.push({ source: src.name, target: tgt.name });
			continue;
		}
		if (!sameContent) {
			modified += 1;
			// Always use target name — version-only pairs are covered by the API version note;
			// real content diffs get CRD-style leaf lines underneath.
			schemaChanges.push(`~ Modified schema: ${tgt.name}`);
			const leafChanges = compareObjects(src.value, tgt.value, '');
			if (leafChanges.length > 0) {
				schemaChanges.push(...leafChanges);
			} else {
				// Defensive: content unequal after normalize but deep walk found nothing.
				schemaChanges.push(`~ Modified: (schema) :: ${formatValue(src.value)} → ${formatValue(tgt.value)}`);
			}
		}
	}

	for (const pair of versionPairs) {
		schemaChanges.push(`~ API version schema: ${pair.source} → ${pair.target}`);
	}

	return {
		schemaChanges,
		schemaSummary: { added, removed, modified, apiVersion }
	};
}

export function compareOpenApiSpecs(
	source: Record<string, unknown>,
	target: Record<string, unknown>
): {
	pathChanges: OpenApiPathChange[];
	schemaChanges: string[];
	schemaSummary: OpenApiSchemaSummary;
} {
	const sourcePaths = source.paths as Record<string, Record<string, unknown>> | undefined;
	const targetPaths = target.paths as Record<string, Record<string, unknown>> | undefined;
	const pathChanges = compareOpenApiPaths(sourcePaths, targetPaths);

	const sourceSchemas = (source.components as Record<string, unknown> | undefined)?.schemas as
		| Record<string, unknown>
		| undefined;
	const targetSchemas = (target.components as Record<string, unknown> | undefined)?.schemas as
		| Record<string, unknown>
		| undefined;
	const { schemaChanges, schemaSummary } = compareOpenApiSchemas(sourceSchemas, targetSchemas);

	return { pathChanges, schemaChanges, schemaSummary };
}

function isVersionOnlySchemaLine(line: string): boolean {
	return (
		/^~\s+API version schema:/i.test(line) ||
		/API version \d+ schemas?/i.test(line) ||
		/Renamed \d+ schemas? with API version/i.test(line)
	);
}

/**
 * Top-level API status (CRD-aligned): added/removed/modified/shared.
 * - Content path/schema diffs → `modified`
 * - Identical or version-token-only → `shared` (stable; never a peer `api_version` status)
 * Version-token-only schema renames stay in `schemaSummary.apiVersion` for an in-card subcategory.
 * `api_version` / `unchanged` are never returned from this classifier.
 */
export function classifyOpenApiDiffStatus(
	pathChanges: OpenApiPathChange[],
	schemaChanges: string[],
	schemaSummary?: OpenApiSchemaSummary,
	_options?: { versionBumped?: boolean }
): OpenApiDiffStatus {
	const contentSchemaTouched = schemaSummary
		? schemaSummary.added + schemaSummary.removed + schemaSummary.modified > 0
		: schemaChanges.filter((l) => !isVersionOnlySchemaLine(l)).length > 0;
	const hasPathChanges = pathChanges.length > 0;

	// Real structural/value diffs always win → Modified.
	if (hasPathChanges || contentSchemaTouched) return 'modified';
	// Present in both with no content diff (incl. version-token-only) → Shared.
	// Filters must never reclassify this; Shared stays Shared.
	return 'shared';
}

export function humanizePathChange(change: OpenApiPathChange): string {
	const methodPath = `${change.method} ${change.path}`;
	const label = change.operationId?.trim()
		? `${change.operationId} · ${methodPath}`
		: methodPath;
	if (change.changeType === 'added') return `Added ${label}`;
	if (change.changeType === 'removed') return `Removed ${label}`;
	return `Modified ${label}`;
}
