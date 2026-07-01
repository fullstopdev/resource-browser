import { findManifestEntry } from '$lib/manifest/lookup';
import { getLatestVersion } from '$lib/versions';
import { fetchSchemas, schemaPath } from '$lib/yaml-validation/schemaCache';
import { parseDocuments } from '$lib/yaml-validation/parseDocuments';
import type { ManifestEntry } from '$lib/yaml-validation/types';
import { extractDocumentYaml, inferManifestIdentity } from './replaceDocument';
import {
	collectSchemaProperties,
	findNestedSchemaPropertyPath,
	findSimilarSchemaProperty,
	getChildPropertySchema,
	schemaAtYamlPath,
	schemaParentAtPath
} from './schemaNavigation';
import type { BundleIssue, SuggestedFix } from './types';

function isObjectSchema(node: unknown): node is Record<string, unknown> {
	return !!node && typeof node === 'object' && !Array.isArray(node);
}

function getSchemaTypes(schema: unknown): string[] {
	if (!isObjectSchema(schema)) return [];
	if (typeof schema.type === 'string') return [schema.type];
	if (Array.isArray(schema.type)) {
		return schema.type.filter((t): t is string => typeof t === 'string');
	}
	return [];
}

export function collectSchemaConstraints(schema: unknown): {
	types: string[];
	enumValues: unknown[];
	constValue: unknown;
} {
	const types = new Set<string>();
	const enumValues: unknown[] = [];
	let constValue: unknown;

	const visit = (node: unknown) => {
		if (!isObjectSchema(node)) return;
		for (const t of getSchemaTypes(node)) types.add(t);
		if (Array.isArray(node.enum)) enumValues.push(...node.enum);
		if ('const' in node) constValue = node.const;
		const branches = node.allOf;
		if (Array.isArray(branches)) {
			for (const branch of branches) visit(branch);
		}
	};

	visit(schema);
	return { types: [...types], enumValues, constValue };
}

export function findUniqueCaseInsensitiveMatch(
	value: string,
	candidates: unknown[]
): unknown | null {
	const matches = candidates.filter(
		(c) => typeof c === 'string' && c.toLowerCase() === value.toLowerCase()
	);
	if (matches.length !== 1) return null;
	return matches[0];
}

const FUZZY_ENUM_SUFFIXES = ['_ai', '_api'] as const;

function stripFuzzyEnumSuffix(value: string): string {
	for (const suffix of FUZZY_ENUM_SUFFIXES) {
		if (value.length > suffix.length && value.toLowerCase().endsWith(suffix.toLowerCase())) {
			return value.slice(0, -suffix.length);
		}
	}
	return value;
}

function normalizeEnumToken(value: string): string {
	return stripFuzzyEnumSuffix(value).replace(/_/g, '').toLowerCase();
}

/**
 * Resolve an invalid enum string to a unique allowed value when safe.
 * Tries exact case-insensitive match first, then suffix stripping (_ai) and underscore normalization.
 */
export function findUniqueFuzzyEnumMatch(
	value: string,
	candidates: unknown[]
): unknown | null {
	const caseMatch = findUniqueCaseInsensitiveMatch(value, candidates);
	if (caseMatch !== null) return caseMatch;

	const stringCandidates = candidates.filter((c): c is string => typeof c === 'string');
	if (stringCandidates.length === 0) return null;

	const stripped = stripFuzzyEnumSuffix(value);
	if (stripped !== value) {
		const suffixMatches = stringCandidates.filter((c) => c.toLowerCase() === stripped.toLowerCase());
		if (suffixMatches.length === 1) return suffixMatches[0];
	}

	const normalizedValue = normalizeEnumToken(value);
	const normalizedMatches = stringCandidates.filter(
		(c) => normalizeEnumToken(c) === normalizedValue
	);
	if (normalizedMatches.length === 1) return normalizedMatches[0];

	return null;
}

export function isEnumConstraintIssue(issue: BundleIssue): boolean {
	return /must be one of|exact case/i.test(issue.message);
}

function getValueByPointer(data: unknown, pointer: string): unknown {
	if (!pointer) return data;
	const parts = pointer.split('/').filter(Boolean);
	let current: unknown = data;
	for (const p of parts) {
		const key = p.replace(/~1/g, '/').replace(/~0/g, '~');
		if (current === null || current === undefined) return undefined;
		if (typeof current !== 'object') return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

function getValueByYamlPath(data: unknown, fieldPath: string): unknown {
	const segments = fieldPath.replace(/^spec\./, '').split('.').filter(Boolean);
	return getValueBySegments(data, segments);
}

function getValueBySegments(data: unknown, segments: string[]): unknown {
	let current: unknown = data;
	for (const segment of segments) {
		const match = segment.match(/^([^[]+)\[(\d+)\]$/);
		const key = match?.[1] ?? segment;
		const index = match?.[2];
		if (current === null || current === undefined || typeof current !== 'object') return undefined;
		current = (current as Record<string, unknown>)[key];
		if (index !== undefined) {
			if (!Array.isArray(current)) return undefined;
			current = current[Number(index)];
		}
	}
	return current;
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
	if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

/**
 * When a required field is missing, check for a misspelled sibling key that should be renamed
 * (e.g. `protocol` → `protocols`) instead of inserting an empty placeholder.
 */
export function findSiblingRenameForRequiredField(
	missingKey: string,
	parentSchema: unknown,
	parentData: unknown,
	line?: number,
	parentKey?: string
): SuggestedFix | undefined {
	const parentRecord = asObjectRecord(parentData);
	if (!parentRecord) return undefined;

	const existing = parentRecord[missingKey];
	if (existing !== undefined && existing !== null) return undefined;

	const parentProps = collectSchemaProperties(parentSchema);
	if (!parentProps) return undefined;

	for (const siblingKey of Object.keys(parentRecord)) {
		if (parentProps.has(siblingKey)) continue;
		const similar = findSimilarSchemaProperty(siblingKey, parentProps, parentKey);
		if (similar === missingKey) {
			return { action: 'renameKey', field: siblingKey, value: missingKey, line };
		}
	}

	return undefined;
}

function leafKeyFromInstancePath(instancePath: string): string {
	const segments = instancePath.replace(/^\//, '').split('/').filter(Boolean);
	return segments[segments.length - 1] ?? '';
}

/** Schema-appropriate empty placeholder for a missing required field. */
export function emptyPlaceholderForSchema(schema: unknown): string {
	const types = getSchemaTypes(schema);
	if (types.includes('array')) return '[]';
	if (types.includes('object')) return '{}';
	if (types.includes('boolean')) return 'false';
	if (types.includes('integer') || types.includes('number')) return '0';
	return '""';
}

/**
 * Derive a deterministic suggestedFix from an AJV error and the CRD schema at that path.
 * Returns undefined when no safe schema-grounded fix exists.
 */
export function suggestFixFromAjvError(
	keyword: string,
	instancePath: string,
	data: unknown,
	rootSchema: unknown,
	line?: number,
	params?: { missingProperty?: string }
): SuggestedFix | undefined {
	const pathSegments = instancePath.replace(/^\//, '').split('/').filter(Boolean);
	const leafKey = leafKeyFromInstancePath(instancePath);

	if (keyword === 'required') {
		let missingProperty = params?.missingProperty;
		let parentPath = instancePath;
		if (!missingProperty) {
			if (!leafKey) return undefined;
			missingProperty = leafKey;
			parentPath =
				pathSegments.length > 1 ? `/${pathSegments.slice(0, -1).join('/')}` : '';
		} else {
			const segments = instancePath.replace(/^\//, '').split('/').filter(Boolean);
			if (segments[segments.length - 1] === missingProperty) {
				parentPath =
					segments.length > 1 ? `/${segments.slice(0, -1).join('/')}` : '';
			}
		}
		const parentSegments = parentPath.replace(/^\//, '').split('/').filter(Boolean);
		const parentSchema =
			parentSegments.length > 0 ? schemaAtYamlPath(rootSchema, parentSegments) : rootSchema;
		const parentData = getValueByPointer(data, parentPath);
		const parentKey = parentSegments[parentSegments.length - 1];
		const renameFix = findSiblingRenameForRequiredField(
			missingProperty,
			parentSchema,
			parentData,
			line,
			parentKey
		);
		if (renameFix) return renameFix;

		const parentProps = collectSchemaProperties(parentSchema);
		if (parentProps?.has(missingProperty)) {
			const existing = asObjectRecord(parentData)?.[missingProperty];
			if (existing !== undefined && existing !== null) return undefined;
		}

		const childSchema = getChildPropertySchema(parentSchema, missingProperty);
		return {
			action: 'addField',
			field: missingProperty,
			value: emptyPlaceholderForSchema(childSchema),
			line
		};
	}

	const value = getValueByPointer(data, instancePath);
	const leafSchema = schemaAtYamlPath(rootSchema, pathSegments);
	if (!leafSchema) return undefined;
	if (!leafKey) return undefined;

	const { types, enumValues, constValue } = collectSchemaConstraints(leafSchema);

	if (keyword === 'enum' || keyword === 'const') {
		if (typeof value !== 'string') return undefined;
		const allowed = keyword === 'enum' ? enumValues : [constValue];
		const match = findUniqueFuzzyEnumMatch(value, allowed);
		if (match !== null && match !== value && typeof match === 'string') {
			return { field: leafKey, value: match, line, action: 'setValue' };
		}
		return undefined;
	}

	if (keyword === 'type') {
		if (types.includes('string') && typeof value === 'number' && Number.isFinite(value)) {
			return { field: leafKey, value: String(value), line, action: 'setValue' };
		}
		if (types.includes('boolean') && typeof value === 'string') {
			const lower = value.toLowerCase();
			if (lower === 'true' || lower === 'false') {
				return { field: leafKey, value: lower, line, action: 'setValue' };
			}
		}
	}

	if (keyword === 'maximum' && typeof value === 'number' && isObjectSchema(leafSchema)) {
		const max = leafSchema.maximum;
		if (typeof max === 'number' && value > max) {
			return { field: leafKey, value: String(max), line, action: 'setValue' };
		}
	}

	if (keyword === 'minimum' && typeof value === 'number' && isObjectSchema(leafSchema)) {
		const min = leafSchema.minimum;
		if (typeof min === 'number' && value < min) {
			return { field: leafKey, value: String(min), line, action: 'setValue' };
		}
	}

	return undefined;
}

function fieldPathLeafKey(fieldPath?: string): string | undefined {
	if (!fieldPath) return undefined;
	const segments = fieldPath.replace(/^\//, '').replace(/^spec\./, '').split('.').filter(Boolean);
	return segments[segments.length - 1];
}

function isFieldRenameCandidate(issue: BundleIssue): boolean {
	return (
		issue.message.includes('Misspelled field') ||
		issue.message.includes('Unknown field') ||
		/additional propert(y|ies)/i.test(issue.message)
	);
}

function isScalarRelocatable(value: unknown): boolean {
	return (
		value === null ||
		value === undefined ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	);
}

function isTypeConstraintIssue(issue: BundleIssue): boolean {
	return /must be (object|array|string|boolean|integer|number)/i.test(issue.message);
}

/**
 * Derive setValue fix for type mismatches from schema constraints and current value.
 */
export function deriveTypeFixFromSchema(
	issue: BundleIssue,
	leafSchema: unknown,
	specData: unknown
): SuggestedFix | undefined {
	if (!issue.fieldPath || !isTypeConstraintIssue(issue)) return undefined;

	const value = getValueByYamlPath(specData, issue.fieldPath);
	const leafKey = fieldPathLeafKey(issue.fieldPath);
	if (!leafKey) return undefined;

	const { types } = collectSchemaConstraints(leafSchema);

	if (types.includes('string') && typeof value === 'number' && Number.isFinite(value)) {
		return { field: leafKey, value: String(value), line: issue.line, action: 'setValue' };
	}
	if (types.includes('boolean') && typeof value === 'string') {
		const lower = value.toLowerCase();
		if (lower === 'true' || lower === 'false') {
			return { field: leafKey, value: lower, line: issue.line, action: 'setValue' };
		}
	}

	return undefined;
}

function relocateTargetFromMessage(message: string): string | undefined {
	const match = message.match(/relocate to "(.*?)"/i);
	return match?.[1];
}

/**
 * Derive relocateField when an unknown key has a unique nested schema path.
 */
export function deriveRelocateFixFromSchema(
	issue: BundleIssue,
	specSchema: unknown,
	specData: unknown
): SuggestedFix | undefined {
	if (issue.suggestedFix || !issue.fieldPath?.startsWith('spec.')) return undefined;
	if (!isFieldRenameCandidate(issue)) return undefined;

	const pathSegments = issue.fieldPath.replace(/^spec\./, '').split('.').filter(Boolean);
	if (pathSegments.length === 0) return undefined;

	const leafKey = pathSegments[pathSegments.length - 1]!;
	const parentSegments = pathSegments.slice(0, -1);
	const parentSchema =
		parentSegments.length > 0 ? schemaAtYamlPath(specSchema, parentSegments) : specSchema;
	const parentProps = collectSchemaProperties(parentSchema);
	if (parentProps?.has(leafKey)) return undefined;

	const value = getValueByYamlPath(specData, issue.fieldPath);
	if (!isScalarRelocatable(value)) return undefined;

	const messageTarget = relocateTargetFromMessage(issue.message);
	if (messageTarget) {
		if (getValueByYamlPath(specData, messageTarget) !== undefined) return undefined;
		return {
			action: 'relocateField',
			field: issue.fieldPath,
			value: messageTarget,
			line: issue.line
		};
	}

	const nestedPath = findNestedSchemaPropertyPath(specSchema, leafKey);
	if (!nestedPath) return undefined;

	const targetPath = `spec.${nestedPath}`;
	if (getValueByYamlPath(specData, targetPath) !== undefined) return undefined;

	return {
		action: 'relocateField',
		field: issue.fieldPath,
		value: targetPath,
		line: issue.line
	};
}

function isRequiredFieldIssue(issue: BundleIssue): boolean {
	return issue.message.includes('is required');
}

function isRangeConstraintIssue(issue: BundleIssue): boolean {
	return /must be <=|must be >=/i.test(issue.message);
}

/**
 * Derive setValue fix for enum/const mismatches from schema constraints and current value.
 */
export function deriveEnumFixFromSchema(
	issue: BundleIssue,
	leafSchema: unknown,
	specData: unknown
): SuggestedFix | undefined {
	if (!issue.fieldPath || !isEnumConstraintIssue(issue)) return undefined;
	const value = getValueByYamlPath(specData, issue.fieldPath);
	if (typeof value !== 'string') return undefined;

	const { enumValues, constValue } = collectSchemaConstraints(leafSchema);
	const allowed =
		enumValues.length > 0 ? enumValues : constValue !== undefined ? [constValue] : [];
	if (allowed.length === 0) return undefined;

	const match = findUniqueFuzzyEnumMatch(value, allowed);
	if (match === null || match === value || typeof match !== 'string') return undefined;

	const leafKey = fieldPathLeafKey(issue.fieldPath);
	if (!leafKey) return undefined;

	return { action: 'setValue', field: leafKey, value: match, line: issue.line };
}

/**
 * Derive a clamp fix from schema limits and the current value at fieldPath.
 */
export function deriveClampFixFromSchema(
	issue: BundleIssue,
	leafSchema: unknown,
	specData: unknown
): SuggestedFix | undefined {
	if (!issue.fieldPath) return undefined;
	const value = getValueByYamlPath(specData, issue.fieldPath);
	if (typeof value !== 'number' || !Number.isFinite(value) || !isObjectSchema(leafSchema)) {
		return undefined;
	}

	const leafKey = fieldPathLeafKey(issue.fieldPath);
	if (!leafKey) return undefined;

	const max = leafSchema.maximum;
	if (typeof max === 'number' && value > max) {
		return { action: 'setValue', field: leafKey, value: String(max), line: issue.line };
	}

	const min = leafSchema.minimum;
	if (typeof min === 'number' && value < min) {
		return { action: 'setValue', field: leafKey, value: String(min), line: issue.line };
	}

	return undefined;
}

/**
 * Derive addField fix for a missing required property from issue message and schema.
 */
export function deriveRequiredFieldFix(
	issue: BundleIssue,
	specSchema: unknown,
	specData: unknown
): SuggestedFix | undefined {
	if (!issue.fieldPath || !isRequiredFieldIssue(issue)) return undefined;

	const segments = issue.fieldPath.replace(/^spec\./, '').split('.').filter(Boolean);
	if (segments.length === 0) return undefined;

	const leafKey = segments[segments.length - 1]!;
	const parentSegments = segments.slice(0, -1);
	const parentSchema =
		parentSegments.length > 0 ? schemaAtYamlPath(specSchema, parentSegments) : specSchema;
	const parentData =
		parentSegments.length > 0
			? getValueBySegments(specData, parentSegments)
			: specData;
	const parentKey = parentSegments[parentSegments.length - 1];
	const renameFix = findSiblingRenameForRequiredField(
		leafKey,
		parentSchema,
		parentData,
		issue.line,
		parentKey
	);
	if (renameFix) return renameFix;

	const childSchema = getChildPropertySchema(parentSchema, leafKey);
	const current = getValueByYamlPath(specData, issue.fieldPath);
	if (current !== undefined && current !== null) return undefined;

	return {
		action: 'addField',
		field: leafKey,
		value: emptyPlaceholderForSchema(childSchema),
		line: issue.line
	};
}

/**
 * Derive a deterministic suggestedFix from issue metadata and parent schema properties.
 */
export function deriveSuggestedFixForIssue(
	issue: BundleIssue,
	parentProps: Set<string> | null,
	options?: {
		specSchema?: unknown;
		specData?: unknown;
		leafSchema?: unknown;
	}
): SuggestedFix | undefined {
	if (issue.suggestedFix) return issue.suggestedFix;

	if (options?.specSchema && options.specData && isRequiredFieldIssue(issue)) {
		const requiredFix = deriveRequiredFieldFix(issue, options.specSchema, options.specData);
		if (requiredFix) return requiredFix;
	}

	if (options?.leafSchema && options.specData && isRangeConstraintIssue(issue)) {
		const clampFix = deriveClampFixFromSchema(issue, options.leafSchema, options.specData);
		if (clampFix) return clampFix;
	}

	if (options?.leafSchema && options.specData && isEnumConstraintIssue(issue)) {
		const enumFix = deriveEnumFixFromSchema(issue, options.leafSchema, options.specData);
		if (enumFix) return enumFix;
	}

	if (options?.leafSchema && options.specData && isTypeConstraintIssue(issue)) {
		const typeFix = deriveTypeFixFromSchema(issue, options.leafSchema, options.specData);
		if (typeFix) return typeFix;
	}

	if (options?.specSchema && options.specData && isFieldRenameCandidate(issue)) {
		const relocateFix = deriveRelocateFixFromSchema(issue, options.specSchema, options.specData);
		if (relocateFix) return relocateFix;
	}

	if (!parentProps || !issue.fieldPath || !isFieldRenameCandidate(issue)) return undefined;

	const leafKey = fieldPathLeafKey(issue.fieldPath);
	if (!leafKey) return undefined;

	if (parentProps.has(leafKey)) return undefined;

	const pathSegments = issue.fieldPath.replace(/^spec\./, '').split('.').filter(Boolean);
	const parentSegment =
		pathSegments.length >= 2 ? pathSegments[pathSegments.length - 2] : undefined;
	const parentRecord = asObjectRecord(
		pathSegments.length >= 2
			? getValueBySegments(options?.specData, pathSegments.slice(0, -1))
			: options?.specData
	);
	const similar = findSimilarSchemaProperty(leafKey, parentProps, parentSegment, parentRecord ?? undefined);
	if (!similar) return undefined;

	return {
		action: 'renameKey',
		field: leafKey,
		value: similar,
		line: issue.line
	};
}

/** Attach schema-grounded suggestedFix to issues that lack one. */
export async function enrichIssuesWithSuggestedFix(
	yaml: string,
	issues: BundleIssue[],
	options: {
		releaseFolder: string;
		manifest: ManifestEntry[];
		resolveIdentity?: (
			issue: BundleIssue,
			docYaml: string
		) => { kind?: string; group?: string };
		resolveDocIndex?: (issue: BundleIssue) => number;
	}
): Promise<BundleIssue[]> {
	const resolveDocIndex = options.resolveDocIndex ?? ((issue) => issue.docIndex ?? 1);
	const resolveIdentity =
		options.resolveIdentity ??
		((issue, docYaml) => ({
			kind: issue.resourceKind ?? inferManifestIdentity(docYaml).kind,
			group: inferManifestIdentity(docYaml).group
		}));

	const specSchemaByKey = new Map<string, unknown>();

	return Promise.all(
		issues.map(async (issue) => {
			if (issue.suggestedFix) return issue;
			if (issue.severity !== 'error' && issue.severity !== 'warning') return issue;
			if (!issue.fieldPath) return issue;

			const docIndex = resolveDocIndex(issue);
			const docYaml = extractDocumentYaml(yaml, docIndex);
			if (!docYaml) return issue;

			const { kind, group } = resolveIdentity(issue, docYaml);
			if (!kind || !group) return issue;

			const entry = findManifestEntry(options.manifest, kind, group);
			if (!entry?.name) return issue;
			const latest = getLatestVersion(entry);
			if (!latest) return issue;

			const schemaKey = schemaPath(options.releaseFolder, entry.name, latest);
			let specSchema = specSchemaByKey.get(schemaKey);
			if (specSchema === undefined) {
				const schemas = await fetchSchemas([schemaKey]);
				specSchema = schemas.get(schemaKey)?.spec ?? null;
				specSchemaByKey.set(schemaKey, specSchema);
			}
			if (!specSchema) return issue;

			const parsedDoc = loadDocData(docYaml);
			const specData = parsedDoc?.spec;

			const segments = issue.fieldPath.replace(/^spec\./, '').split('.').filter(Boolean);
			const parentSchema = schemaParentAtPath(specSchema, segments);
			const parentProps = parentSchema ? collectSchemaProperties(parentSchema) : null;
			const leafSchema = schemaAtYamlPath(specSchema, segments);

			const suggestedFix = deriveSuggestedFixForIssue(issue, parentProps, {
				specSchema,
				specData,
				leafSchema
			});
			if (!suggestedFix) return issue;
			return { ...issue, suggestedFix };
		})
	);
}

function loadDocData(yaml: string): Record<string, unknown> | null {
	const parsed = parseDocuments(yaml);
	if (!parsed.ok || parsed.docs.length === 0) return null;
	return parsed.docs[0].data as Record<string, unknown>;
}
