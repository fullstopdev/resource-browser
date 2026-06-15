import { findManifestEntry, findManifestEntryCaseInsensitive } from '$lib/manifest/lookup';
import { getLatestVersion } from '$lib/versions';
import { schemaPath, fetchSchemas, type SchemaSections } from '$lib/yaml-validation/schemaCache';
import type { ManifestEntry } from '$lib/yaml-validation/types';
import type { BundleResource } from './types';

export type YamlCompletionContext = {
	resources: BundleResource[];
	schemas: Map<string, SchemaSections>;
	releaseFolder: string;
	manifest: ManifestEntry[];
};

/** Schema cache key for a bundle resource (exported for tests and fingerprinting). */
export function schemaKeyForResource(
	ctx: Pick<YamlCompletionContext, 'manifest' | 'releaseFolder'>,
	resource: Pick<BundleResource, 'kind' | 'group'>
): string | null {
	if (!resource.kind || !resource.group) return null;
	const entry =
		findManifestEntry(ctx.manifest, resource.kind, resource.group) ??
		findManifestEntryCaseInsensitive(ctx.manifest, resource.kind, resource.group);
	if (!entry) return null;
	const version = getLatestVersion(entry);
	if (!version) return null;
	return schemaPath(ctx.releaseFolder, entry.name, version);
}

export function schemaKeysForResources(
	resources: BundleResource[],
	releaseFolder: string,
	manifest: ManifestEntry[]
): string[] {
	const ctx = { manifest, releaseFolder };
	const keys = new Set<string>();
	for (const res of resources) {
		const key = schemaKeyForResource(ctx, res);
		if (key) keys.add(key);
	}
	return [...keys].sort();
}

export async function fetchYamlCompletionSchemas(
	resources: BundleResource[],
	releaseFolder: string,
	manifest: ManifestEntry[],
	fetcher: typeof fetch = fetch
): Promise<Map<string, SchemaSections>> {
	return fetchSchemas(schemaKeysForResources(resources, releaseFolder, manifest), fetcher);
}
