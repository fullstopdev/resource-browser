/**
 * The one-line answer format of promptFixPatch:
 *
 *   FIXABLE: yes
 *   EXPLANATION: Changed the speed to an allowed value.
 *   CHANGE: SET spec.links.0.speed = 25G        (or: DELETE spec.foo)
 *
 * The server applies the change to the user's document itself (yamlLineEdit), so the model never
 * has to echo the manifest back.
 */
import yaml from 'js-yaml';
import type { ParsedFixResponse } from './parseFixResponse';
import { addUnder, deleteAt, setScalarAt } from './yamlLineEdit';
import { pathSegments, valueAtPath } from './verifyFix';
import { loadUserYaml } from '$lib/yaml/safeYaml';

export type FixPatch = { op: 'set'; path: string; value: unknown } | { op: 'delete'; path: string };

function field(answer: string, name: string): string | undefined {
	const m = new RegExp(`^\\s*\\**${name}\\**\\s*:\\s*(.*)$`, 'im').exec(answer);
	return m?.[1]?.trim();
}

export function parseFixPatch(answer: string): {
	fixable: boolean;
	explanation: string;
	patch?: FixPatch;
} {
	const fixable = /^yes\b/i.test(field(answer, 'FIXABLE') ?? '');
	const explanation = field(answer, 'EXPLANATION') ?? '';
	const change = (field(answer, 'CHANGE') ?? '').replace(/^`+|`+$/g, '').trim();
	const set = /^SET\s+([\w.[\]-]+)\s*=\s*(.+)$/i.exec(change);
	if (set) {
		let value: unknown;
		try {
			value = yaml.load(set[2]!.trim());
		} catch {
			value = set[2]!.trim();
		}
		if (value === undefined || (typeof value === 'object' && value !== null)) {
			return { fixable: false, explanation };
		}
		return {
			fixable,
			explanation,
			patch: { op: 'set', path: set[1]!.replace(/\[(\d+)\]/g, '.$1'), value }
		};
	}
	const del = /^DELETE\s+([\w.[\]-]+)$/i.exec(change);
	if (del)
		return {
			fixable,
			explanation,
			patch: { op: 'delete', path: del[1]!.replace(/\[(\d+)\]/g, '.$1') }
		};
	return { fixable: false, explanation };
}

/** The document with the change applied, or null when the change can't be placed. */
export function applyFixPatch(doc: string, patch: FixPatch): string | null {
	if (patch.op === 'delete') return deleteAt(doc, patch.path);
	let data: unknown;
	try {
		data = loadUserYaml(doc);
	} catch {
		return null;
	}
	const segments = pathSegments(patch.path);
	const current = valueAtPath(data, segments);
	// Never overwrite a block (object or list) with a scalar.
	if (current !== null && typeof current === 'object') return null;
	if (current !== undefined) return setScalarAt(doc, patch.path, patch.value);
	// A missing field: add it under its parent mapping.
	const parent = segments.slice(0, -1).join('.');
	const parentValue = valueAtPath(data, segments.slice(0, -1));
	if (!parentValue || typeof parentValue !== 'object' || Array.isArray(parentValue)) return null;
	// addUnder handles `parent: {}` and list items too.
	return addUnder(doc, parent, segments[segments.length - 1]!, patch.value);
}

/** Turn a one-line answer into the shape runVerifiedFix checks (full fixed document). */
export function parsePatchAnswer(answer: string, doc: string): ParsedFixResponse {
	const parsed = parseFixPatch(answer);
	if (!parsed.fixable || !parsed.patch) {
		return { fixable: parsed.fixable, explanation: parsed.explanation };
	}
	const fixedYaml = applyFixPatch(doc, parsed.patch);
	return { fixable: true, explanation: parsed.explanation, ...(fixedYaml ? { fixedYaml } : {}) };
}
