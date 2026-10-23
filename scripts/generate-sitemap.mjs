import fs from 'fs/promises';
import yaml from 'js-yaml';

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
	{ loc: '/release-changes', priority: '0.7' }
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

/** Mirrors pickLatestApiVersion in src/lib/versions.ts: newest non-deprecated apiVersion. */
const versionRank = (name) => {
	const m = /^v(\d+)(?:(alpha|beta)(\d+)?)?$/.exec(name || '');
	if (!m) return [-1, -1, -1];
	return [Number(m[1]), m[2] === 'alpha' ? 1 : m[2] === 'beta' ? 2 : 3, Number(m[3] || 0)];
};

const latestVersion = (versions) =>
	versions
		.filter((v) => v?.name && !v.deprecated)
		.map((v) => v.name)
		.sort((a, b) => {
			const [ra, rb] = [versionRank(a), versionRank(b)];
			return rb[0] - ra[0] || rb[1] - ra[1] || rb[2] - ra[2] || b.localeCompare(a);
		})[0];

/**
 * One catalog URL per CRD in the default release. Must match the canonical built in
 * src/routes/+page.svelte (`/?release=…&crd=…&version=…`). Kinds shared by several API
 * groups use the manifest FQDN so each URL resolves to exactly one CRD.
 */
const crdRoutes = async () => {
	const releases = yaml.load(await fs.readFile('src/lib/releases.yaml', 'utf8'));
	const release = releases.releases.find((r) => r.default) ?? releases.releases[0];
	const manifest = JSON.parse(await fs.readFile(`static/${release.folder}/manifest.json`, 'utf8'));

	const kindCount = new Map();
	for (const entry of manifest) {
		if (entry.kind) kindCount.set(entry.kind, (kindCount.get(entry.kind) ?? 0) + 1);
	}

	return manifest
		.filter((entry) => entry.name && entry.versions?.length)
		.map((entry) => {
			const crd = entry.kind && kindCount.get(entry.kind) === 1 ? entry.kind : entry.name;
			const params = new URLSearchParams({ release: release.name, crd });
			const version = latestVersion(entry.versions);
			if (version) params.set('version', version);
			return { loc: `/?${params}`, priority: '0.6' };
		});
};

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
	const entries = [...staticRoutes, ...(await crdRoutes())].map((route) => ({
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
