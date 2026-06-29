import { findManifestEntry } from '$lib/manifest/lookup';
import { getLatestVersion } from '$lib/versions';
import { loadUserYaml } from '$lib/yaml/safeYaml';
import type { FixIssueContext } from '$lib/ai/actionPrompts';
import { fetchSchemas, schemaPath } from '$lib/yaml-validation/schemaCache';
import type { ManifestEntry } from '$lib/yaml-validation/types';
import {
	collectSchemaProperties,
	fabricProtocolParentHint,
	findSimilarSchemaProperty,
	schemaAtYamlPath,
	schemaParentAtPath
} from './schemaNavigation';
import {
	collectSchemaConstraints
} from './schemaSuggestedFix';
import type { BundleIssue } from './types';

export function inferIssueKind(issue: BundleIssue): FixIssueContext['issueKind'] {
	if (issue.message.toLowerCase().includes('syntax') || issue.category === 'schema' && !issue.fieldPath && issue.line) {
		const lower = issue.message.toLowerCase();
		if (lower.includes('yaml') || lower.includes('parse') || lower.includes('indent')) {
			return 'syntax';
		}
	}
	if (issue.suggestedFix?.action === 'renameKey' || issue.message.includes('Misspelled field')) {
		return 'misspelledField';
	}
	if (issue.suggestedFix?.action === 'relocateField' || /relocate to/i.test(issue.message)) {
		return 'unknownField';
	}
	if (issue.message.includes('Unknown field')) return 'unknownField';
	if (issue.message.includes('exact case') || issue.message.includes('must be one of')) {
		return 'enum';
	}
	if (issue.message.includes('is required')) return 'required';
	const lower = issue.message.toLowerCase();
	if (/must be (object|array|string|boolean|integer|number)/.test(lower)) return 'type';
	if (lower.includes('type')) return 'type';
	return 'other';
}

function fieldPathToSpecSegments(fieldPath?: string): string[] {
	if (!fieldPath) return [];
	return fieldPath
		.replace(/^spec\./, '')
		.split('.')
		.filter(Boolean);
}

function asSpecRecord(value: unknown): Record<string, unknown> | null {
	if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function specParentData(docYaml: string | undefined, fieldPath?: string): Record<string, unknown> | null {
	if (!docYaml || !fieldPath?.startsWith('spec.')) return null;
	const parsed = loadUserYaml(docYaml) as Record<string, unknown> | null;
	const spec = asSpecRecord(parsed?.spec);
	if (!spec) return null;
	const segments = fieldPath.replace(/^spec\./, '').split('.').filter(Boolean);
	if (segments.length <= 1) return spec;
	let current: unknown = spec;
	for (const segment of segments.slice(0, -1)) {
		if (current === null || current === undefined || typeof current !== 'object' || Array.isArray(current)) {
			return null;
		}
		current = (current as Record<string, unknown>)[segment];
	}
	return asSpecRecord(current);
}

export async function buildFixIssueContext(
	issue: BundleIssue,
	options: {
		releaseFolder: string;
		manifest: ManifestEntry[];
		kind?: string;
		group?: string;
		docYaml?: string;
		relatedIssues?: string[];
	}
): Promise<FixIssueContext> {
	const context: FixIssueContext = {
		message: issue.message,
		fieldPath: issue.fieldPath,
		line: issue.line,
		severity: issue.severity,
		issueKind: inferIssueKind(issue),
		relatedIssues: options.relatedIssues
	};

	if (issue.suggestedFix?.action === 'renameKey') {
		context.issueKind = 'misspelledField';
		context.deterministicFixAvailable = true;
		context.renameHint = {
			from: String(issue.suggestedFix.field),
			to: issue.suggestedFix.value
		};
	} else if (issue.suggestedFix?.action === 'relocateField') {
		context.issueKind = 'unknownField';
		context.deterministicFixAvailable = true;
		context.relocationHint = {
			from: String(issue.suggestedFix.field),
			to: issue.suggestedFix.value
		};
	} else if (issue.suggestedFix) {
		context.deterministicFixAvailable = true;
		context.suggestedFix = {
			action: issue.suggestedFix.action,
			field: String(issue.suggestedFix.field),
			value: issue.suggestedFix.value
		};
	}

	const kind = options.kind ?? issue.resourceKind;
	if (!kind) return context;

	const group = options.group;
	const entry = group
		? findManifestEntry(options.manifest, kind, group)
		: options.manifest.find((m) => m.kind === kind);
	if (!entry?.name || !entry.group) return context;

	const latest = getLatestVersion(entry);
	if (!latest) return context;

	const schemas = await fetchSchemas([schemaPath(options.releaseFolder, entry.name, latest)]);
	const sections = schemas.get(schemaPath(options.releaseFolder, entry.name, latest));
	if (!sections?.spec) return context;

	const specSegments = fieldPathToSpecSegments(issue.fieldPath);
	const parentSchema = schemaParentAtPath(sections.spec, specSegments);
	const leafSchema = schemaAtYamlPath(sections.spec, specSegments);

	const parentProps = parentSchema ? collectSchemaProperties(parentSchema) : null;
	if (parentProps && parentProps.size > 0) {
		context.allowedSiblingKeys = [...parentProps].sort();
	}

	if (!context.renameHint && issue.message.includes('Unknown field') && issue.fieldPath && parentProps) {
		const leafKey = specSegments[specSegments.length - 1];
		if (leafKey) {
			const parentSegment =
				specSegments.length >= 2 ? specSegments[specSegments.length - 2] : undefined;
			const parentData = specParentData(options.docYaml, issue.fieldPath);
			const similar = findSimilarSchemaProperty(
				leafKey,
				parentProps,
				parentSegment,
				parentData ?? undefined
			);
			if (similar) {
				context.issueKind = 'misspelledField';
				context.deterministicFixAvailable = true;
				context.renameHint = { from: leafKey, to: similar };
			}
		}
	}

	const parentSegment =
		specSegments.length >= 2 ? specSegments[specSegments.length - 2] : specSegments[0];
	const protocolHint = fabricProtocolParentHint(parentSegment);
	if (protocolHint) {
		context.parentPathContext = protocolHint;
	}

	if (leafSchema) {
		const { types, enumValues, constValue } = collectSchemaConstraints(leafSchema);
		if (types.length > 0) context.expectedTypes = types;
		const allowed = enumValues.length > 0 ? enumValues : constValue !== undefined ? [constValue] : [];
		if (allowed.length > 0) {
			context.allowedValues = allowed.map(String);
		}
	}

	if (issue.message.includes('deprecated for kind')) {
		context.migrationContext =
			'Upgrade to the latest non-deprecated apiVersion and reshape spec fields per the target schema (e.g. macLearning object, VXLAN fields under encapOptions.vxlan).';
	}

	const relocateMatch = issue.message.match(/relocate to "(.*?)"/i);
	if (relocateMatch?.[1] && issue.fieldPath && !context.relocationHint) {
		context.relocationHint = { from: issue.fieldPath, to: relocateMatch[1] };
	}

	return context;
}
