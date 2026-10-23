import { specSchemaAtPath } from '$lib/validate-bundle/schemaNavigation';

export { specSchemaAtPath };
import { validateAiFixApply, validateAiMigrationApply } from '$lib/validate-bundle/replaceDocument';
import type { BundleIssue } from '$lib/validate-bundle/types';
import { loadUserYaml } from '$lib/yaml/safeYaml';
import type { FixIssueContext } from './actionPrompts';

export type FixVerdict = { ok: true } | { ok: false; reason: string };

/** `spec.a.0.b`, `/spec/a/0/b` → ['spec', 'a', '0', 'b'] */
function pathSegments(fieldPath: string): string[] {
	return fieldPath
		.replace(/^\//, '')
		.replace(/\[(\d+)\]/g, '.$1')
		.split(/[./]/)
		.filter(Boolean);
}

const isIndex = (segment: string) => /^\d+$/.test(segment);

function valueAtPath(doc: unknown, segments: string[]): unknown {
	let current: unknown = doc;
	for (const segment of segments) {
		if (current === null || typeof current !== 'object') return undefined;
		current = Array.isArray(current)
			? isIndex(segment)
				? current[Number(segment)]
				: undefined
			: (current as Record<string, unknown>)[segment];
	}
	return current;
}

function schemaEnum(node: unknown): unknown[] | null {
	if (!node || typeof node !== 'object') return null;
	const values = (node as Record<string, unknown>).enum;
	return Array.isArray(values) && values.length > 0 ? values : null;
}

function schemaTypes(node: unknown): string[] {
	if (!node || typeof node !== 'object') return [];
	const o = node as Record<string, unknown>;
	if (o['x-kubernetes-int-or-string'] === true) return ['integer', 'string'];
	if (typeof o.type === 'string') return [o.type];
	if (Array.isArray(o.type)) return o.type.filter((t): t is string => typeof t === 'string');
	return [];
}

function matchesType(value: unknown, type: string): boolean {
	switch (type) {
		case 'string':
			return typeof value === 'string';
		case 'integer':
			return typeof value === 'number' && Number.isInteger(value);
		case 'number':
			return typeof value === 'number';
		case 'boolean':
			return typeof value === 'boolean';
		case 'array':
			return Array.isArray(value);
		case 'object':
			return value !== null && typeof value === 'object' && !Array.isArray(value);
		default:
			return true;
	}
}

/** Allowed values and types for the issue's field, taken from the CRD schema (not the client). */
export function schemaHintsForField(
	specSchema: unknown,
	fieldPath: string | undefined
): Pick<FixIssueContext, 'allowedValues' | 'expectedTypes'> {
	if (!specSchema || !fieldPath) return {};
	const node = specSchemaAtPath(specSchema, fieldPath);
	const values = schemaEnum(node);
	const types = schemaTypes(node);
	return {
		...(values ? { allowedValues: values.map(String) } : {}),
		...(types.length ? { expectedTypes: types } : {})
	};
}

function asGuardIssue(
	issue: FixIssueContext,
	index = 0
): Pick<BundleIssue, 'id' | 'fieldPath' | 'message' | 'suggestedFix'> {
	return {
		id: `ai-fix-${index}`,
		fieldPath: issue.fieldPath,
		message: issue.message,
		suggestedFix: issue.suggestedFix as BundleIssue['suggestedFix']
	};
}

/**
 * Server-side check of an AI fix before it is returned or cached: the minimal-edit guard used by
 * the client, plus a targeted check that the reported issue is actually resolved.
 */
export function verifyFix(params: {
	originalDoc: string;
	fixedDoc: string;
	issue: FixIssueContext;
	specSchema?: unknown;
}): FixVerdict {
	const { originalDoc, fixedDoc, issue, specSchema } = params;

	let fixed: unknown;
	try {
		fixed = loadUserYaml(fixedDoc);
	} catch {
		return { ok: false, reason: 'The fixed YAML does not parse.' };
	}
	if (!fixed || typeof fixed !== 'object' || Array.isArray(fixed)) {
		return { ok: false, reason: 'The fixed YAML is not a single YAML object.' };
	}

	const guard = validateAiFixApply(originalDoc, fixedDoc, asGuardIssue(issue));
	if (!guard.ok) return { ok: false, reason: guard.reason ?? 'The fix changed too much.' };

	if (!issue.fieldPath || issue.issueKind === 'syntax') return { ok: true };

	const segments = pathSegments(issue.fieldPath);
	const value = valueAtPath(fixed, segments);
	const node = specSchema ? specSchemaAtPath(specSchema, issue.fieldPath) : null;

	switch (issue.issueKind) {
		case 'enum': {
			const allowed = schemaEnum(node);
			if (allowed && !allowed.some((v) => v === value)) {
				return {
					ok: false,
					reason: `${issue.fieldPath} is ${JSON.stringify(value)}, which is not one of: ${allowed.join(', ')}.`
				};
			}
			return { ok: true };
		}
		case 'type': {
			const types = schemaTypes(node);
			if (value === null && (node as Record<string, unknown> | null)?.nullable === true) {
				return { ok: true };
			}
			if (types.length && !types.some((t) => matchesType(value, t))) {
				return {
					ok: false,
					reason: `${issue.fieldPath} must be of type ${types.join(' or ')}.`
				};
			}
			return { ok: true };
		}
		case 'required':
			return value === undefined
				? { ok: false, reason: `${issue.fieldPath} is still missing.` }
				: { ok: true };
		case 'unknownField':
		case 'misspelledField':
			return value !== undefined
				? { ok: false, reason: `${issue.fieldPath} is still present.` }
				: { ok: true };
		default:
			return { ok: true };
	}
}

/** Batched (migration) fixes: parse plus the client's migration guard. */
export function verifyMigrationFix(params: {
	originalDoc: string;
	fixedDoc: string;
	issues: FixIssueContext[];
}): FixVerdict {
	try {
		const fixed = loadUserYaml(params.fixedDoc);
		if (!fixed || typeof fixed !== 'object') {
			return { ok: false, reason: 'The fixed YAML is not a single YAML object.' };
		}
	} catch {
		return { ok: false, reason: 'The fixed YAML does not parse.' };
	}
	const guard = validateAiMigrationApply(
		params.originalDoc,
		params.fixedDoc,
		params.issues.map((issue, index) => asGuardIssue(issue, index))
	);
	return guard.ok
		? { ok: true }
		: { ok: false, reason: guard.reason ?? 'The fix changed too much.' };
}
