import { canonicalSiteOrigin } from '$lib/seo/renderSitemap';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const origin = canonicalSiteOrigin(url.origin);
	const body = `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`;

	return new Response(body, {
		headers: {
			'Content-Type': 'text/plain; charset=UTF-8',
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
