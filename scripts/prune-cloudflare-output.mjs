#!/usr/bin/env node
/**
 * Remove local dev artifacts from the Cloudflare Pages build output.
 * Run after every Cloudflare build and before any direct `wrangler pages deploy`.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const outputDir = join(root, '.svelte-kit', 'cloudflare');
const PRUNE_DIRS = ['.venv', 'node_modules', '.git', '.wrangler'];
const WARN_SIZE_BYTES = 20 * 1024 * 1024;

if (!existsSync(outputDir)) {
	console.error(`Missing Cloudflare build output: ${outputDir}`);
	console.error('Run: npm run build:cloudflare');
	process.exit(1);
}

function pruneDir(dir) {
	for (const name of PRUNE_DIRS) {
		const target = join(dir, name);
		try {
			rmSync(target, { recursive: true, force: true });
		} catch {
			// ignore missing paths
		}
	}
}

function findLargeFiles(dir, base = dir, large = []) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return large;
	}
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			findLargeFiles(path, base, large);
			continue;
		}
		if (!entry.isFile()) continue;
		const { size } = statSync(path);
		if (size >= WARN_SIZE_BYTES) {
			large.push({ path: path.slice(base.length + 1), size });
		}
	}
	return large;
}

pruneDir(outputDir);

const largeFiles = findLargeFiles(outputDir);
if (largeFiles.length > 0) {
	console.error('Cloudflare build output contains files too large for Pages deploy:');
	for (const { path, size } of largeFiles) {
		console.error(`  ${path} (${(size / (1024 * 1024)).toFixed(1)} MiB)`);
	}
	process.exit(1);
}

console.log(`Pruned dev artifacts from ${outputDir}`);
