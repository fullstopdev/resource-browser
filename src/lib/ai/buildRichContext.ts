import releasesYaml from '$lib/releases.yaml?raw';
import { loadStaticYaml } from '$lib/yaml/safeYaml';
import { fetchManifest } from '$lib/manifest/fetch';
import { findManifestEntry, findManifestEntriesByGroup } from '$lib/manifest/lookup';
import { getLatestVersion } from '$lib/versions';
import { getRequiredFields, resolveObjectSchema } from '$lib/schema/requiredFields';
import {
	assertSafeFolderPath,
	fetchSchema,
	schemaPath,
	type SchemaSections
} from '$lib/yaml-validation/schemaCache';
import type { ReleasesConfig } from '$lib/structure';
import { assembleContext, trimToBudget } from './tokenBudget';

export interface BuildRichContextInput {
	release: string;
	kind: string;
	group: string;
	version?: string;
	fieldPath?: string;
	question?: string;
}

export interface BuildRichContextResult {
	context: string;
	resourceName: string;
	releaseFolder: string;
	apiVersion: string;
	version: string;
}

const releasesConfig = loadStaticYaml(releasesYaml) as ReleasesConfig;

export function resolveReleaseFolder(releaseName: string): string | null {
	const entry = releasesConfig.releases.find(
		(r) => r.name === releaseName || r.label === releaseName
	);
	return entry?.folder ?? null;
}

function navigateSchema(schema: unknown, fieldPath: string): unknown {
	if (!fieldPath) return schema;
	const parts = fieldPath.replace(/^\//, '').split(/[.[\]]+/).filter(Boolean);
	let current: unknown = schema;
	for (const part of parts) {
		if (part === 'spec' || part === 'status') {
			const resolved = resolveObjectSchema(current);
			current = resolved?.properties?.[part] ?? current;
			continue;
		}
		const resolved = resolveObjectSchema(current);
		if (!resolved?.properties?.[part]) return null;
		current = resolved.properties[part];
	}
	return current;
}

function summarizeSchemaNode(schema: unknown, label: string): string {
	const resolved = resolveObjectSchema(schema);
	if (!resolved) return '';

	const lines = [`${label}:`];
	if (resolved.required.length) {
		lines.push(`  required: ${resolved.required.join(', ')}`);
	}

	const enumFields: string[] = [];
	for (const [key, prop] of Object.entries(resolved.properties)) {
		if (!prop || typeof prop !== 'object') continue;
		const p = prop as Record<string, unknown>;
		if (Array.isArray(p.enum) && p.enum.length) {
			enumFields.push(`  ${key}: ${(p.enum as string[]).join(' | ')}`);
		}
	}
	if (enumFields.length) {
		lines.push('  enums:', ...enumFields.slice(0, 30));
	}

	const descFields: string[] = [];
	for (const [key, prop] of Object.entries(resolved.properties).slice(0, 25)) {
		if (!prop || typeof prop !== 'object') continue;
		const p = prop as Record<string, unknown>;
		if (typeof p.description === 'string' && p.description.length < 200) {
			descFields.push(`  ${key}: ${p.description}`);
		}
	}
	if (descFields.length) {
		lines.push('  field descriptions:', ...descFields);
	}

	return lines.join('\n');
}

function formatTargetSchema(
	kind: string,
	group: string,
	version: string,
	release: string,
	deprecated: boolean,
	sections: SchemaSections
): string {
	return JSON.stringify(
		{
			apiVersion: `${group}/${version}`,
			kind,
			metadata: { release, deprecated },
			specSchema: sections.spec ?? null,
			statusSchema: sections.status ?? null,
			specRequired: getRequiredFields(sections.spec),
			statusRequired: getRequiredFields(sections.status)
		},
		null,
		2
	);
}

function formatSiblingSummary(
	kind: string,
	group: string,
	version: string,
	deprecated: boolean
): string {
	return `- ${group}/${version}${deprecated ? ' (deprecated)' : ''} [${kind}]`;
}

/** Server-side rich context assembly from manifest + schema cache. */
export async function buildRichContext(
	input: BuildRichContextInput,
	fetcher: typeof fetch = fetch
): Promise<BuildRichContextResult | null> {
	const releaseFolder = resolveReleaseFolder(input.release);
	if (!releaseFolder) return null;

	const safeFolder = assertSafeFolderPath(releaseFolder);
	const manifest = await fetchManifest(safeFolder, undefined, fetcher);
	if (!manifest) return null;

	const entry = findManifestEntry(manifest, input.kind, input.group);
	if (!entry?.name) return null;

	const version = input.version || getLatestVersion({ versions: entry.versions ?? [] });
	if (!version) return null;

	const targetPath = schemaPath(safeFolder, entry.name, version);
	const targetSchema = await fetchSchema(targetPath, fetcher);
	if (!targetSchema) return null;

	const versionMeta = entry.versions?.find((v) => v.name === version);
	const deprecated = !!versionMeta?.deprecated;

	const targetText = formatTargetSchema(
		input.kind,
		input.group,
		version,
		input.release,
		deprecated,
		targetSchema
	);

	const siblingVersions = (entry.versions ?? [])
		.map((v) => v.name)
		.filter((v) => v && v !== version);
	const siblingLines: string[] = [];
	for (const sibVer of siblingVersions.slice(0, 6)) {
		const sibDeprecated = !!entry.versions?.find((v) => v.name === sibVer)?.deprecated;
		siblingLines.push(formatSiblingSummary(input.kind, input.group, sibVer, sibDeprecated));
		const sibPath = schemaPath(safeFolder, entry.name, sibVer);
		const sibSchema = await fetchSchema(sibPath, fetcher);
		if (sibSchema) {
			siblingLines.push(
				`  spec required: ${getRequiredFields(sibSchema.spec).join(', ') || '(none)'}`
			);
		}
	}

	const related = findManifestEntriesByGroup(manifest, input.group)
		.filter((r) => r.kind && r.kind !== input.kind)
		.slice(0, 12)
		.map((r) => `- ${r.kind} (${r.name})`);

	const schemaWalkParts: string[] = [];
	if (input.fieldPath) {
		const focused =
			navigateSchema(targetSchema.spec, input.fieldPath) ??
			navigateSchema(targetSchema.status, input.fieldPath);
		if (focused) {
			schemaWalkParts.push(summarizeSchemaNode(focused, `Focused field: ${input.fieldPath}`));
		}
	}
	schemaWalkParts.push(summarizeSchemaNode(targetSchema.spec, 'spec summary'));
	schemaWalkParts.push(summarizeSchemaNode(targetSchema.status, 'status summary'));

	const context = assembleContext([
		{ tier: 'target', text: `## Target CRD\n${targetText}` },
		{
			tier: 'siblings',
			text: siblingLines.length ? `## Sibling API versions\n${siblingLines.join('\n')}` : ''
		},
		{
			tier: 'related',
			text: related.length ? `## Related kinds (same group)\n${related.join('\n')}` : ''
		},
		{
			tier: 'schemaWalk',
			text: schemaWalkParts.filter(Boolean).length
				? `## Schema walk\n${schemaWalkParts.filter(Boolean).join('\n\n')}`
				: ''
		}
	]);

	return {
		context,
		resourceName: entry.name,
		releaseFolder: safeFolder,
		apiVersion: `${input.group}/${version}`,
		version
	};
}

export function trimLegacyContext(context: unknown): string {
	if (typeof context !== 'string') return '';
	return trimToBudget(context.trim(), 8000);
}
