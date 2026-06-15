import { loadStaticYaml } from '$lib/yaml/safeYaml';
import resourcesYaml from '$lib/resources.yaml?raw';
import type { PageLoad } from './$types';

const staticPaths = [
	'/',
	'/sitemap',
	'/spec-search',
	'/spec-search-auto',
	'/comparison',
	'/validate-yaml',
	'/dependency-map',
	'/release-notes'
];

export const prerender = true;

export const load: PageLoad = async () => {
	const resources = loadStaticYaml(resourcesYaml) as Record<
		string,
		Array<{ name: string; versions: Array<{ name: string }> }>
	>;

	const groupedResources = Object.entries(resources)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([group, items]) => ({
			group,
			resources: items
				.slice()
				.sort((a, b) => a.name.localeCompare(b.name))
				.map((resource) => ({
					name: resource.name,
					versions: resource.versions.map((version) => version.name).sort()
				}))
		}));

	return {
		staticPages: staticPaths,
		groupedResources
	};
};
