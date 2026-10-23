import { findLineForPointerInDoc, parseDocuments } from '$lib/yaml-validation/parseDocuments';
import { findLineForYamlFieldPath } from '$lib/yaml-validation/yamlFieldPath';
import { loadUserYaml } from '$lib/yaml/safeYaml';
import yaml from 'js-yaml';
import { replaceDocumentInBundle } from './replaceDocument';
import { relocateFieldInData } from './yamlDataPaths';
import type { BundleIssue, SuggestedFix, SuggestedFixField } from './types';

function fieldToYamlKey(field: SuggestedFixField): string {
	if (field === 'metadata.name') return 'name';
	if (field === 'metadata.namespace') return 'namespace';
	return field;
}

function fieldToPointer(field: SuggestedFixField): string {
	if (field === 'metadata.name') return '/metadata/name';
	if (field === 'metadata.namespace') return '/metadata/namespace';
	return `/${field}`;
}

function fieldPathToPointer(fieldPath: string): string {
	const segments: string[] = [];
	for (const part of fieldPath.split('.')) {
		if (!part) continue;
		const match = part.match(/^([^[]+)(?:\[(\d+)\])?$/);
		if (!match?.[1]) continue;
		segments.push(match[1]);
		if (match[2] !== undefined) segments.push(match[2]);
	}
	return segments.length > 0 ? `/${segments.join('/')}` : '';
}

function formatYamlScalar(value: string): string {
	if (/[:#{}[\],&*!|>'"%@`]|^\s|-\s|\s-$/.test(value)) {
		return `'${value.replace(/'/g, "''")}'`;
	}
	return value;
}

function replaceLineValue(line: string, yamlKey: string, newValue: string): string | null {
	const escaped = yamlKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = line.match(new RegExp(`^(\\s*["']?${escaped}["']?\\s*:\\s*)(.+?)\\s*$`));
	if (!match) return null;
	return `${match[1]}${formatYamlScalar(newValue)}`;
}

function replaceLineKey(line: string, oldKey: string, newKey: string): string | null {
	const escaped = oldKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	// The key may be the first field of a list item: `  - oldKey: value`.
	const match = line.match(new RegExp(`^(\\s*(?:-\\s+)?)(["']?)(${escaped})\\2(\\s*:)(.*)$`));
	if (!match) return null;
	const [, indent, quote, , colon, rest] = match;
	return `${indent}${quote}${newKey}${quote}${colon}${rest}`;
}

function leafKeyFromFieldPath(fieldPath?: string): string | undefined {
	if (!fieldPath) return undefined;
	const segments = fieldPath.replace(/^\//, '').split('.').filter(Boolean);
	const last = segments[segments.length - 1];
	return last?.replace(/\[\d+\]$/, '') ?? last;
}

function parentFieldPath(fieldPath: string): string | undefined {
	const segments = fieldPath.replace(/^\//, '').split('.').filter(Boolean);
	if (segments.length <= 1) return undefined;
	return segments.slice(0, -1).join('.');
}

export function addFieldParentPath(issue: BundleIssue, fix: SuggestedFix): string | undefined {
	const fieldPath = issue.fieldPath?.replace(/^\//, '').replace(/\//g, '.');
	// "x is required" issues point at the object that lacks the field (`spec.items.0`), not at
	// the missing field itself; only strip the last segment when it is the field being added.
	if (fieldPath && fieldPath.split('.').pop() !== String(fix.field)) return fieldPath;
	return parentFieldPath(fieldPath ?? '') ?? parentFieldPath(`spec.${String(fix.field)}`);
}

function addFieldTargetPath(parentPath: string | undefined, field: string): string {
	return parentPath ? `${parentPath}.${field}` : `spec.${field}`;
}

/** Apply a structured fix to yamlInput, returning updated YAML or null when not applicable. */
/**
 * Line of the key a rename fix should change. The fix can hang off the misspelled key itself
 * (`spec.overlay`), off the missing field it should become (`spec.overlays` is required), or off
 * the parent object (`spec`); try each and only accept a line whose key really is `fromKey`.
 */
function findRenameKeyLine(
	docText: string,
	docLines: string[],
	fieldPath: string | undefined,
	fromKey: string,
	toKey: string
): number | undefined {
	if (!fieldPath) return undefined;
	const path = fieldPath.replace(/^\//, '').replace(/\//g, '.');
	const segments = path.split('.').filter(Boolean);
	const parent = segments.slice(0, -1).join('.');
	const candidates = [
		path,
		segments[segments.length - 1] === toKey && parent ? `${parent}.${fromKey}` : null,
		`${path}.${fromKey}`
	];
	for (const candidate of candidates) {
		if (!candidate) continue;
		const line = findLineForYamlFieldPath(docText, candidate);
		if (line === undefined) continue;
		const key = docLines[line]?.trim().replace(/^-\s*/, '').split(':')[0]?.trim();
		if (key === fromKey) return line;
	}
	return undefined;
}

export function applySuggestedFix(yamlInput: string, issue: BundleIssue): string | null {
	const fix = issue.suggestedFix;
	if (!fix) return null;

	const parsed = parseDocuments(yamlInput);
	if (!parsed.ok || parsed.docs.length === 0) return null;

	const docIndex = issue.docIndex ?? 1;
	const doc = parsed.docs[docIndex - 1];
	if (!doc) return null;

	const docLines = doc.rawText.split('\n');

	if (fix.action === 'relocateField') {
		const data = loadUserYaml(doc.rawText) as Record<string, unknown> | null;
		if (!data || typeof data !== 'object') return null;
		const fromPath = String(fix.field);
		const toPath = fix.value;
		if (!relocateFieldInData(data, fromPath, toPath)) return null;
		const dumped = yaml.dump(data, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false });
		return replaceDocumentInBundle(yamlInput, docIndex, dumped.trimEnd());
	}

	if (fix.action === 'addField') {
		const parentPath = addFieldParentPath(issue, fix);
		if (!parentPath) return null;

		const targetPath = addFieldTargetPath(parentPath, String(fix.field));
		if (findLineForYamlFieldPath(doc.rawText, targetPath) !== undefined) {
			return null;
		}

		const relParent = findLineForYamlFieldPath(doc.rawText, parentPath);
		if (relParent === undefined) return null;

		const parentLine = docLines[relParent];
		if (!parentLine) return null;

		const parentIndent = parentLine.match(/^(\s*)/)?.[1] ?? '';
		const childIndent = `${parentIndent}  `;
		const newLine = `${childIndent}${fix.field}: ${fix.value}`;
		docLines.splice(relParent + 1, 0, newLine);
		return replaceDocumentInBundle(yamlInput, docIndex, docLines.join('\n'));
	}

	let relLine: number | undefined;

	if (fix.action === 'renameKey') {
		relLine = findRenameKeyLine(doc.rawText, docLines, issue.fieldPath, String(fix.field), fix.value);
	} else if (issue.fieldPath) {
		relLine = findLineForYamlFieldPath(doc.rawText, issue.fieldPath);
	}

	if (relLine === undefined && fix.field && fix.action !== 'renameKey') {
		relLine = findLineForYamlFieldPath(doc.rawText, String(fix.field));
	}

	if (relLine === undefined && fix.line !== undefined) {
		relLine = fix.line - 1 - doc.startLine;
	} else if (relLine === undefined && issue.line !== undefined) {
		relLine = issue.line - 1 - doc.startLine;
	}

	if (relLine === undefined || relLine < 0 || relLine >= docLines.length) {
		if (fix.action === 'renameKey') {
			if (!issue.fieldPath) return null;
			const pointer = fieldPathToPointer(issue.fieldPath);
			if (!pointer) return null;
			relLine = findLineForPointerInDoc(doc.rawText, pointer);
		} else if (fix.action !== 'renameKey') {
			relLine = findLineForPointerInDoc(doc.rawText, fieldToPointer(fix.field as SuggestedFixField));
		}
	}

	if (relLine === undefined || relLine < 0 || relLine >= docLines.length) {
		return null;
	}

	let updated: string | null;
	if (fix.action === 'renameKey') {
		updated = replaceLineKey(docLines[relLine], String(fix.field), fix.value);
	} else {
		const yamlKey =
			leafKeyFromFieldPath(issue.fieldPath) ?? fieldToYamlKey(fix.field as SuggestedFixField);
		updated = replaceLineValue(docLines[relLine], yamlKey, fix.value);
	}

	if (!updated) return null;

	docLines[relLine] = updated;
	return replaceDocumentInBundle(yamlInput, docIndex, docLines.join('\n'));
}
