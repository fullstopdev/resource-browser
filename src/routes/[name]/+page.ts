import { error, redirect } from '@sveltejs/kit';

import type { PageLoad } from './$types';
import type { CrdVersionsMap, ReleasesConfig } from '$lib/structure';
import { buildCatalogCrdPath } from '$lib/urlState';
import { getLatestVersion } from '$lib/versions';

import { loadStaticYaml } from '$lib/yaml/safeYaml';
import res from '$lib/resources.yaml?raw';
import releases from '$lib/releases.yaml?raw';

const crdResources = loadStaticYaml(res);
const resources = crdResources as CrdVersionsMap;
const releaseConfig = loadStaticYaml(releases) as ReleasesConfig;

export const load: PageLoad = async ({ params, url, fetch }) => {
	const name = params.name;
	const rest = name.substring(name.indexOf('.') + 1);

	const requestedRelease = url.searchParams.get('release');
	let selectedRelease = releaseConfig.releases.find((r) => r.default) ?? releaseConfig.releases[0];

	if (requestedRelease) {
		const foundRelease = releaseConfig.releases.find((r) => r.name === requestedRelease);
		if (foundRelease) {
			selectedRelease = foundRelease;
		}
	}

	const releaseFolder = selectedRelease?.folder ?? 'resources/25.8.2';

	let releaseManifest: { name: string; kind?: string; versions?: { name: string }[] }[] = [];
	try {
		const manifestResp = await fetch(`/${releaseFolder}/manifest.json`);
		if (manifestResp.ok) {
			releaseManifest = await manifestResp.json();
		}
	} catch {
		console.warn(`Could not load manifest for ${releaseFolder}`);
	}

	let crdMeta: { name: string; kind?: string; versions: { name: string }[] }[] = [];
	if (releaseManifest.length > 0) {
		const manifestEntry = releaseManifest.find((x) => x.name === name);
		if (manifestEntry) {
			crdMeta = [manifestEntry as (typeof crdMeta)[0]];
		}
	}

	if (crdMeta.length === 0) {
		crdMeta = resources[rest]?.filter((x) => x.name === name) || [];
	}

	if (crdMeta.length !== 1) {
		throw error(404, 'Invalid resource name');
	}

	const version = getLatestVersion(crdMeta[0]);
	if (!version) {
		throw error(404, 'No version available for resource');
	}

	throw redirect(
		307,
		buildCatalogCrdPath({
			release: selectedRelease.name,
			kind: crdMeta[0].kind,
			name,
			version
		})
	);
};
