#!/usr/bin/env node
/**
 * Remove dev-only artifacts from static/ before SvelteKit copies them into the build.
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const staticVenv = join(root, 'static', '.venv');

if (existsSync(staticVenv)) {
	console.warn('Removing static/.venv (local Python venv must not be deployed).');
	rmSync(staticVenv, { recursive: true, force: true });
}
