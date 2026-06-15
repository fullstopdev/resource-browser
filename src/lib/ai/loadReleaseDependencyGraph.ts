import type { DependencyGraph } from '$lib/dependency-map/types';
import releasesYaml from '$lib/releases.yaml?raw';
import type { ReleasesConfig } from '$lib/structure';
import { loadStaticYaml } from '$lib/yaml/safeYaml';
import { assertSafeFolderPath, releaseAssetPath } from '$lib/yaml-validation/schemaCache';

const releasesConfig = loadStaticYaml(releasesYaml) as ReleasesConfig;

export function releaseFolderForName(releaseName: string): string | null {
	const release = releasesConfig.releases.find(
		(r) => r.name === releaseName || r.label === releaseName
	);
	return release ? assertSafeFolderPath(release.folder) : null;
}

/** Load precomputed dependency-graph.json for a release from static assets. */
export async function loadReleaseDependencyGraph(
	releaseName: string,
	fetcher: typeof fetch = fetch
): Promise<DependencyGraph | null> {
	const folder = releaseFolderForName(releaseName);
	if (!folder) return null;

	try {
		const resp = await fetcher(releaseAssetPath(folder, 'dependency-graph.json'));
		if (!resp.ok) return null;
		const graph = (await resp.json()) as DependencyGraph;
		if (!graph?.nodes?.length || !graph?.links?.length) return null;
		return { ...graph, precomputed: true };
	} catch {
		return null;
	}
}
