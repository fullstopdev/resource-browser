/** Approximate chars-per-token for English technical text (conservative). */
export const CHARS_PER_TOKEN = 4;

export type ContextTier = 'kv' | 'target' | 'siblings' | 'related' | 'schemaWalk' | 'rag';

/** Per-target KV budget when exactly one CRD is in scope. */
export const SINGLE_TARGET_KV_CHAR_LIMIT = 28_000;

/** Shared KV pool for multi-target questions before per-target split. */
export const MULTI_TARGET_KV_CHAR_POOL = 36_000;

export const TIER_CHAR_LIMITS: Record<ContextTier, number> = {
	kv: SINGLE_TARGET_KV_CHAR_LIMIT,
	target: 20_000,
	siblings: 4_000,
	related: 2_000,
	schemaWalk: 6_000,
	rag: 8_000
};

export const MAX_QUESTION_CHARS = 2000;
export const MAX_LEGACY_CONTEXT_CHARS = 8000;
/** ~20k tokens input budget — well within @cf/meta/llama-3.1-8b-instruct-fast 128k window. */
export const MAX_TOTAL_CONTEXT_CHARS = 80_000;

/** Rich-context fallback when Vectorize returns no/insufficient chunks. */
export const TRIMMED_FALLBACK_CHAR_LIMIT = 4_000;

/** Metadata-only target header when RAG chunks are sufficient. */
export const SLIM_TARGET_CHAR_LIMIT = 800;

/** Target token range for embed chunks (256–512 tokens). */
export const CHUNK_TARGET_CHARS_MIN = 256 * CHARS_PER_TOKEN;
export const CHUNK_TARGET_CHARS_MAX = 512 * CHARS_PER_TOKEN;

export function estimateTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function trimToBudget(text: string, maxChars: number): string {
	const trimmed = text.trim();
	if (trimmed.length <= maxChars) return trimmed;

	const slice = trimmed.slice(0, maxChars);
	const minCut = Math.floor(maxChars * 0.65);

	const lastFenceClose = slice.lastIndexOf('\n```');
	if (lastFenceClose >= minCut) {
		return `${slice.slice(0, lastFenceClose)}\n…[truncated]`;
	}

	const lastPara = slice.lastIndexOf('\n\n');
	if (lastPara >= minCut) {
		return `${slice.slice(0, lastPara)}\n…[truncated]`;
	}

	const lastLine = slice.lastIndexOf('\n');
	if (lastLine >= minCut) {
		return `${slice.slice(0, lastLine)}\n…[truncated]`;
	}

	const lastSentence = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('.\n'));
	if (lastSentence >= minCut) {
		return `${slice.slice(0, lastSentence + 1)}\n…[truncated]`;
	}

	return `${slice}\n…[truncated]`;
}

/** Merge sections in priority order until the total char budget is reached. */
export function assembleContext(sections: { tier: ContextTier; text: string }[]): string {
	const parts: string[] = [];
	let total = 0;

	for (const { tier, text } of sections) {
		if (!text.trim()) continue;
		const limit = TIER_CHAR_LIMITS[tier];
		const slice = trimToBudget(text, Math.min(limit, MAX_TOTAL_CONTEXT_CHARS - total));
		if (!slice) continue;
		parts.push(slice);
		total += slice.length;
		if (total >= MAX_TOTAL_CONTEXT_CHARS) break;
	}

	return parts.join('\n\n---\n\n');
}
