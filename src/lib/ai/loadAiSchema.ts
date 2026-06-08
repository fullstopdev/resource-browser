import { fetchManifest } from '$lib/manifest/fetch';
import { findManifestEntry } from '$lib/manifest/lookup';
import { getRequiredFields } from '$lib/schema/requiredFields';
import { getLatestVersion } from '$lib/versions';
import {
	assertSafeFolderPath,
	fetchSchema,
	schemaPath,
	type SchemaSections
} from '$lib/yaml-validation/schemaCache';
import { resolveReleaseFolder } from './buildRichContext';

export type AiSchemaPayload = {
	apiVersion: string;
	kind: string;
	group: string;
	release: string;
	deprecated: boolean;
	specSchema: unknown;
	statusSchema: unknown;
	specRequired: string[];
	statusRequired: string[];
	resourceName: string;
	version: string;
};

function findEntryByKind(
	manifest: { kind?: string; group?: string; name: string; versions?: { name: string; deprecated?: boolean }[] }[],
	kind: string,
	group?: string
) {
	if (group) {
		return findManifestEntry(manifest, kind, group);
	}
	const matches = manifest.filter((r) => r.kind === kind && r.group);
	if (matches.length === 1) return matches[0];
	return matches[0];
}

function formatSchemaPayload(
	kind: string,
	group: string,
	version: string,
	release: string,
	deprecated: boolean,
	sections: SchemaSections,
	resourceName: string
): AiSchemaPayload {
	return {
		apiVersion: `${group}/${version}`,
		kind,
		group,
		release,
		deprecated,
		specSchema: sections.spec ?? null,
		statusSchema: sections.status ?? null,
		specRequired: getRequiredFields(sections.spec),
		statusRequired: getRequiredFields(sections.status),
		resourceName,
		version
	};
}

/** Load CRD schema from manifest + static YAML for Workers AI action prompts. */
export async function loadAiSchema(
	release: string,
	kind: string,
	fetcher: typeof fetch = fetch,
	group?: string,
	version?: string
): Promise<AiSchemaPayload | null> {
	const releaseFolder = resolveReleaseFolder(release);
	if (!releaseFolder) return null;

	const safeFolder = assertSafeFolderPath(releaseFolder);
	const manifest = await fetchManifest(safeFolder, undefined, fetcher);
	if (!manifest) return null;

	const entry = findEntryByKind(manifest, kind, group);
	if (!entry?.name || !entry.group) return null;

	const resolvedVersion = version || getLatestVersion({ versions: entry.versions ?? [] });
	if (!resolvedVersion) return null;

	const targetPath = schemaPath(safeFolder, entry.name, resolvedVersion);
	const targetSchema = await fetchSchema(targetPath, fetcher);
	if (!targetSchema) return null;

	const versionMeta = entry.versions?.find((v) => v.name === resolvedVersion);
	const deprecated = !!versionMeta?.deprecated;

	return formatSchemaPayload(
		entry.kind ?? kind,
		entry.group,
		resolvedVersion,
		release,
		deprecated,
		targetSchema,
		entry.name
	);
}
