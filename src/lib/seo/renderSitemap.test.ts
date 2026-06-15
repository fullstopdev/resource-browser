import { describe, expect, it } from 'vitest';
import { renderSitemapXml } from './renderSitemap';

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
