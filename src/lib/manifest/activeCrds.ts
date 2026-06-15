import type { CrdVersions } from '$lib/structure';
import { getLatestVersion } from '$lib/versions';

type ManifestEntry = {
	name: string;
	kind?: string;
	group?: string;
	versions?: CrdVersions[];
};

/** True when the CRD has at least one non-deprecated API version. */
export function isActiveCrd(entry: ManifestEntry | null | undefined): boolean {
	const versions = entry?.versions ?? [];
	if (!versions.length) return false;
	return versions.some((v) => v?.name && !v.deprecated);
}

/** Latest non-deprecated apiVersion, or empty when inactive. */
export function activeApiVersion(entry: ManifestEntry | null | undefined): string {
	if (!isActiveCrd(entry)) return '';
	return getLatestVersion(entry);
}

/** Drop CRDs whose versions are all deprecated. */
export function filterActiveManifest<T extends ManifestEntry>(manifest: T[]): T[] {
	return manifest.filter((entry) => isActiveCrd(entry));
}
