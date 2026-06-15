export type SitemapEntry = {
	loc: string;
	lastmod: string;
	changefreq: 'monthly' | 'weekly' | 'daily';
	priority: string;
};

export type SitemapUrlData = {
	generatedAt: string;
	entries: SitemapEntry[];
};

function escapeXml(value: string): string {
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

/** Render a sitemap XML document for the given site origin. */
export function renderSitemapXml(origin: string, data: SitemapUrlData): string {
	const base = origin.replace(/\/$/, '');

	return (
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
		data.entries
			.map((entry) => {
				const loc = entry.loc.startsWith('http') ? entry.loc : `${base}${entry.loc}`;
				return (
					`  <url>\n` +
					`    <loc>${escapeXml(loc)}</loc>\n` +
					`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>\n` +
					`    <changefreq>${escapeXml(entry.changefreq)}</changefreq>\n` +
					`    <priority>${escapeXml(entry.priority)}</priority>\n` +
					`  </url>`
				);
			})
			.join('\n') +
		`\n</urlset>`
	);
}
