/**
 * Fixes that need no model: the schema already says the answer. Tried on the server before any
 * Workers AI call, so these cost no neurons. Every result still goes through verifyFix (the same
 * check as AI answers) before it is returned.
 *
 * - enum: the allowed value with matching case or spelling (`SRL` → `srl`, `evpn-vxlan` → `EVPNVXLAN`)
 * - type: quoted numbers and booleans (`"9000"` → 9000, `"yes"` → true, `AS100` → 100)
 * - unknown field: remove it with its block
 * - required: add the field when the schema gives a default or a single allowed value
 */
import { findUniqueFuzzyEnumMatch } from '$lib/validate-bundle/schemaSuggestedFix';
import { loadUserYaml } from '$lib/yaml/safeYaml';
import type { FixIssueContext } from './actionPrompts';
import { pathSegments, schemaEnum, schemaTypes, specSchemaAtPath, valueAtPath } from './verifyFix';
import { addUnder, deleteAt, renameKeyAt, setScalarAt } from './yamlLineEdit';

export type RuleFix = {
	fixedDoc: string;
	explanation: string;
	/** The rename, for the minimal-edit check (it accepts a rename only when told what it is). */
	suggestedFix?: FixIssueContext['suggestedFix'];
};

const TRUE_WORDS = new Set(['true', 'yes', 'y', 'on', 'enabled', 'enable']);
const FALSE_WORDS = new Set(['false', 'no', 'n', 'off', 'disabled', 'disable']);

/** `evpn-vxlan` and `EVPNVXLAN` compare equal. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function enumMatch(value: unknown, allowed: unknown[]): unknown | undefined {
	if (typeof value !== 'string') return undefined;
	const fuzzy = findUniqueFuzzyEnumMatch(value, allowed);
	if (fuzzy !== null) return fuzzy;
	const target = squash(value);
	const exact = allowed.filter((a) => typeof a === 'string' && squash(a) === target);
	if (exact.length === 1) return exact[0];
	// One allowed value that contains, or is contained in, what was written: `Global` →
	// `GlobalPool`, `VXLAN` → `EVPNVXLAN`, `SR Linux` → `srl`. Two or more: leave it to the AI.
	if (target.length < 3) return undefined;
	const partial = allowed.filter((a) => {
		if (typeof a !== 'string') return false;
		const c = squash(a);
		return c.length >= 3 && (c.includes(target) || target.startsWith(c));
	});
	return partial.length === 1 ? partial[0] : undefined;
}

function coerce(value: unknown, types: string[], field: string): unknown | undefined {
	if (typeof value === 'string') {
		const s = value.trim();
		if (types.includes('integer') || types.includes('number')) {
			if (/^-?\d+$/.test(s)) return Number(s);
			if (types.includes('number') && /^-?\d+\.\d+$/.test(s)) return Number(s);
			// AS numbers written as `AS65000`.
			if (/autonomoussystem|asn$/i.test(field) && /^as\d+$/i.test(s)) return Number(s.slice(2));
			// `300s` on a field measured in seconds.
			if (/seconds$/i.test(field) && /^\d+\s*s(ec(onds?)?)?$/i.test(s)) return parseInt(s, 10);
		}
		if (types.includes('boolean')) {
			if (TRUE_WORDS.has(s.toLowerCase())) return true;
			if (FALSE_WORDS.has(s.toLowerCase())) return false;
		}
	}
	if ((typeof value === 'number' || typeof value === 'boolean') && types.includes('string')) {
		return String(value);
	}
	return undefined;
}

const indentOf = (line: string) => line.length - line.trimStart().length;

/** The 0-based line js-yaml reports for a parse error, or null when the document parses. */
function syntaxErrorLine(doc: string): number | null {
	try {
		loadUserYaml(doc);
		return null;
	} catch (err) {
		const line = (err as { mark?: { line?: number } }).mark?.line;
		return typeof line === 'number' ? line : -1;
	}
}

/**
 * The two most common YAML slips, each a one-line change: a missing colon (`enabled true`) and a
 * line indented differently from its siblings. Accepted only if the document then parses.
 */
function trySyntaxFix(doc: string): RuleFix | null {
	const errorLine = syntaxErrorLine(doc);
	if (errorLine === null || errorLine < 0) return null;
	const lines = doc.split('\n');
	// js-yaml often reports the line after the faulty one.
	for (const i of [errorLine, errorLine - 1].filter((n) => n >= 0 && n < lines.length)) {
		const line = lines[i]!;
		const candidates: Array<[string, string]> = [];
		const noColon = /^(\s*(?:-\s+)?)([A-Za-z_][\w.-]*)\s+([^\s:#][^:]*)$/.exec(line);
		if (noColon) {
			candidates.push([
				`${noColon[1]}${noColon[2]}: ${noColon[3]}`,
				`Added the missing colon after "${noColon[2]}" on line ${i + 1}.`
			]);
		}
		const prev = lines
			.slice(0, i)
			.reverse()
			.find((l) => l.trim() && !l.trimStart().startsWith('#'));
		if (prev !== undefined && !/:\s*(#.*)?$/.test(prev) && indentOf(prev) !== indentOf(line)) {
			candidates.push([
				`${' '.repeat(indentOf(prev))}${line.trimStart()}`,
				`Aligned line ${i + 1} with the line above it.`
			]);
		}
		for (const [replacement, explanation] of candidates) {
			const next = [...lines];
			next[i] = replacement;
			const fixedDoc = next.join('\n');
			if (syntaxErrorLine(fixedDoc) === null) return { fixedDoc, explanation };
		}
	}
	return null;
}

/** A rule-based fix for the issue, or null when the answer isn't certain. */
export function tryRuleFix(
	doc: string,
	issue: FixIssueContext,
	specSchema: unknown
): RuleFix | null {
	if (issue.issueKind === 'syntax') return trySyntaxFix(doc);
	const path = issue.fieldPath;
	if (!path || !specSchema || !path.startsWith('spec')) return null;
	let data: unknown;
	try {
		data = loadUserYaml(doc);
	} catch {
		return null;
	}
	const segments = pathSegments(path);
	const value = valueAtPath(data, segments);
	const node = specSchemaAtPath(specSchema, path);
	const leaf = segments[segments.length - 1] ?? '';

	switch (issue.issueKind) {
		case 'enum': {
			const allowed = schemaEnum(node);
			const match = allowed ? enumMatch(value, allowed) : undefined;
			if (match === undefined || match === value) return null;
			const fixedDoc = setScalarAt(doc, path, match);
			return fixedDoc
				? {
						fixedDoc,
						explanation: `Changed ${path} from ${JSON.stringify(value)} to ${JSON.stringify(match)}, the allowed value it matches.`
					}
				: null;
		}
		case 'type': {
			const types = schemaTypes(node);
			const next = types.length ? coerce(value, types, leaf) : undefined;
			if (next === undefined) return null;
			const fixedDoc = setScalarAt(doc, path, next);
			return fixedDoc
				? {
						fixedDoc,
						explanation: `Changed ${path} from ${JSON.stringify(value)} to ${JSON.stringify(next)} (${types.join(' or ')}).`
					}
				: null;
		}
		case 'misspelledField':
		case 'unknownField': {
			if (value === undefined) return null;
			// "Misspelled field "spec.spine" — use "spec.spines"": rename, keeping the value.
			const rename = /Misspelled field "([^"]+)"\s*[—-]+\s*use "([^"]+)"/.exec(issue.message);
			if (rename && rename[1] === path) {
				const newKey = rename[2]!.split('.').pop()!;
				const renamed = renameKeyAt(doc, path, newKey);
				if (renamed) {
					return {
						fixedDoc: renamed,
						explanation: `Renamed ${leaf} to ${newKey}, the field the schema defines.`,
						suggestedFix: { action: 'renameKey', field: leaf, value: newKey }
					};
				}
			}
			const fixedDoc = deleteAt(doc, path);
			return fixedDoc
				? { fixedDoc, explanation: `Removed ${path}: the ${leaf} field isn't in the schema.` }
				: null;
		}
		case 'required': {
			// The validator reports the parent ("spec") and names the field in the message.
			const named = /([A-Za-z0-9_.]+) is required/.exec(issue.message)?.[1];
			const fieldPath = named && named.startsWith(path) ? named : path;
			const fieldSegments = pathSegments(fieldPath);
			const parentPath = fieldSegments.slice(0, -1).join('.');
			const key = fieldSegments[fieldSegments.length - 1]!;
			const fieldNode = specSchemaAtPath(specSchema, fieldPath) as Record<string, unknown> | null;
			const allowed = schemaEnum(fieldNode);
			const fill =
				fieldNode?.default !== undefined
					? fieldNode.default
					: allowed?.length === 1
						? allowed[0]
						: undefined;
			if (fill === undefined || typeof fill === 'object') return null;
			if (valueAtPath(data, pathSegments(parentPath)) === undefined) return null;
			const fixedDoc = addUnder(doc, parentPath, key, fill);
			return fixedDoc
				? {
						fixedDoc,
						explanation: `Added ${fieldPath}: ${JSON.stringify(fill)}, the schema's ${fieldNode?.default !== undefined ? 'default' : 'only allowed value'}.`
					}
				: null;
		}
		default:
			return null;
	}
}
