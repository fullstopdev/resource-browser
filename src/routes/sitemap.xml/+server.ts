import yaml from 'js-yaml';
import resourcesYaml from '$lib/resources.yaml?raw';
import type { RequestHandler } from './$types';

const staticPaths = ['/', '/spec-search', '/spec-search-auto', '/comparison', '/uploads', '/validate-yaml'];

function escapeXml(value: string) {
	return value.replace(/[<>&"']/g, (char) => {
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
}

export const GET: RequestHandler = async ({ url }) => {
	const origin = url.origin.replace(/\/$/, '');
	const resources = yaml.load(resourcesYaml) as Record<
		string,
		Array<{ name: string; versions: Array<{ name: string }> }>
	>;

	const urls = [
		...staticPaths.map((path) => ({ loc: `${origin}${path}`, priority: path === '/' ? '1.0' : '0.7' })),
		...Object.values(resources).flatMap((group) =>
			group.flatMap((resource) =>
				resource.versions.map((version) => ({
					loc: `${origin}/${resource.name}/${version.name}`,
					priority: '0.6'
				}))
			)
		)
	];

	const body = `<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
		urls
			.map(
				(url) =>
					`  <url>\n    <loc>${escapeXml(url.loc)}</loc>\n    <priority>${url.priority}</priority>\n  </url>`
			)
			.join('\n') +
		`\n</urlset>`;

	return new Response(body, {
		headers: {
			'Content-Type': 'application/xml; charset=UTF-8'
		}
	});
};
