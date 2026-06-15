import { buildCatalogCrdPath } from '$lib/urlState';
import type { RagSource } from './chunkTypes';

/** Build a catalog modal path from Vectorize metadata path (`/resources/<folder>/<name>/<ver>.yaml`). */
export function resourceBrowserPathFromMetadata(
	release: string,
	path?: string
): string | null {
	if (!path) return null;
	const match = path.match(/^\/resources\/[^/]+\/([^/]+)\/([^/]+)\.ya?ml$/i);
	if (!match) return null;
	const [, name, version] = match;
	return buildCatalogCrdPath({ release, name, version });
}

/** Absolute URL for a grounded CRD source citation. */
export function resourceBrowserUrl(origin: string, source: RagSource): string | null {
	if (source.source !== 'crd-corpus' || !source.release) return null;
	const relPath = resourceBrowserPathFromMetadata(source.release, source.path);
	return relPath ? new URL(relPath, origin).href : null;
}
