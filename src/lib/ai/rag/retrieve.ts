import { EMBEDDING_MODEL, type CrdChunkMetadata, type RetrievedChunk } from './chunkTypes';
import { trimToBudget } from '$lib/ai/tokenBudget';

const DEFAULT_TOP_K = 6;
const RAG_CONTEXT_CHAR_LIMIT = 6000;

export type RagFilters = {
	release?: string;
	kind?: string;
	group?: string;
};

export type RetrieveResult = {
	chunks: RetrievedChunk[];
	sources: string[];
	contextText: string;
};

async function embedQuestion(ai: Ai, question: string): Promise<number[] | null> {
	try {
		const result = await ai.run(EMBEDDING_MODEL, { text: [question] });
		if (typeof result === 'object' && result !== null && 'data' in result) {
			const data = (result as { data?: number[][] }).data;
			if (Array.isArray(data?.[0])) return data[0];
		}
	} catch (err) {
		console.error('RAG embedding error:', err);
	}
	return null;
}

function buildMetadataFilter(filters: RagFilters): Record<string, string> | undefined {
	const filter: Record<string, string> = {};
	if (filters.release) filter.release = filters.release;
	if (filters.kind) filter.kind = filters.kind;
	if (filters.group) filter.group = filters.group;
	return Object.keys(filter).length > 0 ? filter : undefined;
}

function formatSource(meta: CrdChunkMetadata): string {
	const field = meta.fieldPath ? ` — ${meta.fieldPath}` : '';
	return `${meta.kind} (${meta.group}/${meta.version}) [${meta.chunkType}]${field}`;
}

function chunkFromMatch(match: VectorizeMatch): RetrievedChunk | null {
	const raw = match.metadata as Record<string, unknown> | undefined;
	const text = typeof raw?.text === 'string' ? raw.text : undefined;
	if (!raw?.kind || !text) return null;
	const meta = raw as CrdChunkMetadata;

	return {
		id: match.id,
		text,
		metadata: {
			release: String(meta.release ?? ''),
			kind: String(meta.kind ?? ''),
			group: String(meta.group ?? ''),
			version: String(meta.version ?? ''),
			path: String(meta.path ?? ''),
			chunkType: meta.chunkType as CrdChunkMetadata['chunkType'],
			fieldPath: meta.fieldPath ? String(meta.fieldPath) : undefined
		},
		score: match.score
	};
}

/** Embed the question and query Vectorize for relevant CRD schema chunks. */
export async function retrieveRagContext(
	ai: Ai,
	index: VectorizeIndex | undefined,
	question: string,
	filters: RagFilters,
	topK = DEFAULT_TOP_K
): Promise<RetrieveResult> {
	const empty: RetrieveResult = { chunks: [], sources: [], contextText: '' };
	if (!index) return empty;

	const vector = await embedQuestion(ai, question);
	if (!vector?.length) return empty;

	try {
		const filter = buildMetadataFilter(filters);
		const result = await index.query(vector, {
			topK,
			returnMetadata: 'all',
			...(filter ? { filter } : {})
		});

		const chunks: RetrievedChunk[] = [];
		const sources: string[] = [];

		for (const match of result.matches) {
			const chunk = chunkFromMatch(match);
			if (!chunk) continue;
			chunks.push(chunk);
			const source = formatSource(chunk.metadata);
			if (!sources.includes(source)) sources.push(source);
		}

		const contextText = trimToBudget(
			chunks.map((c, i) => `### Retrieved excerpt ${i + 1}\n${c.text}`).join('\n\n'),
			RAG_CONTEXT_CHAR_LIMIT
		);

		return { chunks, sources, contextText };
	} catch (err) {
		console.error('Vectorize query error:', err);
		return empty;
	}
}
