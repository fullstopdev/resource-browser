import {
	EMBEDDING_MODEL,
	type CrdChunkMetadata,
	type DocsChunkMetadata,
	type RagSource,
	type RetrievedChunk,
	type RetrievedDocsChunk
} from './chunkTypes';
import { trimToBudget } from '$lib/ai/tokenBudget';

export const DEFAULT_TOP_K = 6;
const RAG_CONTEXT_CHAR_LIMIT = 6000;

/** Enough retrieved chunks to skip full CRD spec in the LLM prompt. */
export const MIN_SUFFICIENT_RAG_CHUNKS = 3;
/** Top match score (cosine) that alone can justify slim context. */
export const MIN_RAG_SCORE = 0.65;
/** Drop weak Vectorize matches to reduce off-topic context. */
export const MIN_CHUNK_SCORE = 0.45;

export type RagFilters = {
	release?: string;
	kind?: string;
	group?: string;
};

/** When the UI pins a CRD, embedding must not treat "Policy" as generic policy-* kinds. */
export function buildRagEmbeddingQuery(question: string, filters: RagFilters): string {
	const q = question.trim();
	if (filters.kind && filters.group) {
		const rel = filters.release ? ` release ${filters.release}` : '';
		return `Kubernetes CRD kind ${filters.kind} apiGroup ${filters.group}${rel}. ${q}`;
	}
	if (filters.kind) {
		return `Kubernetes CRD kind ${filters.kind}. ${q}`;
	}
	return q;
}

export function crdChunkMatchesFilters(
	meta: { kind: string; group: string; release?: string },
	filters: RagFilters
): boolean {
	if (filters.kind && meta.kind !== filters.kind) return false;
	if (filters.group && meta.group !== filters.group) return false;
	if (filters.release && meta.release && meta.release !== filters.release) return false;
	return true;
}

export function hasStrictCrdTarget(filters: RagFilters): boolean {
	return !!(filters.kind && filters.group);
}

export type RetrieveResult = {
	chunks: RetrievedChunk[];
	docsChunks: RetrievedDocsChunk[];
	sources: RagSource[];
	contextText: string;
	mergedCount: number;
	topScore: number;
	sufficient: boolean;
	/** True when release filter was applied but Vectorize returned no matches. */
	releaseNotIndexed: boolean;
};

export function isRagSufficient(mergedCount: number, topScore: number): boolean {
	if (mergedCount >= MIN_SUFFICIENT_RAG_CHUNKS) return true;
	if (mergedCount >= 1 && topScore >= MIN_RAG_SCORE) return true;
	return false;
}

/** Dedupe CRD candidates from Vectorize source metadata for ask-target resolution. */
export function extractCrdCandidatesFromSources(
	sources: RagSource[]
): Array<{ kind: string; group: string; score: number }> {
	const seen = new Map<string, { kind: string; group: string; score: number }>();
	sources.forEach((source, index) => {
		if (source.source !== 'crd-corpus' || !source.kind || !source.group) return;
		const key = `${source.kind}::${source.group}`;
		const score = Math.max(0, 1 - index * 0.1);
		const existing = seen.get(key);
		if (!existing || score > existing.score) {
			seen.set(key, { kind: source.kind, group: source.group, score });
		}
	});
	return [...seen.values()].sort((a, b) => b.score - a.score);
}

/** Map CRD patch release (e.g. 26.4.2) to docs release (26.4). */
export function docsReleaseForCrd(release: string): string {
	const match = release.match(/^(\d+\.\d+)/);
	return match ? match[1] : release;
}

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

function buildCrdMetadataFilter(filters: RagFilters): Record<string, string> | undefined {
	const filter: Record<string, string> = {};
	if (filters.release) filter.release = filters.release;
	if (filters.kind) filter.kind = filters.kind;
	if (filters.group) filter.group = filters.group;
	return Object.keys(filter).length > 0 ? filter : undefined;
}

function formatCrdSource(meta: CrdChunkMetadata): RagSource {
	const field = meta.fieldPath ? ` — ${meta.fieldPath}` : '';
	return {
		source: 'crd-corpus',
		label: `${meta.kind} (${meta.group}/${meta.version}) [${meta.chunkType}]${field}`,
		release: String(meta.release ?? ''),
		kind: String(meta.kind ?? ''),
		group: String(meta.group ?? ''),
		path: String(meta.path ?? '')
	};
}

function formatDocsSource(meta: DocsChunkMetadata): RagSource {
	return {
		source: 'eda-docs',
		label: `${meta.title} — ${meta.section}`,
		release: meta.release,
		path: meta.path,
		section: meta.section
	};
}

function crdChunkFromMatch(match: VectorizeMatch): RetrievedChunk | null {
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

function docsChunkFromMatch(match: VectorizeMatch): RetrievedDocsChunk | null {
	const raw = match.metadata as Record<string, unknown> | undefined;
	const text = typeof raw?.text === 'string' ? raw.text : undefined;
	if (raw?.source !== 'eda-docs' || !text) return null;

	return {
		id: match.id,
		text,
		metadata: {
			source: 'eda-docs',
			release: String(raw.release ?? ''),
			path: String(raw.path ?? ''),
			title: String(raw.title ?? 'EDA documentation'),
			section: String(raw.section ?? ''),
			chunkType: 'eda-doc'
		},
		score: match.score
	};
}

function dedupeSources(sources: RagSource[]): RagSource[] {
	const seen = new Set<string>();
	const out: RagSource[] = [];
	for (const source of sources) {
		const key = `${source.source}:${source.label}:${source.path}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(source);
	}
	return out;
}

function filterByScore(matches: VectorizeMatch[]): VectorizeMatch[] {
	return matches.filter((match) => (match.score ?? 0) >= MIN_CHUNK_SCORE);
}

async function queryIndex(
	index: VectorizeIndex,
	vector: number[],
	topK: number,
	filter?: Record<string, string>
): Promise<VectorizeMatch[]> {
	const result = await index.query(vector, {
		topK,
		returnMetadata: 'all',
		...(filter ? { filter } : {})
	});
	return filterByScore(result.matches);
}

/** CRD Vectorize query — never widen to release-only when kind+group are pinned. */
async function queryCrdIndex(
	index: VectorizeIndex,
	vector: number[],
	topK: number,
	filters: RagFilters
): Promise<VectorizeMatch[]> {
	const strictFilter = buildCrdMetadataFilter(filters);
	let matches = await queryIndex(index, vector, topK, strictFilter);

	if (matches.length === 0 && hasStrictCrdTarget(filters)) {
		matches = await queryIndex(index, vector, topK, {
			kind: filters.kind!,
			group: filters.group!
		});
	} else if (
		matches.length === 0 &&
		filters.release &&
		(filters.kind || filters.group) &&
		!hasStrictCrdTarget(filters)
	) {
		matches = await queryIndex(index, vector, topK, { release: filters.release });
	}

	if (hasStrictCrdTarget(filters)) {
		matches = matches.filter((match) => {
			const chunk = crdChunkFromMatch(match);
			return chunk ? crdChunkMatchesFilters(chunk.metadata, filters) : false;
		});
	}

	return matches;
}

/** Embed the question and query Vectorize for CRD schema and EDA docs chunks. */
export async function retrieveRagContext(
	ai: Ai,
	crdIndex: VectorizeIndex | undefined,
	docsIndex: VectorizeIndex | undefined,
	question: string,
	filters: RagFilters,
	topK = DEFAULT_TOP_K
): Promise<RetrieveResult> {
	const empty: RetrieveResult = {
		chunks: [],
		docsChunks: [],
		sources: [],
		contextText: '',
		mergedCount: 0,
		topScore: 0,
		sufficient: false,
		releaseNotIndexed: false
	};
	if (!crdIndex && !docsIndex) return empty;

	const vector = await embedQuestion(ai, buildRagEmbeddingQuery(question, filters));
	if (!vector?.length) return empty;

	const crdTopK = docsIndex ? Math.ceil(topK * 0.6) : topK;
	const docsTopK = crdIndex ? Math.ceil(topK * 0.4) : topK;

	try {
		const [crdMatches, docsMatches] = await Promise.all([
			crdIndex
				? queryCrdIndex(crdIndex, vector, crdTopK, filters)
				: Promise.resolve([]),
			docsIndex
				? queryIndex(docsIndex, vector, docsTopK, {
						source: 'eda-docs',
						...(filters.release
							? { release: docsReleaseForCrd(filters.release) }
							: {})
					})
				: Promise.resolve([])
		]);

		const chunks: RetrievedChunk[] = [];
		const docsChunks: RetrievedDocsChunk[] = [];
		const sources: RagSource[] = [];

		for (const match of crdMatches) {
			const chunk = crdChunkFromMatch(match);
			if (!chunk) continue;
			if (hasStrictCrdTarget(filters) && !crdChunkMatchesFilters(chunk.metadata, filters)) {
				continue;
			}
			chunks.push(chunk);
			sources.push(formatCrdSource(chunk.metadata));
		}

		for (const match of docsMatches) {
			const chunk = docsChunkFromMatch(match);
			if (!chunk) continue;
			docsChunks.push(chunk);
			sources.push(formatDocsSource(chunk.metadata));
		}

		const merged = [
			...chunks.map((c) => ({ type: 'crd' as const, score: c.score, text: c.text })),
			...docsChunks.map((c) => ({
				type: 'docs' as const,
				score: c.score,
				text: `### Nokia EDA docs — ${c.metadata.title}\n${c.text}`
			}))
		]
			.sort((a, b) => b.score - a.score)
			.slice(0, topK);

		const mergedCount = merged.length;
		const topScore = mergedCount > 0 ? merged[0].score : 0;
		const sufficient = isRagSufficient(mergedCount, topScore);

		const contextText = trimToBudget(
			merged.map((item, i) => `### Retrieved excerpt ${i + 1}\n${item.text}`).join('\n\n'),
			RAG_CONTEXT_CHAR_LIMIT
		);

		const releaseNotIndexed =
			!!filters.release && chunks.length === 0 && docsChunks.length === 0;

		return {
			chunks,
			docsChunks,
			sources: dedupeSources(sources),
			contextText,
			mergedCount,
			topScore,
			sufficient,
			releaseNotIndexed
		};
	} catch (err) {
		console.error('Vectorize query error:', err);
		return empty;
	}
}
