import { describe, expect, it } from 'vitest';
import { canonicalSiteOrigin, renderSitemapIndexXml, renderSitemapXml } from './renderSitemap';

describe('renderSitemapXml', () => {
	it('renders absolute URLs using the request origin', () => {
		const xml = renderSitemapXml('https://example.com', {
			generatedAt: '2026-06-15',
			entries: [
				{
					loc: '/',
					lastmod: '2026-06-15',
					changefreq: 'monthly',
					priority: '1.0'
				},
				{
					loc: '/comparison',
					lastmod: '2026-06-15',
					changefreq: 'monthly',
					priority: '0.7'
				}
			]
		});

		expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
		expect(xml).toContain('<loc>https://example.com/</loc>');
		expect(xml).toContain('<loc>https://example.com/comparison</loc>');
	});

	it('escapes XML entities in URLs', () => {
		const xml = renderSitemapXml('https://example.com', {
			generatedAt: '2026-06-15',
			entries: [
				{
					loc: '/foo?release=25.12.1&view=1',
					lastmod: '2026-06-15',
					changefreq: 'monthly',
					priority: '0.6'
				}
			]
		});

		expect(xml).toContain('&amp;');
		expect(xml).not.toContain('release=25.12.1&view');
	});
});

describe('renderSitemapIndexXml', () => {
	it('renders a sitemap index with child sitemap URLs', () => {
		const xml = renderSitemapIndexXml('https://example.com', [
			{ loc: '/sitemaps/pages.xml', lastmod: '2026-06-15' },
			{ loc: '/sitemaps/crds.xml', lastmod: '2026-06-15' }
		]);

		expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
		expect(xml).toContain('<loc>https://example.com/sitemaps/pages.xml</loc>');
		expect(xml).toContain('<loc>https://example.com/sitemaps/crds.xml</loc>');
	});
});

describe('canonicalSiteOrigin', () => {
	it('prefers PUBLIC_SITE_URL when configured', () => {
		const previous = process.env.PUBLIC_SITE_URL;
		process.env.PUBLIC_SITE_URL = 'https://eda-resource-browser.pages.dev';
		expect(canonicalSiteOrigin('https://preview.pages.dev')).toBe(
			'https://eda-resource-browser.pages.dev'
		);
		process.env.PUBLIC_SITE_URL = previous;
	});
});
