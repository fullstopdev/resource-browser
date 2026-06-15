import { canonicalSiteOrigin, renderSitemapXml } from '$lib/seo/renderSitemap';
import { loadStaticYaml } from '$lib/yaml/safeYaml';
import releasesYaml from '$lib/releases.yaml?raw';
import type { ReleasesConfig } from '$lib/structure';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, fetch }) => {
	const origin = canonicalSiteOrigin(url.origin);
	const now = new Date().toISOString().split('T')[0];
	const releaseConfig = loadStaticYaml(releasesYaml) as ReleasesConfig;
	const defaultRelease =
		releaseConfig.releases.find((release) => release.default) ?? releaseConfig.releases[0];

	const entries: Array<{
		loc: string;
		lastmod: string;
		changefreq: 'monthly';
		priority: string;
	}> = [];

	if (defaultRelease?.folder) {
		try {
			const manifestResp = await fetch(`/${defaultRelease.folder}/manifest.json`);
			if (manifestResp.ok) {
				const manifest = (await manifestResp.json()) as Array<{
					name: string;
					versions?: Array<{ name: string }>;
				}>;
				for (const entry of manifest) {
					if (!entry?.name || !Array.isArray(entry.versions)) continue;
					for (const version of entry.versions) {
						if (!version?.name) continue;
						entries.push({
							loc: `/${entry.name}/${version.name}`,
							lastmod: now,
							changefreq: 'monthly',
							priority: '0.6'
						});
					}
				}
			}
		} catch {
			// Fall back to an empty CRD sitemap if manifest cannot be loaded.
		}
	}

	entries.sort((a, b) => a.loc.localeCompare(b.loc));

	const body = renderSitemapXml(origin, {
		generatedAt: now,
		entries
	});

	return new Response(body, {
		headers: {
			'Content-Type': 'application/xml; charset=UTF-8',
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
