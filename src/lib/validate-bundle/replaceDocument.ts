import { parseDocuments } from '$lib/yaml-validation/parseDocuments';
import { loadUserYaml } from '$lib/yaml/safeYaml';
import { inferIssueKind } from './fixIssueContext';
import type { BundleIssue } from './types';

/** Split bundle text into per-document raw sections (works when YAML does not parse). */
export function splitRawDocuments(yamlInput: string): string[] {
	const trimmed = yamlInput.trim();
	if (!trimmed) return [];

	const sections: string[] = [];
	const lines = trimmed.split('\n');
	let current: string[] = [];

	for (const line of lines) {
		if (/^---\s*$/.test(line) && current.length > 0) {
			sections.push(current.join('\n'));
			current = [];
		} else if (/^---\s*$/.test(line) && current.length === 0) {
			continue;
		} else {
			current.push(line);
		}
	}

	if (current.some((l) => l.trim()) || sections.length === 0) {
		sections.push(current.join('\n'));
	}

	return sections.map((s) => s.trim()).filter(Boolean);
}

export function inferManifestIdentity(yaml: string): {
	kind?: string;
	apiVersion?: string;
	group?: string;
} {
	const kind = yaml.match(/^kind:\s*['"]?([^'"\n]+?)['"]?\s*$/m)?.[1]?.trim();
	const apiVersion = yaml.match(/^apiVersion:\s*['"]?([^'"\n]+?)['"]?\s*$/m)?.[1]?.trim();
	const group = apiVersion?.includes('/') ? apiVersion.split('/')[0] : undefined;
	return { kind, apiVersion, group };
}

export function isParseIssue(issue: Pick<BundleIssue, 'id' | 'message'>): boolean {
	return (
		!!issue.id?.startsWith('parse-') ||
		/yaml parsing error|syntax error|empty yaml/i.test(issue.message)
	);
}

/** Extract raw YAML for a single document (1-based docIndex). Works with broken YAML. */
export function extractDocumentYaml(yamlInput: string, docIndex: number): string | null {
	const parsed = parseDocuments(yamlInput);
	if (parsed.ok && docIndex >= 1 && docIndex <= parsed.docs.length) {
		return parsed.docs[docIndex - 1]?.rawText ?? null;
	}

	const sections = splitRawDocuments(yamlInput);
	if (docIndex < 1 || docIndex > sections.length) return null;
	return sections[docIndex - 1] ?? null;
}

/** Replace one document in a multi-doc bundle; returns null when splice is unsafe. */
export function replaceDocumentInBundle(
	yamlInput: string,
	docIndex: number,
	newDocYaml: string
): string | null {
	const trimmed = newDocYaml.trim();
	if (!trimmed) return null;

	const parsed = parseDocuments(yamlInput);
	if (parsed.ok && docIndex >= 1 && docIndex <= parsed.docs.length) {
		const parts = parsed.docs.map((doc, i) => (i === docIndex - 1 ? trimmed : doc.rawText));
		return parts.length === 1 ? parts[0]! : parts.join('\n---\n');
	}

	const sections = splitRawDocuments(yamlInput);
	if (docIndex < 1 || docIndex > sections.length) return null;

	const parts = sections.map((section, i) => (i === docIndex - 1 ? trimmed : section));
	return parts.length === 1 ? parts[0]! : parts.join('\n---\n');
}

function issueTouchesIdentity(issue: Pick<BundleIssue, 'fieldPath' | 'message'>): {
	kind: boolean;
	apiVersion: boolean;
} {
	const path = issue.fieldPath?.toLowerCase() ?? '';
	const msg = issue.message.toLowerCase();
	return {
		kind: path === 'kind' || /\bkind\b/.test(msg),
		apiVersion: path === 'apiversion' || /\bapiversion\b/.test(msg)
	};
}

type FieldPathSegment = string | number;

function parseFieldPath(fieldPath: string): FieldPathSegment[] {
	const segments: FieldPathSegment[] = [];
	for (const part of fieldPath.split('.')) {
		if (!part) continue;
		const match = part.match(/^([^[]+)(?:\[(\d+)\])?$/);
		if (!match?.[1]) continue;
		segments.push(match[1]);
		if (match[2] !== undefined) segments.push(Number(match[2]));
	}
	return segments;
}

function getValueAtPath(obj: unknown, segments: FieldPathSegment[]): unknown {
	let current: unknown = obj;
	for (const segment of segments) {
		if (current === null || current === undefined) return undefined;
		if (typeof segment === 'number') {
			if (!Array.isArray(current)) return undefined;
			current = current[segment];
			continue;
		}
		if (typeof current !== 'object' || Array.isArray(current)) return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

function deepEqualValues(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === null || b === null || a === undefined || b === undefined) return a === b;
	if (typeof a !== typeof b) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		return a.every((item, index) => deepEqualValues(item, b[index]));
	}
	if (typeof a === 'object' && typeof b === 'object') {
		const aRecord = a as Record<string, unknown>;
		const bRecord = b as Record<string, unknown>;
		const aKeys = Object.keys(aRecord);
		const bKeys = Object.keys(bRecord);
		if (aKeys.length !== bKeys.length) return false;
		return aKeys.every((key) => deepEqualValues(aRecord[key], bRecord[key]));
	}
	return false;
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
	if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

/** Reject AI output that leaves protocol/protocols on the wrong Fabric parent object. */
function validateFabricProtocolParentKeys(
	orig: Record<string, unknown>,
	fixed: Record<string, unknown>,
	issue: Pick<BundleIssue, 'fieldPath' | 'suggestedFix'>
): { ok: boolean; reason?: string } {
	if (!issue.fieldPath?.includes('Protocol')) return { ok: true };

	const checkParent = (
		parentKey: 'underlayProtocol' | 'overlayProtocol',
		wrongKey: string,
		correctKey: string
	): { ok: boolean; reason?: string } | null => {
		if (!issue.fieldPath!.includes(parentKey)) return null;

		const origParent = asObjectRecord(
			getValueAtPath(orig, ['spec', parentKey])
		);
		const fixedParent = asObjectRecord(
			getValueAtPath(fixed, ['spec', parentKey])
		);
		if (!origParent || !fixedParent) return { ok: true };

		const renameTarget =
			issue.suggestedFix?.action === 'renameKey' ? issue.suggestedFix.value : correctKey;

		if (wrongKey in fixedParent && !(wrongKey in origParent) && correctKey in origParent) {
			return {
				ok: false,
				reason: `AI fix must not rename ${parentKey}.${correctKey} to ${wrongKey}.`
			};
		}

		if (wrongKey in origParent && renameTarget === correctKey && wrongKey in fixedParent) {
			return {
				ok: false,
				reason: `${parentKey} must use "${correctKey}", not "${wrongKey}".`
			};
		}

		return null;
	};

	const underlay = checkParent('underlayProtocol', 'protocol', 'protocols');
	if (underlay && !underlay.ok) return underlay;

	const overlay = checkParent('overlayProtocol', 'protocols', 'protocol');
	if (overlay && !overlay.ok) return overlay;

	return { ok: true };
}

function isRenameOnlyIssue(
	issue: Pick<BundleIssue, 'message' | 'suggestedFix'>
): boolean {
	return (
		issue.suggestedFix?.action === 'renameKey' || issue.message.includes('Misspelled field')
	);
}

function validateRenameFixPreserveValues(
	orig: Record<string, unknown>,
	fixed: Record<string, unknown>,
	issue: Pick<BundleIssue, 'fieldPath' | 'suggestedFix'>
): { ok: boolean; reason?: string } {
	if (!issue.fieldPath) {
		return { ok: false, reason: 'Rename fix requires a field path.' };
	}

	const segments = parseFieldPath(issue.fieldPath);
	if (segments.length === 0) {
		return { ok: false, reason: 'Rename fix requires a valid field path.' };
	}

	const oldKey = String(issue.suggestedFix?.field ?? segments[segments.length - 1]);
	const newKey = issue.suggestedFix?.value;
	if (!newKey) {
		return { ok: false, reason: 'Rename fix requires a target key name.' };
	}

	const parentSegments = segments.slice(0, -1);
	const originalValue = getValueAtPath(orig, [...parentSegments, oldKey]);
	const renamedValue = getValueAtPath(fixed, [...parentSegments, newKey]);

	if (!deepEqualValues(originalValue, renamedValue)) {
		return {
			ok: false,
			reason:
				'Rename fix must preserve the exact value under the renamed key (no added/removed list items or changed values).'
		};
	}

	return { ok: true };
}

export type StructuralChangeKind = 'add' | 'remove' | 'modify';

export type StructuralChange = {
	path: string;
	kind: StructuralChangeKind;
};

/** Walk parsed YAML trees and collect structural differences. */
export function countStructuralDiff(
	original: unknown,
	fixed: unknown,
	path = ''
): StructuralChange[] {
	if (deepEqualValues(original, fixed)) return [];

	if (
		original === null ||
		original === undefined ||
		fixed === null ||
		fixed === undefined ||
		typeof original !== typeof fixed ||
		Array.isArray(original) !== Array.isArray(fixed)
	) {
		return [{ path: path || '(root)', kind: 'modify' }];
	}

	if (Array.isArray(original) && Array.isArray(fixed)) {
		const changes: StructuralChange[] = [];
		if (original.length !== fixed.length) {
			changes.push({ path: path || '(root)', kind: original.length < fixed.length ? 'add' : 'remove' });
		}
		const maxLen = Math.max(original.length, fixed.length);
		for (let i = 0; i < maxLen; i++) {
			changes.push(...countStructuralDiff(original[i], fixed[i], `${path}[${i}]`));
		}
		return changes;
	}

	if (typeof original === 'object' && typeof fixed === 'object') {
		const origRecord = original as Record<string, unknown>;
		const fixedRecord = fixed as Record<string, unknown>;
		const changes: StructuralChange[] = [];
		const allKeys = new Set([...Object.keys(origRecord), ...Object.keys(fixedRecord)]);

		for (const key of allKeys) {
			const childPath = path ? `${path}.${key}` : key;
			if (!(key in origRecord)) {
				changes.push({ path: childPath, kind: 'add' });
				continue;
			}
			if (!(key in fixedRecord)) {
				changes.push({ path: childPath, kind: 'remove' });
				continue;
			}
			changes.push(...countStructuralDiff(origRecord[key], fixedRecord[key], childPath));
		}
		return changes;
	}

	return [{ path: path || '(root)', kind: 'modify' }];
}

function pathMatchesOrUnder(path: string, prefix: string): boolean {
	return path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`);
}

function getRenamePaths(issue: Pick<BundleIssue, 'fieldPath' | 'suggestedFix'>): {
	oldPath: string;
	newPath: string;
} | null {
	if (!issue.fieldPath) return null;
	const segments = parseFieldPath(issue.fieldPath);
	if (segments.length === 0) return null;

	const oldKey = String(issue.suggestedFix?.field ?? segments[segments.length - 1]);
	const newKey = issue.suggestedFix?.value;
	if (!newKey) return null;

	const parentSegments = segments.slice(0, -1);
	const parentPath = parentSegments.map(String).join('.');
	return {
		oldPath: parentPath ? `${parentPath}.${oldKey}` : oldKey,
		newPath: parentPath ? `${parentPath}.${newKey}` : newKey
	};
}

function isRequiredFieldIssue(issue: Pick<BundleIssue, 'message'>): boolean {
	return /is required/i.test(issue.message);
}

function validateRenameStructuralChanges(
	changes: StructuralChange[],
	issue: Pick<BundleIssue, 'fieldPath' | 'suggestedFix'>
): { ok: boolean; reason?: string } {
	const paths = getRenamePaths(issue);
	if (!paths) {
		return { ok: false, reason: 'Rename fix requires a field path and target key name.' };
	}

	const { oldPath, newPath } = paths;
	const unexpected = changes.filter((change) => {
		if (change.kind === 'remove' && change.path === oldPath) return false;
		if (change.kind === 'add' && change.path === newPath) return false;
		return true;
	});

	if (unexpected.length > 0) {
		const first = unexpected[0]!;
		return {
			ok: false,
			reason: `Rename fix must not change structure at ${first.path} (${first.kind}).`
		};
	}

	return { ok: true };
}

function pathIsUnderSpec(path: string): boolean {
	return path === 'spec' || path.startsWith('spec.');
}

function pathTouchesProtectedTopLevel(path: string): boolean {
	return (
		path === 'metadata' ||
		path.startsWith('metadata.') ||
		path === 'status' ||
		path.startsWith('status.') ||
		path === 'apiVersion' ||
		path === 'kind'
	);
}

function allChangesInScope(changes: StructuralChange[], scopePrefix: string): boolean {
	if (!scopePrefix) return false;
	return changes.every(
		(change) => change.path === scopePrefix || pathMatchesOrUnder(change.path, scopePrefix)
	);
}

function validateMinimalStructuralChanges(
	changes: StructuralChange[],
	issue: Pick<BundleIssue, 'fieldPath' | 'message' | 'suggestedFix'>
): { ok: boolean; reason?: string } {
	if (changes.length === 0) return { ok: true };

	const fieldPath = issue.fieldPath;
	if (!fieldPath) {
		return {
			ok: false,
			reason: 'AI fix changed document structure but no field path was provided for the issue.'
		};
	}

	const issueKind = inferIssueKind(issue as BundleIssue);
	const isRequired = issueKind === 'required' || isRequiredFieldIssue(issue);

	for (const change of changes) {
		if (isRequired) {
			if (change.kind === 'add' && change.path === fieldPath) continue;
			if (change.kind === 'modify' && pathMatchesOrUnder(change.path, fieldPath)) continue;
			return {
				ok: false,
				reason: `Required-field fix must only add the missing field at ${fieldPath}, not change ${change.path}.`
			};
		}

		if (issueKind === 'unknownField') {
			if (pathTouchesProtectedTopLevel(change.path)) {
				return {
					ok: false,
					reason: `Unknown-field fix must not change ${change.path}.`
				};
			}
			if (!pathIsUnderSpec(change.path)) {
				return {
					ok: false,
					reason: `Unknown-field fix must stay within spec, not change ${change.path} (${change.kind}).`
				};
			}
			continue;
		}

		if (issueKind === 'type') {
			if (pathMatchesOrUnder(change.path, fieldPath) || change.path === fieldPath) continue;
			return {
				ok: false,
				reason: `Type fix must only change structure under ${fieldPath}, not ${change.path} (${change.kind}).`
			};
		}

		if (issueKind === 'enum') {
			if (change.kind === 'modify' && change.path === fieldPath) continue;
			return {
				ok: false,
				reason: `AI fix must only change the value at ${fieldPath}, not ${change.path} (${change.kind}).`
			};
		}

		if (change.path !== fieldPath && !pathMatchesOrUnder(change.path, fieldPath)) {
			return {
				ok: false,
				reason: `AI fix changed unrelated structure at ${change.path} (${change.kind}).`
			};
		}

		if (change.kind === 'add') {
			return {
				ok: false,
				reason: `AI fix must not add keys or list items at ${change.path}.`
			};
		}
		if (change.kind === 'remove') {
			return {
				ok: false,
				reason: `AI fix must not remove keys or list items at ${change.path}.`
			};
		}
		if (change.kind === 'modify' && change.path !== fieldPath) {
			return {
				ok: false,
				reason: `AI fix must not modify values at ${change.path}.`
			};
		}
	}

	return { ok: true };
}

const MAX_UNRELATED_LINE_DELTA = 6;
const MAX_SCOPED_TYPE_LINE_DELTA = 25;
const MAX_SCOPED_UNKNOWN_FIELD_LINE_DELTA = 40;

function maxAllowedLineDelta(
	issue: Pick<BundleIssue, 'fieldPath' | 'message' | 'suggestedFix'>,
	structuralChanges: StructuralChange[]
): number {
	const issueKind = inferIssueKind(issue as BundleIssue);
	if (issueKind === 'unknownField' && allChangesInScope(structuralChanges, 'spec')) {
		return MAX_SCOPED_UNKNOWN_FIELD_LINE_DELTA;
	}
	if (issueKind === 'type' && issue.fieldPath && allChangesInScope(structuralChanges, issue.fieldPath)) {
		return MAX_SCOPED_TYPE_LINE_DELTA;
	}
	return MAX_UNRELATED_LINE_DELTA;
}

function countSignificantLineDelta(originalYaml: string, fixedYaml: string): number {
	const origLines = originalYaml.split('\n');
	const fixedLines = fixedYaml.split('\n');
	const maxLen = Math.max(origLines.length, fixedLines.length);
	let delta = 0;
	for (let i = 0; i < maxLen; i++) {
		if ((origLines[i] ?? '') !== (fixedLines[i] ?? '')) delta += 1;
	}
	return delta;
}

/** Guardrails before applying AI-fixed YAML into the editor. */
export function validateAiFixApply(
	originalYaml: string,
	fixedYaml: string,
	issue: Pick<BundleIssue, 'id' | 'fieldPath' | 'message' | 'suggestedFix'>
): { ok: boolean; reason?: string } {
	try {
		const fixed = loadUserYaml(fixedYaml) as Record<string, unknown> | null;
		if (!fixed || typeof fixed !== 'object') {
			return { ok: false, reason: 'Fixed YAML did not parse as a valid document.' };
		}

		if (isParseIssue(issue)) {
			return { ok: true };
		}

		const orig = loadUserYaml(originalYaml) as Record<string, unknown> | null;
		if (!orig || typeof orig !== 'object') {
			return { ok: false, reason: 'Original document could not be parsed.' };
		}

		const identity = issueTouchesIdentity(issue);
		if (!identity.kind && orig.kind !== fixed.kind) {
			return { ok: false, reason: 'kind must not change for this issue.' };
		}
		if (!identity.apiVersion && orig.apiVersion !== fixed.apiVersion) {
			return { ok: false, reason: 'apiVersion must not change for this issue.' };
		}

		const structuralChanges = countStructuralDiff(orig, fixed);

		if (isRenameOnlyIssue(issue)) {
			const renameStructure = validateRenameStructuralChanges(structuralChanges, issue);
			if (!renameStructure.ok) return renameStructure;
			const protocolParent = validateFabricProtocolParentKeys(orig, fixed, issue);
			if (!protocolParent.ok) return protocolParent;
			return validateRenameFixPreserveValues(orig, fixed, issue);
		}

		const protocolParent = validateFabricProtocolParentKeys(orig, fixed, issue);
		if (!protocolParent.ok) return protocolParent;

		const minimalStructure = validateMinimalStructuralChanges(structuralChanges, issue);
		if (!minimalStructure.ok) return minimalStructure;

		const issueKind = inferIssueKind(issue as BundleIssue);
		const structuralScope =
			issueKind === 'unknownField'
				? 'spec'
				: issueKind === 'type' && issue.fieldPath
					? issue.fieldPath
					: null;
		const skipLineDeltaCheck =
			structuralScope !== null && allChangesInScope(structuralChanges, structuralScope);

		if (!skipLineDeltaCheck) {
			const lineDelta = countSignificantLineDelta(originalYaml, fixedYaml);
			const allowedLineDelta = maxAllowedLineDelta(issue, structuralChanges);
			if (lineDelta > allowedLineDelta) {
				return {
					ok: false,
					reason: `AI fix changed too many lines (${lineDelta}); only minimal edits are allowed (max ${allowedLineDelta}).`
				};
			}
		}

		return { ok: true };
	} catch {
		return { ok: false, reason: 'Could not parse fixed YAML.' };
	}
}

const MAX_MIGRATION_LINE_DELTA = 80;

/** Guardrails for batched migration AI fixes (multi-issue, spec-scoped structural changes). */
export function validateAiMigrationApply(
	originalYaml: string,
	fixedYaml: string,
	issues: Pick<BundleIssue, 'id' | 'fieldPath' | 'message' | 'suggestedFix'>[]
): { ok: boolean; reason?: string } {
	if (issues.length === 0) {
		return { ok: false, reason: 'Migration validation requires at least one issue.' };
	}

	try {
		const fixed = loadUserYaml(fixedYaml) as Record<string, unknown> | null;
		if (!fixed || typeof fixed !== 'object') {
			return { ok: false, reason: 'Fixed YAML did not parse as a valid document.' };
		}

		const orig = loadUserYaml(originalYaml) as Record<string, unknown> | null;
		if (!orig || typeof orig !== 'object') {
			return { ok: false, reason: 'Original document could not be parsed.' };
		}

		const allowApiVersionChange = issues.some((i) => /deprecated for kind/i.test(i.message));
		if (!allowApiVersionChange && orig.apiVersion !== fixed.apiVersion) {
			return { ok: false, reason: 'apiVersion must not change for this migration batch.' };
		}
		if (orig.kind !== fixed.kind) {
			return { ok: false, reason: 'kind must not change for migration fix.' };
		}

		const origMeta = asObjectRecord(orig.metadata);
		const fixedMeta = asObjectRecord(fixed.metadata);
		if (origMeta?.name !== fixedMeta?.name || origMeta?.namespace !== fixedMeta?.namespace) {
			return { ok: false, reason: 'metadata.name and metadata.namespace must be preserved.' };
		}

		const structuralChanges = countStructuralDiff(orig, fixed);
		for (const change of structuralChanges) {
			if (change.path === 'apiVersion' && allowApiVersionChange) continue;
			if (change.path === 'spec' || pathIsUnderSpec(change.path)) continue;
			return {
				ok: false,
				reason: `Migration fix must stay within spec (and apiVersion when upgrading), not ${change.path}.`
			};
		}

		const lineDelta = countSignificantLineDelta(originalYaml, fixedYaml);
		if (lineDelta > MAX_MIGRATION_LINE_DELTA) {
			return {
				ok: false,
				reason: `Migration fix changed too many lines (${lineDelta}); max ${MAX_MIGRATION_LINE_DELTA}.`
			};
		}

		return { ok: true };
	} catch {
		return { ok: false, reason: 'Could not parse fixed YAML.' };
	}
}
