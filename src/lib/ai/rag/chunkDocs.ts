import { CHUNK_TARGET_CHARS_MAX, CHUNK_TARGET_CHARS_MIN } from '$lib/ai/tokenBudget';
import type { DocsChunk, DocsChunkMetadata } from './chunkTypes';

function chunkId(meta: DocsChunkMetadata, suffix: string): string {
	return `eda-docs:${meta.release}:${meta.path}:${suffix}`;
}

function splitParagraphs(text: string): string[] {
	return text
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter(Boolean);
}

/** Split doc page text into 256–512 token target chunks for embedding. */
export function chunkDocText(
	body: string,
	meta: Omit<DocsChunkMetadata, 'chunkType'>
): DocsChunk[] {
	const paragraphs = splitParagraphs(body);
	if (!paragraphs.length) return [];

	const prefix = `Title: ${meta.title}\nSection: ${meta.section}\nPath: ${meta.path}\n\n`;
	const chunks: DocsChunk[] = [];
	let buffer = '';

	function flush(suffix: string) {
		const text = (prefix + buffer).trim();
		if (!text || text === prefix.trim()) return;
		chunks.push({
			id: chunkId({ ...meta, chunkType: 'eda-doc' }, suffix),
			text,
			metadata: { ...meta, chunkType: 'eda-doc' }
		});
		buffer = '';
	}

	for (const paragraph of paragraphs) {
		const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
		if (candidate.length > CHUNK_TARGET_CHARS_MAX && buffer) {
			flush(String(chunks.length));
			buffer = paragraph;
		} else {
			buffer = candidate;
		}

		if (buffer.length >= CHUNK_TARGET_CHARS_MIN && buffer.length <= CHUNK_TARGET_CHARS_MAX) {
			flush(String(chunks.length));
		} else if (buffer.length > CHUNK_TARGET_CHARS_MAX) {
			// Oversized paragraph — hard-split by sentences.
			const sentences = buffer.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [buffer];
			let part = '';
			for (const sentence of sentences) {
				const next = part ? `${part} ${sentence.trim()}` : sentence.trim();
				if (next.length > CHUNK_TARGET_CHARS_MAX && part) {
					buffer = part;
					flush(String(chunks.length));
					part = sentence.trim();
				} else {
					part = next;
				}
			}
			buffer = part;
		}
	}

	if (buffer.trim()) {
		flush(String(chunks.length));
	}

	return chunks;
}
