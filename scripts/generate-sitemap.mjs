import fs from 'fs/promises';

const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.SITE_URL || 'https://eda-resource-browser.pages.dev').replace(
	/\/$/,
	''
);

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

const absoluteLoc = (loc) => `${siteUrl}${loc.startsWith('/') ? loc : `/${loc}`}`;

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

const main = async () => {
	const now = new Date().toISOString().split('T')[0];
	const entries = staticRoutes.map((route) => ({
		loc: route.loc,
		lastmod: now,
		changefreq: 'monthly',
		priority: route.priority
	}));

	const robots = [`User-agent: *`, `Allow: /`, `Sitemap: ${siteUrl}/sitemap.xml`, ``].join('\n');

	await fs.writeFile('static/robots.txt', robots, 'utf8');
	await fs.writeFile('static/sitemap.xml', formatUrlset(entries), 'utf8');

	console.log(`Wrote static sitemap for ${siteUrl} (${entries.length} urls)`);
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
