#!/usr/bin/env node
/**
 * Deploy Cloudflare Pages without Workers AI / Vectorize / KV bindings.
 * Restores wrangler.toml after deploy (success or failure).
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const mainToml = join(root, 'wrangler.toml');
const leanToml = join(root, 'wrangler.lean.toml');
const backupToml = join(root, 'wrangler.toml.deploy-backup');

if (!existsSync(leanToml)) {
	console.error('Missing wrangler.lean.toml');
	process.exit(1);
}

copyFileSync(mainToml, backupToml);
copyFileSync(leanToml, mainToml);

const wranglerBin = join(root, 'node_modules', '.bin', 'wrangler');

const prune = spawnSync('node', ['scripts/prune-cloudflare-output.mjs'], {
	cwd: root,
	stdio: 'inherit',
	env: process.env
});
if (prune.status !== 0) {
	renameSync(backupToml, mainToml);
	process.exit(prune.status ?? 1);
}

const deploy = spawnSync(
	wranglerBin,
	['pages', 'deploy', '.svelte-kit/cloudflare', '--project-name=eda-resource-browser'],
	{ cwd: root, stdio: 'inherit', env: process.env }
);

renameSync(backupToml, mainToml);

process.exit(deploy.status ?? 1);
