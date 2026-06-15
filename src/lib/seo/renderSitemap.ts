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

export type SitemapIndexEntry = {
	loc: string;
	lastmod: string;
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

function absoluteLoc(origin: string, loc: string): string {
	if (loc.startsWith('http://') || loc.startsWith('https://')) return loc;
	const base = origin.replace(/\/$/, '');
	return `${base}${loc.startsWith('/') ? loc : `/${loc}`}`;
}

/** Render a urlset sitemap XML document. */
export function renderSitemapXml(origin: string, data: SitemapUrlData): string {
	return (
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
		data.entries
			.map((entry) => {
				const loc = absoluteLoc(origin, entry.loc);
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
		`\n</urlset>\n`
	);
}

/** Render a sitemap index that points at child sitemap files. */
export function renderSitemapIndexXml(origin: string, entries: SitemapIndexEntry[]): string {
	return (
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
		entries
			.map((entry) => {
				const loc = absoluteLoc(origin, entry.loc);
				return (
					`  <sitemap>\n` +
					`    <loc>${escapeXml(loc)}</loc>\n` +
					`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>\n` +
					`  </sitemap>`
				);
			})
			.join('\n') +
		`\n</sitemapindex>\n`
	);
}

/** Canonical public site origin for SEO artifacts. */
export function canonicalSiteOrigin(requestOrigin: string): string {
	const configured =
		typeof process !== 'undefined' && process.env.PUBLIC_SITE_URL
			? process.env.PUBLIC_SITE_URL
			: typeof import.meta !== 'undefined' && import.meta.env?.PUBLIC_SITE_URL
				? String(import.meta.env.PUBLIC_SITE_URL)
				: '';

	return (configured || requestOrigin).replace(/\/$/, '');
}
