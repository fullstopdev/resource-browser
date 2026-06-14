export const AI_CACHE_PREFIX = 'ai:v1';

export type AiCachePayload = {
	answer: string;
	release: string;
	kind: string;
	field?: string;
	action: string;
	examples?: string[];
	compareRelease?: string;
};

export function buildCacheKey(params: {
	release: string;
	kind: string;
	group?: string;
	field?: string;
	compareRelease?: string;
	action: string;
}): string {
	const groupSegment = params.group ? encodeURIComponent(params.group) : 'none';
	const fieldSegment = params.field ? encodeURIComponent(params.field) : 'none';
	const compareSegment = params.compareRelease ?? 'none';
	return `${AI_CACHE_PREFIX}:${params.release}:${params.kind}:${groupSegment}:${fieldSegment}:${compareSegment}:${params.action}`;
}

/** Legacy cache keys (pre group segment) for warmed KV without apiGroup. */
export function buildLegacyCacheKey(params: {
	release: string;
	kind: string;
	field?: string;
	compareRelease?: string;
	action: string;
}): string {
	const fieldSegment = params.field ? encodeURIComponent(params.field) : 'none';
	const compareSegment = params.compareRelease ?? 'none';
	return `${AI_CACHE_PREFIX}:${params.release}:${params.kind}:${fieldSegment}:${compareSegment}:${params.action}`;
}

export async function getCachedAiResponseWithFallback(
	kv: KVNamespace | undefined,
	params: {
		release: string;
		kind: string;
		group?: string;
		field?: string;
		compareRelease?: string;
		action: string;
	}
): Promise<AiCachePayload | null> {
	if (!kv) return null;
	const primary = await getCachedAiResponse(kv, buildCacheKey(params));
	if (primary) return primary;
	if (params.group) {
		return getCachedAiResponse(kv, buildLegacyCacheKey(params));
	}
	return null;
}

export function isCacheableAction(action: string): boolean {
	return action !== 'validate';
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
