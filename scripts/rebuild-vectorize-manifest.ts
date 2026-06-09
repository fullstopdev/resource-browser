/**
 * Rebuild `.vectorize-manifest.json` from Vectorize index contents.
 *
 * Use when the local manifest is missing or out of sync with the remote index
 * (e.g. partial embed run, or manifest truncated to the 1000-ID list page size).
 *
 * Usage:
 *   npm run embed:rebuild-manifest
 *   npm run embed:rebuild-manifest -- --index eda-crd-corpus-v1
 *   npm run embed:rebuild-manifest -- --index eda-docs-v1
 */
import { syncManifestWithIndex } from './lib/vectorizeEmbed';
import { DEFAULT_MANIFEST_PATH, loadVectorizeManifest } from './lib/vectorizeManifest';

const DEFAULT_INDEXES = ['eda-crd-corpus-v1', 'eda-docs-v1'] as const;

function parseArgs(): string[] {
	const args = process.argv.slice(2);
	const indexes: string[] = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--index' && args[i + 1]) indexes.push(args[++i]);
	}
	return indexes.length ? indexes : [...DEFAULT_INDEXES];
}

async function main(): Promise<void> {
	const indexes = parseArgs();
	const manifest = await loadVectorizeManifest();

	for (const indexName of indexes) {
		const { remoteCount } = await syncManifestWithIndex(indexName, manifest);
		console.log(`  Recorded ${remoteCount} vector ID(s)`);
	}

	console.log(`\nWrote ${DEFAULT_MANIFEST_PATH}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
