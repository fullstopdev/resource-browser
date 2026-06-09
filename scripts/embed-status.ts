/**
 * Show Vectorize embed progress: indexed / target / remaining per index.
 *
 * Usage:
 *   npm run embed:status
 *   npm run embed:status -- --full          # include dry-run chunk counts
 *   npm run embed:status -- --index eda-crd-corpus-v1
 */
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { chunkCrdYaml } from '../src/lib/ai/rag/chunkCrd';
import { chunkDocText } from '../src/lib/ai/rag/chunkDocs';
import { assertSafeFolderPath, assertSafePathSegment } from '../src/lib/yaml-validation/schemaCache';
import type { ReleasesConfig } from '../src/lib/structure';
import { getIndexVectorCount } from './lib/vectorizeEmbed';
import { loadVectorizeManifest } from './lib/vectorizeManifest';

const ROOT = process.cwd();
const STATIC_ROOT = path.join(ROOT, 'static');
const RELEASES_PATH = path.join(ROOT, 'src/lib/releases.yaml');
const DOCS_ORIGIN = 'https://docs.eda.dev';
const DEFAULT_RELEASE = '26.4';

const INDEXES = {
	'eda-crd-corpus-v1': { label: 'CRD corpus' },
	'eda-docs-v1': { label: 'EDA docs' }
} as const;

type IndexName = keyof typeof INDEXES;

function parseArgs(): { indexes: IndexName[]; full: boolean; release: string } {
	const args = process.argv.slice(2);
	let full = false;
	let release = DEFAULT_RELEASE;
	const indexes: IndexName[] = [];

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--full') full = true;
		if (args[i] === '--release' && args[i + 1]) release = args[++i];
		if (args[i] === '--index' && args[i + 1]) {
			const name = args[++i] as IndexName;
			if (name in INDEXES) indexes.push(name);
		}
	}

	return {
		indexes: indexes.length ? indexes : (Object.keys(INDEXES) as IndexName[]),
		full,
		release
	};
}

async function countCrdChunks(): Promise<number> {
	const raw = await fs.readFile(RELEASES_PATH, 'utf8');
	const config = yaml.load(raw, { schema: yaml.CORE_SCHEMA }) as ReleasesConfig;
	let total = 0;

	for (const release of config.releases) {
		const folder = assertSafeFolderPath(release.folder);
		const manifestPath = path.join(STATIC_ROOT, folder, 'manifest.json');
		let manifestRaw: string;
		try {
			manifestRaw = await fs.readFile(manifestPath, 'utf8');
		} catch {
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
				total += chunks.length;
			}
		}
	}

	return total;
}

async function countDocsChunks(release: string): Promise<number> {
	const url = `${DOCS_ORIGIN}/${release}/search/search_index.json`;
	const resp = await fetch(url, {
		headers: { Accept: 'application/json', 'User-Agent': 'eda-resource-browser/1.0 (embed-status)' }
	});
	if (!resp.ok) {
		throw new Error(`Docs search index unavailable (${resp.status})`);
	}

	const data = (await resp.json()) as { docs?: { location?: string; title?: string; text?: string }[] };
	let total = 0;

	for (const doc of data.docs ?? []) {
		const text = (doc.text ?? '').replace(/<[^>]+>/g, ' ').trim();
		if (text.length < 80) continue;
		const path = `/${release}/${(doc.location ?? '').replace(/^\/+/, '')}`;
		const chunks = chunkDocText(text, {
			source: 'eda-docs',
			release,
			path,
			title: doc.title?.trim() || 'Untitled',
			section: path.split('/').filter(Boolean)[1] || 'overview'
		});
		total += chunks.length;
	}

	return total;
}

async function main(): Promise<void> {
	const { indexes, full, release } = parseArgs();
	const manifest = await loadVectorizeManifest();

	console.log('Vectorize embed status\n');

	for (const indexName of indexes) {
		const label = INDEXES[indexName].label;
		let remoteCount = 0;
		try {
			remoteCount = await getIndexVectorCount(indexName);
		} catch (err) {
			console.log(`${label} (${indexName})`);
			console.log(`  Vectorize: unavailable (${err instanceof Error ? err.message : err})`);
			console.log(`  Manifest:  ${manifest[indexName]?.length ?? 0} ID(s) local\n`);
			continue;
		}

		const manifestCount = manifest[indexName]?.length ?? 0;
		const indexed = Math.max(remoteCount, manifestCount);

		let target: number | undefined;
		if (full) {
			try {
				target =
					indexName === 'eda-crd-corpus-v1'
						? await countCrdChunks()
						: await countDocsChunks(release);
			} catch (err) {
				console.warn(
					`  Could not count target chunks: ${err instanceof Error ? err.message : err}`
				);
			}
		}

		console.log(`${label} (${indexName})`);
		console.log(`  Indexed:   ${indexed} in Vectorize`);
		console.log(`  Manifest:  ${manifestCount} ID(s) local`);
		if (target !== undefined) {
			const remaining = Math.max(0, target - indexed);
			const pct = target > 0 ? ((indexed / target) * 100).toFixed(1) : '0.0';
			console.log(`  Target:    ${target} chunks (--full)`);
			console.log(`  Remaining: ${remaining} (${pct}% complete)`);
		} else {
			console.log(`  Target:    run with --full for chunk count`);
		}
		console.log('');
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
