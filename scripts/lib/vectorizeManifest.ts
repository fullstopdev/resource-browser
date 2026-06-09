import fs from 'fs/promises';
import path from 'path';

/** Upserted Vectorize vector IDs keyed by index name (e.g. eda-crd-corpus-v1). */
export type VectorizeManifest = Record<string, string[]>;

export const DEFAULT_MANIFEST_PATH = '.vectorize-manifest.json';

export function manifestPath(root = process.cwd()): string {
	return path.join(root, DEFAULT_MANIFEST_PATH);
}

export async function loadVectorizeManifest(
	filePath = manifestPath()
): Promise<VectorizeManifest> {
	try {
		const raw = await fs.readFile(filePath, 'utf8');
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return {};
		}
		const manifest: VectorizeManifest = {};
		for (const [indexName, ids] of Object.entries(parsed)) {
			if (Array.isArray(ids) && ids.every((id) => typeof id === 'string')) {
				manifest[indexName] = ids;
			}
		}
		return manifest;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
		throw err;
	}
}

export async function saveVectorizeManifest(
	manifest: VectorizeManifest,
	filePath = manifestPath()
): Promise<void> {
	await fs.writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function getUpsertedIds(manifest: VectorizeManifest, indexName: string): Set<string> {
	return new Set(manifest[indexName] ?? []);
}

export function markUpserted(
	manifest: VectorizeManifest,
	indexName: string,
	vectorIds: string[]
): void {
	if (!vectorIds.length) return;
	const existing = new Set(manifest[indexName] ?? []);
	for (const id of vectorIds) existing.add(id);
	manifest[indexName] = [...existing];
}

/** Replace manifest entries for an index (e.g. after rebuilding from Vectorize). */
export function setManifestIds(
	manifest: VectorizeManifest,
	indexName: string,
	vectorIds: string[]
): void {
	manifest[indexName] = [...new Set(vectorIds)];
}
