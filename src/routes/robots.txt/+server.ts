import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const origin = url.origin.replace(/\/$/, '');
	const body = `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`;

	return new Response(body, {
		headers: {
			'Content-Type': 'text/plain; charset=UTF-8'
		}
	});
};
