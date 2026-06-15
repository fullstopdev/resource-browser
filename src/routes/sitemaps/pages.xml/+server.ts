import { canonicalSiteOrigin, renderSitemapXml } from '$lib/seo/renderSitemap';
import type { RequestHandler } from './$types';

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

export const GET: RequestHandler = async ({ url }) => {
	const origin = canonicalSiteOrigin(url.origin);
	const now = new Date().toISOString().split('T')[0];
	const body = renderSitemapXml(origin, {
		generatedAt: now,
		entries: staticRoutes.map((route) => ({
			loc: route.loc,
			lastmod: now,
			changefreq: 'monthly',
			priority: route.priority
		}))
	});

	return new Response(body, {
		headers: {
			'Content-Type': 'application/xml; charset=UTF-8',
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
