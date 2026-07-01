export const AI_CACHE_PREFIX = 'ai:v2';

/** Sentinel kind for release-scoped KV entries (e.g. full dependency map). */
export const RELEASE_CACHE_KIND = '__release__';

export const RELEASE_DEPENDENCY_MAP_ACTION = 'dependency-map';

/** Actions warmed for Ask AI grounding (see scripts/warm-cache.ts). */
export const DETERMINISTIC_WARM_ACTIONS = [
	'dependency-map',
	'schema-summary',
	'relationships',
	'full-context'
] as const;

/** LLM-backed warm actions — consume Workers AI neurons (opt-in). */
export const LLM_WARM_ACTIONS = ['explain', 'example'] as const;

export const ASK_WARM_ACTIONS = [
	...DETERMINISTIC_WARM_ACTIONS,
	...LLM_WARM_ACTIONS
] as const;

/** Deterministic cache actions — no Workers AI neurons required. */
export const DETERMINISTIC_CACHE_ACTIONS = new Set([
	'dependency-map',
	'schema-summary',
	'relationships',
	'full-context'
]);

export type AiCachePayload = {
	answer: string;
	release: string;
	kind: string;
	action: string;
	apiVersion?: string;
	field?: string;
	examples?: string[];
	compareRelease?: string;
	fixedYaml?: string;
	explanation?: string;
	fixable?: boolean;
};

export function buildCacheKey(params: {
	release: string;
	kind: string;
	group?: string;
	apiVersion?: string;
	field?: string;
	compareRelease?: string;
	action: string;
}): string {
	const groupSegment = params.group ? encodeURIComponent(params.group) : 'none';
	const apiVersionSegment = params.apiVersion
		? encodeURIComponent(params.apiVersion)
		: 'none';
	const fieldSegment = params.field ? encodeURIComponent(params.field) : 'none';
	const compareSegment = params.compareRelease ?? 'none';
	return `${AI_CACHE_PREFIX}:${params.release}:${params.kind}:${groupSegment}:${apiVersionSegment}:${fieldSegment}:${compareSegment}:${params.action}`;
}

/** KV key for release-wide cache entries (one per release, not per CRD). */
export function buildReleaseCacheKey(params: { release: string; action: string }): string {
	return buildCacheKey({
		release: params.release,
		kind: RELEASE_CACHE_KIND,
		group: 'none',
		apiVersion: 'none',
		action: params.action
	});
}

/** KV key for cached YAML fix responses (issue fingerprint + document digest). */
export function buildFixCacheKey(params: {
	release: string;
	kind: string;
	group?: string;
	fieldPath?: string;
	issueKind?: string;
	messageDigest: string;
	docDigest: string;
}): string {
	const groupSegment = params.group ? encodeURIComponent(params.group) : 'none';
	const fieldSegment = params.fieldPath ? encodeURIComponent(params.fieldPath) : 'none';
	const issueKindSegment = params.issueKind ? encodeURIComponent(params.issueKind) : 'none';
	return `${AI_CACHE_PREFIX}:fix:${params.release}:${params.kind}:${groupSegment}:${fieldSegment}:${issueKindSegment}:${params.docDigest}:${params.messageDigest}`;
}

export function hashFixCacheDigest(message: string, fieldPath?: string, issueKind?: string): string {
	let hash = 5381;
	const text = `${issueKind ?? ''}|${fieldPath ?? ''}|${message}`;
	for (let i = 0; i < text.length; i++) {
		hash = (hash * 33) ^ text.charCodeAt(i);
	}
	return (hash >>> 0).toString(36);
}

export function hashMigrationFixDigest(issueIds: string[]): string {
	return hashFixCacheDigest(issueIds.slice().sort().join('|'));
}

/** KV key for batched migration fix responses. */
export function buildMigrationFixCacheKey(params: {
	release: string;
	kind: string;
	group?: string;
	docDigest: string;
	issueIdsDigest: string;
}): string {
	const groupSegment = params.group ? encodeURIComponent(params.group) : 'none';
	return `${AI_CACHE_PREFIX}:fix-migration:${params.release}:${params.kind}:${groupSegment}:${params.docDigest}:${params.issueIdsDigest}`;
}

export function hashDocYamlDigest(yaml: string): string {
	let hash = 5381;
	for (let i = 0; i < yaml.length; i++) {
		hash = (hash * 33) ^ yaml.charCodeAt(i);
	}
	return (hash >>> 0).toString(36);
}

/** Legacy v1 cache keys (pre apiVersion segment) — not read after v2 rollout. */
export function buildLegacyCacheKey(params: {
	release: string;
	kind: string;
	field?: string;
	compareRelease?: string;
	action: string;
}): string {
	const fieldSegment = params.field ? encodeURIComponent(params.field) : 'none';
	const compareSegment = params.compareRelease ?? 'none';
	return `ai:v1:${params.release}:${params.kind}:${fieldSegment}:${compareSegment}:${params.action}`;
}

export async function getCachedAiResponsesForTargets(
	kv: KVNamespace | undefined,
	targets: Array<{ release: string; kind: string; group: string; apiVersion?: string }>,
	action: string
): Promise<Map<string, AiCachePayload | null>> {
	const results = new Map<string, AiCachePayload | null>();
	if (!kv || !targets.length) return results;

	await Promise.all(
		targets.map(async (target) => {
			const key = `${target.kind}::${target.group}`;
			const cached = await getCachedAiResponseWithFallback(kv, {
				release: target.release,
				kind: target.kind,
				group: target.group,
				apiVersion: target.apiVersion,
				action
			});
			results.set(key, cached);
		})
	);
	return results;
}

export async function getCachedAiResponseWithFallback(
	kv: KVNamespace | undefined,
	params: {
		release: string;
		kind: string;
		group?: string;
		apiVersion?: string;
		field?: string;
		compareRelease?: string;
		action: string;
	}
): Promise<AiCachePayload | null> {
	if (!kv) return null;
	const primary = await getCachedAiResponse(kv, buildCacheKey(params));
	if (primary) return primary;
	return null;
}

export function isCacheableAction(action: string): boolean {
	return action !== 'validate';
}

export function isDeterministicCacheAction(action: string): boolean {
	return DETERMINISTIC_CACHE_ACTIONS.has(action);
}

export async function getCachedAiResponse(
	kv: KVNamespace | undefined,
	key: string
): Promise<AiCachePayload | null> {
	if (!kv) return null;
	const cached = await kv.get(key);
	if (!cached) return null;
	try {
		return JSON.parse(cached) as AiCachePayload;
	} catch {
		return null;
	}
}

export async function putCachedAiResponse(
	kv: KVNamespace | undefined,
	key: string,
	payload: AiCachePayload
): Promise<void> {
	if (!kv) return;
	await kv.put(key, JSON.stringify(payload));
}

/** Parse fenced yaml blocks from an example action response. */
export function parseExamples(text: string): string[] {
	const regex = /```ya?ml\n([\s\S]*?)```/gi;
	const examples: string[] = [];
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		examples.push(match[1].trim());
	}
	return examples.length > 0 ? examples : [text];
}

/** Serve one example from a cached pool for variety without extra neuron cost. */
export function pickRandomExample(payload: AiCachePayload): AiCachePayload {
	if (!payload.examples?.length) return payload;
	const idx = Math.floor(Math.random() * payload.examples.length);
	return {
		...payload,
		answer: payload.examples[idx]
	};
}
