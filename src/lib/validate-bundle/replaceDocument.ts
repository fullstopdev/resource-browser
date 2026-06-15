import { parseDocuments } from '$lib/yaml-validation/parseDocuments';
import { loadUserYaml } from '$lib/yaml/safeYaml';
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

/** Guardrails before applying AI-fixed YAML into the editor. */
export function validateAiFixApply(
	originalYaml: string,
	fixedYaml: string,
	issue: Pick<BundleIssue, 'id' | 'fieldPath' | 'message'>
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
		return { ok: true };
	} catch {
		return { ok: false, reason: 'Could not parse fixed YAML.' };
	}
}
