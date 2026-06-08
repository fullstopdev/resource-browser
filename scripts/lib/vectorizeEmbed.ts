import crypto from 'crypto';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '../../src/lib/ai/rag/chunkTypes';
import {
	WorkersAINeuronLimitError,
	isWorkersAINeuronLimitError
} from '../../src/lib/ai/workersAIQuota';

const proxyUrl =
	process.env.HTTPS_PROXY?.trim() ||
	process.env.https_proxy?.trim() ||
	process.env.HTTP_PROXY?.trim() ||
	process.env.http_proxy?.trim();
if (proxyUrl) {
	setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

export const VECTORIZE_ID_MAX = 64;
export const EMBED_BATCH_SIZE = 16;

export type VectorRecord = {
	id: string;
	values: number[];
	metadata: Record<string, string>;
};

export function vectorizeId(chunkId: string): string {
	if (Buffer.byteLength(chunkId, 'utf8') <= VECTORIZE_ID_MAX) return chunkId;
	return crypto.createHash('sha256').update(chunkId).digest('hex');
}

export function requireToken(): string {
	const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
	if (!token) {
		throw new Error('CLOUDFLARE_API_TOKEN is required for embeddings and Vectorize upsert');
	}
	return token;
}

export async function getAccountId(): Promise<string> {
	const fromEnv = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
	if (fromEnv) return fromEnv;

	const whoami = await fetch('https://api.cloudflare.com/client/v4/accounts', {
		headers: { Authorization: `Bearer ${requireToken()}` }
	});
	const data = (await whoami.json()) as { result?: { id: string }[] };
	const id = data.result?.[0]?.id;
	if (!id) throw new Error('Could not resolve CLOUDFLARE_ACCOUNT_ID — set it or run wrangler login');
	return id;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
	const accountId = await getAccountId();
	const token = requireToken();
	const resp = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${EMBEDDING_MODEL}`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ text: texts })
		}
	);

	if (!resp.ok) {
		const body = await resp.text();
		const err = new Error(`Embedding API failed (${resp.status}): ${body}`);
		if (resp.status === 429 || isWorkersAINeuronLimitError(err)) {
			throw new WorkersAINeuronLimitError();
		}
		throw err;
	}

	const json = (await resp.json()) as { result?: { data?: number[][] }; data?: number[][] };
	const vectors = json.result?.data ?? json.data;
	if (!vectors?.length) throw new Error('Embedding API returned no vectors');
	return vectors;
}

export async function upsertVectors(indexName: string, vectors: VectorRecord[]): Promise<void> {
	if (!vectors.length) return;
	const accountId = await getAccountId();
	const token = requireToken();
	const resp = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${accountId}/vectorize/v2/indexes/${indexName}/upsert`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ vectors })
		}
	);

	if (!resp.ok) {
		const body = await resp.text();
		throw new Error(`Vectorize upsert failed (${resp.status}): ${body}`);
	}
}

export async function embedAndUpsert(
	indexName: string,
	records: { id: string; text: string; metadata: Record<string, string> }[],
	onProgress?: (done: number, total: number) => void
): Promise<number> {
	let upserted = 0;

	for (let i = 0; i < records.length; i += EMBED_BATCH_SIZE) {
		const batch = records.slice(i, i + EMBED_BATCH_SIZE);
		const vectors = await embedTexts(batch.map((c) => c.text));
		if (vectors[0]?.length !== EMBEDDING_DIMENSIONS) {
			throw new Error(
				`Unexpected embedding dimensions: got ${vectors[0]?.length}, expected ${EMBEDDING_DIMENSIONS}`
			);
		}
		const payload: VectorRecord[] = batch.map((chunk, idx) => ({
			id: vectorizeId(chunk.id),
			values: vectors[idx],
			metadata: { ...chunk.metadata, text: chunk.text.slice(0, 9000) }
		}));
		await upsertVectors(indexName, payload);
		upserted += payload.length;
		onProgress?.(upserted, records.length);
	}

	return upserted;
}
