#!/usr/bin/env node
/**
 * Remove dev-only artifacts from static/ before SvelteKit copies them into the build.
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const staticVenv = join(root, 'static', '.venv');
const openApiUnlabeled = join(root, 'static', 'openapi', 'unlabeled');

if (existsSync(staticVenv)) {
	console.warn('Removing static/.venv (local Python venv must not be deployed).');
	rmSync(staticVenv, { recursive: true, force: true });
}

if (existsSync(openApiUnlabeled)) {
	console.warn('Removing static/openapi/unlabeled (accidental sync without RELEASE=).');
	rmSync(openApiUnlabeled, { recursive: true, force: true });
}
