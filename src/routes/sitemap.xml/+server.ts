import sitemapData from '$lib/seo/sitemapUrls.generated.json';
import { renderSitemapXml, type SitemapUrlData } from '$lib/seo/renderSitemap';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const origin = url.origin.replace(/\/$/, '');
	const body = renderSitemapXml(origin, sitemapData as SitemapUrlData);

	return new Response(body, {
		headers: {
			'Content-Type': 'application/xml; charset=UTF-8',
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
