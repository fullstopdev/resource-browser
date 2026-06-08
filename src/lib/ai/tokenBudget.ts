/** Approximate chars-per-token for English technical text (conservative). */
export const CHARS_PER_TOKEN = 4;

export type ContextTier = 'target' | 'siblings' | 'related' | 'schemaWalk' | 'rag';

export const TIER_CHAR_LIMITS: Record<ContextTier, number> = {
	target: 12_000,
	siblings: 4_000,
	related: 2_000,
	schemaWalk: 3_000,
	rag: 6_000
};

export const MAX_QUESTION_CHARS = 2000;
export const MAX_LEGACY_CONTEXT_CHARS = 8000;
export const MAX_TOTAL_CONTEXT_CHARS = 24_000;

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
	return trimmed.slice(0, maxChars) + '\n…[truncated]';
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
