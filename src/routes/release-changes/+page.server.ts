import { readFile } from 'fs/promises';
import { join } from 'path';
import {
	indexFromHistory,
	normalizeReleaseNotesEntry,
	type ReleaseNotesBundle
} from '$lib/release-notes/loadStatic';
import type { PageServerLoad } from './$types';

export const prerender = true;

async function readBundleFromDisk(): Promise<ReleaseNotesBundle | null> {
	try {
		const bundlePath = join(process.cwd(), 'static/release-notes/bundle.json');
		const raw = await readFile(bundlePath, 'utf8');
		return JSON.parse(raw) as ReleaseNotesBundle;
	} catch {
		return null;
	}
}

export const load: PageServerLoad = async () => {
	const bundle = await readBundleFromDisk();
	if (!bundle?.entries?.length) {
		return {
			index: null,
			releaseHistory: [],
			error: 'Release changes not found — run npm run generate:release-notes'
		};
	}

	const releaseHistory = bundle.entries
		.map(normalizeReleaseNotesEntry)
		.sort((a, b) => b.toVer.localeCompare(a.toVer, undefined, { numeric: true }));

	return {
		index: indexFromHistory(bundle.generatedAt, bundle.latest, releaseHistory),
		releaseHistory,
		error: null
	};
};
