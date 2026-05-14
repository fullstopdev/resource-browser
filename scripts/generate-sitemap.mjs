import fs from 'fs/promises';
import yaml from 'js-yaml';
import path from 'path';

const siteUrl = process.env.SITE_URL || 'https://resource-browser-92y.pages.dev';
const outputPath = process.env.SITEMAP_OUTPUT || 'static/sitemap.xml';
const resourcesPath = 'src/lib/resources.yaml';

const staticRoutes = [
	'/',
	'/sitemap',
	'/spec-search',
	'/spec-search-auto',
	'/comparison',
	'/uploads',
	'/validate-yaml'
];

const priorityForPath = (path) => {
	if (path === '/') return '1.0';
	if (path === '/sitemap') return '0.8';
	return '0.7';
};

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

const formatUrl = ({ loc, lastmod, changefreq, priority }) => {
	return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
};

const main = async () => {
	const raw = await fs.readFile(resourcesPath, 'utf8');
	const resources = yaml.load(raw);
	const now = new Date().toISOString().split('T')[0];

	const urls = []; 

	for (const route of staticRoutes) {
		urls.push({
			loc: `${siteUrl}${route}`,
			lastmod: now,
			changefreq: 'monthly',
			priority: priorityForPath(route)
		});
	}

	if (typeof resources !== 'object' || resources === null) {
		throw new Error('resources.yaml did not parse as an object');
	}

	for (const group of Object.values(resources)) {
		if (!Array.isArray(group)) continue;
		for (const resource of group) {
			if (!resource || !resource.name || !Array.isArray(resource.versions)) continue;
			for (const version of resource.versions) {
				if (!version || !version.name) continue;
				urls.push({
					loc: `${siteUrl}/${resource.name}/${version.name}`,
					lastmod: now,
					changefreq: 'monthly',
					priority: '0.6'
				});
			}
		}
	}

	urls.sort((a, b) => a.loc.localeCompare(b.loc));

	const xml = [`<?xml version="1.0" encoding="UTF-8"?>`, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`, ...urls.map(formatUrl), `</urlset>`].join('\n');

	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await fs.writeFile(outputPath, xml + '\n', 'utf8');
	console.log(`Wrote ${urls.length} urls to ${outputPath}`);
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
