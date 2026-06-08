export const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5' as const;
/** Dimensions for @cf/baai/bge-base-en-v1.5 */
export const EMBEDDING_DIMENSIONS = 768;

export type ChunkType = 'kind-overview' | 'field-level' | 'validation-rules';
export type DocsChunkType = 'eda-doc';

export type DocsChunkMetadata = {
	source: 'eda-docs';
	release: string;
	path: string;
	title: string;
	section: string;
	chunkType: DocsChunkType;
	/** Stored in Vectorize metadata for retrieval (not indexed). */
	text?: string;
};

export type DocsChunk = {
	id: string;
	text: string;
	metadata: DocsChunkMetadata;
};

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

export type RetrievedDocsChunk = {
	id: string;
	text: string;
	metadata: DocsChunkMetadata;
	score: number;
};

export type RagSource = {
	source: 'crd-corpus' | 'eda-docs';
	label: string;
	release: string;
	kind?: string;
	group?: string;
	path: string;
	section?: string;
};
