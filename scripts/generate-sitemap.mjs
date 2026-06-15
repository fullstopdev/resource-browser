import fs from 'fs/promises';
import yaml from 'js-yaml';
import path from 'path';

const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.SITE_URL || 'https://eda-resource-browser.pages.dev').replace(
	/\/$/,
	''
);
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

const escapeXml = (value) =>
	value.replace(/[<>&"']/g, (char) => {
		switch (char) {
			case '<':
				return '&lt;';
			case '>':
				return '&gt;';
			case '&':
				return '&amp;';
			case '"':
				return '&quot;';
			case "'":
				return '&apos;';
			default:
				return char;
		}
	});

const absoluteLoc = (loc) => {
	if (loc.startsWith('http://') || loc.startsWith('https://')) return loc;
	return `${siteUrl}${loc.startsWith('/') ? loc : `/${loc}`}`;
};

const formatUrlset = (entries) =>
	[
		`<?xml version="1.0" encoding="UTF-8"?>`,
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
		...entries.map(
			(entry) =>
				`  <url>\n    <loc>${escapeXml(absoluteLoc(entry.loc))}</loc>\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>\n    <changefreq>${escapeXml(entry.changefreq)}</changefreq>\n    <priority>${escapeXml(entry.priority)}</priority>\n  </url>`
		),
		`</urlset>`,
		''
	].join('\n');

const formatSitemapIndex = (entries) =>
	[
		`<?xml version="1.0" encoding="UTF-8"?>`,
		`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
		...entries.map(
			(entry) =>
				`  <sitemap>\n    <loc>${escapeXml(absoluteLoc(entry.loc))}</loc>\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>\n  </sitemap>`
		),
		`</sitemapindex>`,
		''
	].join('\n');

const main = async () => {
	const rawReleases = await fs.readFile(releasesPath, 'utf8');
	const releaseConfig = yaml.load(rawReleases, { schema: yaml.CORE_SCHEMA });
	const now = new Date().toISOString().split('T')[0];

	if (!releaseConfig || typeof releaseConfig !== 'object' || !Array.isArray(releaseConfig.releases)) {
		throw new Error('releases.yaml did not parse as expected');
	}

	const pageEntries = staticRoutes.map((route) => ({
		loc: route.loc,
		lastmod: now,
		changefreq: 'monthly',
		priority: route.priority
	}));

	const defaultRelease =
		releaseConfig.releases.find((release) => release?.default) ?? releaseConfig.releases[0];

	const crdEntries = [];
	if (defaultRelease?.folder) {
		const manifestPath = path.join('static', defaultRelease.folder, 'manifest.json');
		try {
			const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
			if (Array.isArray(manifest)) {
				for (const entry of manifest) {
					if (!entry?.name || !Array.isArray(entry.versions)) continue;
					for (const version of entry.versions) {
						if (!version?.name) continue;
						crdEntries.push({
							loc: `/${entry.name}/${version.name}`,
							lastmod: now,
							changefreq: 'monthly',
							priority: '0.6'
						});
					}
				}
			}
		} catch (error) {
			console.warn(`Could not read default release manifest for sitemap: ${manifestPath}`, error);
		}
	}

	crdEntries.sort((a, b) => a.loc.localeCompare(b.loc));

	const robots = [`User-agent: *`, `Allow: /`, `Sitemap: ${siteUrl}/sitemap.xml`, ``].join('\n');
	const sitemapIndex = formatSitemapIndex([
		{ loc: '/sitemaps/pages.xml', lastmod: now },
		{ loc: '/sitemaps/crds.xml', lastmod: now }
	]);

	await fs.mkdir('static/sitemaps', { recursive: true });
	await fs.writeFile('static/robots.txt', robots, 'utf8');
	await fs.writeFile('static/sitemap.xml', sitemapIndex, 'utf8');
	await fs.writeFile('static/sitemaps/pages.xml', formatUrlset(pageEntries), 'utf8');
	await fs.writeFile('static/sitemaps/crds.xml', formatUrlset(crdEntries), 'utf8');

	console.log(`Wrote SEO files for ${siteUrl}`);
	console.log(`  pages: ${pageEntries.length} urls`);
	console.log(`  crds:  ${crdEntries.length} urls (default release only)`);
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
