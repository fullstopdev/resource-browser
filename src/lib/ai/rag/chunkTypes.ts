export const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5' as const;
/** Dimensions for @cf/baai/bge-base-en-v1.5 */
export const EMBEDDING_DIMENSIONS = 768;

export type ChunkType = 'kind-overview' | 'field-level' | 'validation-rules';

export type CrdChunkMetadata = {
	release: string;
	kind: string;
	group: string;
	version: string;
	path: string;
	chunkType: ChunkType;
	fieldPath?: string;
	/** Stored in Vectorize metadata for retrieval (not indexed). */
	text?: string;
};

export type CrdChunk = {
	id: string;
	text: string;
	metadata: CrdChunkMetadata;
};

export type RetrievedChunk = {
	id: string;
	text: string;
	metadata: CrdChunkMetadata;
	score: number;
};
