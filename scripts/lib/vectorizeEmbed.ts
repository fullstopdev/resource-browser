import crypto from 'crypto';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '../../src/lib/ai/rag/chunkTypes';
import {
	WorkersAINeuronLimitError,
	isWorkersAINeuronLimitError
} from '../../src/lib/ai/workersAIQuota';
import {
	loadVectorizeManifest,
	markUpserted,
	saveVectorizeManifest,
	setManifestIds,
	type VectorizeManifest
} from './vectorizeManifest';

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
export const LIST_VECTORS_PAGE_SIZE = 1000;

type ListVectorsResponse = {
	vectors: { id: string }[];
	count: number;
	totalCount: number;
	isTruncated: boolean;
	nextCursor?: string;
};

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

export async function listVectorIdsPage(
	indexName: string,
	options: { count?: number; cursor?: string } = {}
): Promise<ListVectorsResponse> {
	const accountId = await getAccountId();
	const token = requireToken();
	const params = new URLSearchParams();
	if (options.count !== undefined) params.set('count', String(options.count));
	if (options.cursor) params.set('cursor', options.cursor);
	const qs = params.toString();
	const resp = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${accountId}/vectorize/v2/indexes/${indexName}/list${qs ? `?${qs}` : ''}`,
		{ headers: { Authorization: `Bearer ${token}` } }
	);

	if (!resp.ok) {
		const body = await resp.text();
		throw new Error(`Vectorize list failed (${resp.status}): ${body}`);
	}

	const json = (await resp.json()) as { result?: ListVectorsResponse };
	const result = json.result;
	if (!result) throw new Error('Vectorize list returned no result');
	return result;
}

/** Paginate Vectorize list API until all vector IDs for an index are collected. */
export async function listAllVectorIds(indexName: string): Promise<string[]> {
	const ids: string[] = [];
	let cursor: string | undefined;

	do {
		const page = await listVectorIdsPage(indexName, {
			count: LIST_VECTORS_PAGE_SIZE,
			cursor
		});
		for (const vector of page.vectors) ids.push(vector.id);
		cursor = page.isTruncated && page.nextCursor ? page.nextCursor : undefined;
	} while (cursor);

	return ids;
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

export type EmbedAndUpsertOptions = {
	force?: boolean;
	manifestPath?: string;
	/** When false (default), merge Vectorize index IDs into local manifest before skipping. */
	syncFromIndex?: boolean;
	onProgress?: (indexed: number, total: number, upsertedThisRun: number) => void;
};

export type EmbedAndUpsertResult = {
	upserted: number;
	skipped: number;
	indexed: number;
	total: number;
};

export type IndexSyncResult = {
	localCount: number;
	remoteCount: number;
	mergedCount: number;
};

/** Align local manifest with Vectorize index IDs (source of truth for resume skips). */
export async function syncManifestWithIndex(
	indexName: string,
	manifest: VectorizeManifest,
	manifestPath?: string
): Promise<IndexSyncResult> {
	const localCount = manifest[indexName]?.length ?? 0;
	console.log(`Syncing manifest with Vectorize index ${indexName}...`);

	const remoteIds = await listAllVectorIds(indexName);
	const remoteSet = new Set(remoteIds);
	const localOnly = (manifest[indexName] ?? []).filter((id) => !remoteSet.has(id));
	setManifestIds(manifest, indexName, remoteIds);
	await saveVectorizeManifest(manifest, manifestPath);

	if (localOnly.length > 0) {
		console.log(`  Pruned ${localOnly.length} local-only ID(s) not in index`);
	}
	console.log(`  Manifest: ${localCount} local → ${remoteIds.length} from index`);

	return { localCount, remoteCount: remoteIds.length, mergedCount: remoteIds.length };
}

export async function getIndexVectorCount(indexName: string): Promise<number> {
	const page = await listVectorIdsPage(indexName, { count: 1 });
	return page.totalCount;
}

export async function embedAndUpsert(
	indexName: string,
	records: { id: string; text: string; metadata: Record<string, string> }[],
	options: EmbedAndUpsertOptions = {}
): Promise<EmbedAndUpsertResult> {
	const { force = false, manifestPath, syncFromIndex = true, onProgress } = options;
	const manifest: VectorizeManifest = await loadVectorizeManifest(manifestPath);
	const total = records.length;

	if (!force && syncFromIndex) {
		await syncManifestWithIndex(indexName, manifest, manifestPath);
	}

	const upsertedIds = force ? new Set<string>() : new Set(manifest[indexName] ?? []);

	const pending = force
		? records
		: records.filter((record) => !upsertedIds.has(vectorizeId(record.id)));
	const skipped = total - pending.length;

	console.log(
		`Resume: ${skipped}/${total} already indexed, ${pending.length} remaining` +
			(force ? ' (--force: re-embedding all)' : '')
	);

	if (!pending.length) {
		onProgress?.(skipped, total, 0);
		return { upserted: 0, skipped, indexed: skipped, total };
	}

	let upserted = 0;

	try {
		for (let i = 0; i < pending.length; i += EMBED_BATCH_SIZE) {
			const batch = pending.slice(i, i + EMBED_BATCH_SIZE);
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
			markUpserted(
				manifest,
				indexName,
				payload.map((v) => v.id)
			);
			await saveVectorizeManifest(manifest, manifestPath);
			upserted += payload.length;
			onProgress?.(skipped + upserted, total, upserted);
		}
	} catch (error) {
		if (isWorkersAINeuronLimitError(error)) {
			const indexed = skipped + upserted;
			console.error(
				`Quota limit hit after checkpoint — ${indexed}/${total} indexed (${upserted} this run). ` +
					`Manifest saved; re-run to resume.`
			);
		}
		throw error;
	}

	return { upserted, skipped, indexed: skipped + upserted, total };
}
