/**
 * Small, exact edits to one YAML document's text: set a scalar, delete a key with its block, or
 * add a key under an existing mapping. Line-based like the editor's quick fixes, so comments,
 * order and formatting elsewhere stay as the user wrote them. Each function returns null when it
 * can't place the edit safely (the caller then leaves the fix to the AI).
 */
import yaml from 'js-yaml';
import { findLineForYamlFieldPath } from '$lib/yaml-validation/yamlFieldPath';

const indentOf = (line: string) => line.length - line.trimStart().length;

/** A YAML scalar for `value`: plain when YAML reads it back as the same string, quoted otherwise. */
export function formatScalar(value: unknown): string {
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (value === null) return 'null';
	const s = String(value);
	let roundTrip: unknown;
	try {
		roundTrip = yaml.load(s);
	} catch {
		roundTrip = undefined;
	}
	const plainSafe = s !== '' && roundTrip === s && !/^[\s'"&*!|>%@`#,[\]{}-]|\s$|: | #/.test(s);
	return plainSafe ? s : JSON.stringify(s);
}

/** Last line of the block that starts at `line` (the line itself when nothing is nested). */
function blockEnd(lines: string[], line: number): number {
	const base = indentOf(lines[line]!);
	const isDash = lines[line]!.trimStart().startsWith('- ');
	let end = line;
	for (let i = line + 1; i < lines.length; i++) {
		const l = lines[i]!;
		if (!l.trim() || l.trimStart().startsWith('#')) continue;
		const ind = indentOf(l);
		if (ind > base || (isDash && ind > base)) end = i;
		else break;
	}
	return end;
}

/** Set the scalar at `fieldPath` (a `key: value` line or a `- value` list item). */
export function setScalarAt(doc: string, fieldPath: string, value: unknown): string | null {
	const lines = doc.split('\n');
	const index = findLineForYamlFieldPath(doc, fieldPath);
	if (index === undefined) return null;
	const line = lines[index]!;
	const leaf = fieldPath.split('.').pop()!;
	let next: string | null = null;
	if (/^\d+$/.test(leaf)) {
		const m = /^(\s*-\s+)([^#]*?)(\s+#.*)?$/.exec(line);
		if (m && !m[2]!.includes(': ')) next = `${m[1]}${formatScalar(value)}${m[3] ?? ''}`;
	} else {
		const m = /^(\s*(?:-\s+)?)([^:#\s][^:#]*?)(\s*:)(\s*)([^#]*?)(\s+#.*)?$/.exec(line);
		if (
			m &&
			m[2]!.trim().toLowerCase() === leaf.toLowerCase() &&
			m[5]!.trim() !== '' &&
			!/^[|>]/.test(m[5]!.trim())
		) {
			next = `${m[1]}${m[2]}${m[3]} ${formatScalar(value)}${m[6] ?? ''}`;
		}
	}
	if (next === null) return null;
	lines[index] = next;
	return lines.join('\n');
}

/** Delete the key at `fieldPath` and everything nested under it. */
export function deleteAt(doc: string, fieldPath: string): string | null {
	const lines = doc.split('\n');
	const index = findLineForYamlFieldPath(doc, fieldPath);
	if (index === undefined) return null;
	const line = lines[index]!;
	// A key on a list item's own `- ` line would take the item marker with it: leave to the AI.
	if (/^\s*-\s/.test(line)) return null;
	lines.splice(index, blockEnd(lines, index) - index + 1);
	return lines.join('\n');
}

/**
 * Add `key: value` under the mapping at `parentPath` (`spec`, `spec.macLearning`), including an
 * empty flow mapping (`localAS: {}`) and a list item (`spec.prefixes.0` on a `- exact: true` line).
 */
export function addUnder(
	doc: string,
	parentPath: string,
	key: string,
	value: unknown
): string | null {
	const lines = doc.split('\n');
	const index = findLineForYamlFieldPath(doc, parentPath);
	if (index === undefined) return null;
	const parent = lines[index]!;
	const entry = `${key}: ${formatScalar(value)}`;

	// A list item (`- exact: true`): add a sibling key at the item's key column.
	if (/^\d+$/.test(parentPath.split('.').pop() ?? '')) {
		const m = /^(\s*)-(\s+)/.exec(parent);
		if (!m) return null;
		const column = m[1]!.length + 1 + m[2]!.length;
		lines.splice(blockEnd(lines, index) + 1, 0, `${' '.repeat(column)}${entry}`);
		return lines.join('\n');
	}
	// `parent: {}`: becomes a block mapping with the new key.
	const flow = /^(\s*(?:-\s+)?[^:#]+:)\s*\{\s*\}\s*(#.*)?$/.exec(parent);
	if (flow) {
		lines[index] = `${flow[1]}${flow[2] ? ` ${flow[2]}` : ''}`;
		lines.splice(index + 1, 0, `${' '.repeat(indentOf(parent) + 2)}${entry}`);
		return lines.join('\n');
	}
	// `parent: value` on one line can't take a child line.
	if (!/:\s*(#.*)?$/.test(parent)) return null;
	const end = blockEnd(lines, index);
	const childIndent =
		end > index ? indentOf(lines[index + 1]!) : indentOf(parent) + (/^\s*-\s/.test(parent) ? 4 : 2);
	lines.splice(end + 1, 0, `${' '.repeat(childIndent)}${entry}`);
	return lines.join('\n');
}

/** Rename the key at `fieldPath` to `newKey`, keeping its value and everything under it. */
export function renameKeyAt(doc: string, fieldPath: string, newKey: string): string | null {
	const lines = doc.split('\n');
	const index = findLineForYamlFieldPath(doc, fieldPath);
	if (index === undefined) return null;
	const leaf = fieldPath.split('.').pop()!;
	const m = /^(\s*(?:-\s+)?)([^:#\s][^:#]*?)(\s*:.*)$/.exec(lines[index]!);
	if (!m || m[2]!.trim() !== leaf) return null;
	lines[index] = `${m[1]}${newKey}${m[3]}`;
	return lines.join('\n');
}
