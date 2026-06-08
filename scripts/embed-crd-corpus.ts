/**
 * Embed CRD corpus into Cloudflare Vectorize for RAG.
 *
 * Prerequisites:
 *   1. Create index once:
 *      wrangler vectorize create eda-crd-corpus-v1 --dimensions=768 --metric=cosine \
 *        --metadata-index=release --metadata-index=kind --metadata-index=group --metadata-index=chunkType
 *   2. export CLOUDFLARE_API_TOKEN=...  (Workers AI + Vectorize permissions)
 *   3. export CLOUDFLARE_ACCOUNT_ID=...  (or rely on wrangler whoami)
 *
 * Usage:
 *   npm run embed:crd-corpus
 *   npm run embed:crd-corpus -- --release 26.4.2
 *   npm run embed:crd-corpus -- --dry-run
 */
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { chunkCrdYaml } from '../src/lib/ai/rag/chunkCrd';
import { EMBEDDING_MODEL, type CrdChunk } from '../src/lib/ai/rag/chunkTypes';
import { assertSafeFolderPath, assertSafePathSegment } from '../src/lib/yaml-validation/schemaCache';
import { embedAndUpsert } from './lib/vectorizeEmbed';
import type { ReleasesConfig } from '../src/lib/structure';

const ROOT = process.cwd();
const STATIC_ROOT = path.join(ROOT, 'static');
const RELEASES_PATH = path.join(ROOT, 'src/lib/releases.yaml');
const INDEX_NAME = 'eda-crd-corpus-v1';
function parseArgs(): { release?: string; dryRun: boolean } {
	const args = process.argv.slice(2);
	let release: string | undefined;
	let dryRun = false;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--release' && args[i + 1]) release = args[++i];
		if (args[i] === '--dry-run') dryRun = true;
	}
	return { release, dryRun };
}

async function collectChunks(releaseFilter?: string): Promise<CrdChunk[]> {
	const raw = await fs.readFile(RELEASES_PATH, 'utf8');
	const config = yaml.load(raw, { schema: yaml.CORE_SCHEMA }) as ReleasesConfig;
	const releases = config.releases.filter((r) => !releaseFilter || r.name === releaseFilter);
	const allChunks: CrdChunk[] = [];

	for (const release of releases) {
		const folder = assertSafeFolderPath(release.folder);
		const manifestPath = path.join(STATIC_ROOT, folder, 'manifest.json');
		let manifestRaw: string;
		try {
			manifestRaw = await fs.readFile(manifestPath, 'utf8');
		} catch {
			console.warn(`Skipping ${release.name}: manifest not found at ${manifestPath}`);
			continue;
		}

		const manifest = JSON.parse(manifestRaw) as {
			name: string;
			kind?: string;
			group?: string;
			versions?: { name: string }[];
		}[];

		for (const entry of manifest) {
			if (!entry.name || !entry.kind || !entry.group) continue;
			for (const ver of entry.versions ?? []) {
				if (!ver?.name) continue;
				const version = assertSafePathSegment(ver.name, 'version');
				const resourceName = assertSafePathSegment(entry.name, 'resourceName');
				const yamlPath = path.join(STATIC_ROOT, folder, resourceName, `${version}.yaml`);
				let yamlText: string;
				try {
					yamlText = await fs.readFile(yamlPath, 'utf8');
				} catch {
					continue;
				}

				const chunks = chunkCrdYaml(yamlText, {
					release: release.name,
					kind: entry.kind,
					group: entry.group,
					version,
					path: `/${folder}/${resourceName}/${version}.yaml`
				});
				allChunks.push(...chunks);
			}
		}

		console.log(`  ${release.name}: ${allChunks.length} chunks so far`);
	}

	return allChunks;
}

async function main(): Promise<void> {
	const { release, dryRun } = parseArgs();
	console.log(`Collecting CRD chunks${release ? ` for ${release}` : ''}...`);
	const chunks = await collectChunks(release);
	console.log(`Total chunks: ${chunks.length}`);

	if (dryRun) {
		console.log('Dry run — sample chunk ids:', chunks.slice(0, 5).map((c) => c.id));
		return;
	}

	if (!chunks.length) {
		console.log('No chunks to embed.');
		return;
	}

	console.log(`Embedding with ${EMBEDDING_MODEL}...`);
	const records = chunks.map((chunk) => ({
		id: chunk.id,
		text: chunk.text,
		metadata: {
			release: chunk.metadata.release,
			kind: chunk.metadata.kind,
			group: chunk.metadata.group,
			version: chunk.metadata.version,
			path: chunk.metadata.path,
			chunkType: chunk.metadata.chunkType,
			...(chunk.metadata.fieldPath ? { fieldPath: chunk.metadata.fieldPath } : {})
		}
	}));

	const upserted = await embedAndUpsert(INDEX_NAME, records, (done, total) => {
		console.log(`  Upserted ${done}/${total}`);
	});

	console.log(`Done — upserted ${upserted} vectors into ${INDEX_NAME}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
