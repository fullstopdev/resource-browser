import { canonicalSiteOrigin, renderSitemapIndexXml } from '$lib/seo/renderSitemap';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const origin = canonicalSiteOrigin(url.origin);
	const now = new Date().toISOString().split('T')[0];
	const body = renderSitemapIndexXml(origin, [
		{ loc: '/sitemaps/pages.xml', lastmod: now },
		{ loc: '/sitemaps/crds.xml', lastmod: now }
	]);

	return new Response(body, {
		headers: {
			'Content-Type': 'application/xml; charset=UTF-8',
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
