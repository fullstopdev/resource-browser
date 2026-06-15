import {
	buildReleaseCacheKey,
	getCachedAiResponse,
	RELEASE_CACHE_KIND,
	RELEASE_DEPENDENCY_MAP_ACTION
} from '$lib/ai/kvCache';
import {
	formatDependencyMapForKv,
	sliceDependencyMapForTargets
} from '$lib/ai/formatDependencyMap';
import { loadReleaseDependencyGraph } from '$lib/ai/loadReleaseDependencyGraph';
import { formatKvDependencyMapSection } from '$lib/ai/formatAnswer';

export type ReleaseDependencyMapContextInput = {
	release: string;
	kv: KVNamespace | undefined;
	originFetch: typeof fetch;
	targets: Array<{ kind: string }>;
	maxChars: number;
};

/** Load release dependency map from KV or static assets; slice for resolved targets. */
export async function loadReleaseDependencyMapContext(
	input: ReleaseDependencyMapContextInput
): Promise<string | undefined> {
	const { release, kv, originFetch, targets, maxChars } = input;
	if (!release || maxChars <= 0) return undefined;

	let fullMap: string | undefined;

	const cached = await getCachedAiResponse(
		kv,
		buildReleaseCacheKey({ release, action: RELEASE_DEPENDENCY_MAP_ACTION })
	);
	if (cached?.answer?.trim()) {
		fullMap = cached.answer.trim();
	} else {
		const graph = await loadReleaseDependencyGraph(release, originFetch);
		if (graph) {
			fullMap = formatDependencyMapForKv(graph, release);
		}
	}

	if (!fullMap) return undefined;

	const sliced = sliceDependencyMapForTargets(fullMap, targets, maxChars);
	return formatKvDependencyMapSection(sliced);
}

export { RELEASE_CACHE_KIND, RELEASE_DEPENDENCY_MAP_ACTION };
