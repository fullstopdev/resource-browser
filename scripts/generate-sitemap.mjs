import fs from 'fs/promises';
import yaml from 'js-yaml';
import path from 'path';

const outputPath = process.env.SITEMAP_OUTPUT || 'src/lib/seo/sitemapUrls.generated.json';
const releasesPath = 'src/lib/releases.yaml';

const staticRoutes = [
	{ loc: '/', priority: '1.0' },
	{ loc: '/sitemap', priority: '0.8' },
	{ loc: '/spec-search', priority: '0.7' },
	{ loc: '/spec-search-auto', priority: '0.7' },
	{ loc: '/comparison', priority: '0.7' },
	{ loc: '/validate-yaml', priority: '0.7' },
	{ loc: '/dependency-map', priority: '0.7' },
	{ loc: '/release-notes', priority: '0.7' }
];

const main = async () => {
	const rawReleases = await fs.readFile(releasesPath, 'utf8');
	const releaseConfig = yaml.load(rawReleases, { schema: yaml.CORE_SCHEMA });
	const now = new Date().toISOString().split('T')[0];

	if (!releaseConfig || typeof releaseConfig !== 'object' || !Array.isArray(releaseConfig.releases)) {
		throw new Error('releases.yaml did not parse as expected');
	}

	/** @type {Array<{ loc: string; lastmod: string; changefreq: 'monthly'; priority: string }>} */
	const entries = staticRoutes.map((route) => ({
		loc: route.loc,
		lastmod: now,
		changefreq: 'monthly',
		priority: route.priority
	}));

	for (const release of releaseConfig.releases) {
		if (!release?.name || !release?.folder) continue;

		const manifestPath = path.join('static', release.folder, 'manifest.json');
		let manifestRaw;
		try {
			manifestRaw = await fs.readFile(manifestPath, 'utf8');
		} catch {
			console.warn(`Skipping release ${release.name}: could not read ${manifestPath}`);
			continue;
		}

		let manifest;
		try {
			manifest = JSON.parse(manifestRaw);
		} catch {
			console.warn(`Skipping release ${release.name}: invalid JSON in ${manifestPath}`);
			continue;
		}

		const releaseParam = release.default ? '' : `?release=${encodeURIComponent(release.name)}`;

		if (!Array.isArray(manifest)) continue;

		for (const entry of manifest) {
			if (!entry?.name || !Array.isArray(entry.versions)) continue;
			for (const version of entry.versions) {
				if (!version?.name) continue;
				entries.push({
					loc: `/${entry.name}/${version.name}${releaseParam}`,
					lastmod: now,
					changefreq: 'monthly',
					priority: '0.6'
				});
			}
		}
	}

	entries.sort((a, b) => a.loc.localeCompare(b.loc));

	const payload = {
		generatedAt: now,
		entries
	};

	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
	console.log(`Wrote ${entries.length} sitemap entries to ${outputPath}`);
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
