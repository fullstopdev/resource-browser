import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	DOCS_INDEX_SLUG,
	docsHref,
	docsNav,
	docsPages,
	getDocsPage,
	parseDocsPage
} from './registry';
import { renderDocs } from './render';

const validHrefs = new Set(docsPages.map((p) => docsHref(p.slug)));

describe('docs registry', () => {
	it('has an overview page and pages in both sections', () => {
		expect(getDocsPage(DOCS_INDEX_SLUG)).toBeDefined();
		const nav = docsNav();
		expect(nav.map((g) => g.section)).toEqual(['Guide', 'Developer']);
		for (const group of nav) expect(group.pages.length).toBeGreaterThan(0);
	});

	it('gives every page a title, description and unique slug', () => {
		const slugs = docsPages.map((p) => p.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
		for (const page of docsPages) {
			expect(page.slug).toMatch(/^[a-z0-9-]+$/);
			expect(page.title.length).toBeGreaterThan(3);
			expect(page.description.length).toBeGreaterThan(20);
			expect(page.body.trim().length).toBeGreaterThan(100);
		}
	});

	it('rejects pages without valid frontmatter', () => {
		expect(() => parseDocsPage('x', '# no frontmatter')).toThrow(/frontmatter/);
		expect(() =>
			parseDocsPage('x', '---\ntitle: T\ndescription: D\nsection: Other\n---\nbody')
		).toThrow(/section/);
	});

	it.each(docsPages.map((p) => [p.slug, p]))('%s: internal links and images resolve', (_, page) => {
		const { html } = renderDocs(page.body);
		for (const [, href] of html.matchAll(/href="(\/docs[^"#]*)/g)) {
			expect(validHrefs, `broken docs link ${href}`).toContain(href);
		}
		for (const [, src] of html.matchAll(/<img[^>]+src="([^"]+)"/g)) {
			expect(existsSync(`static${src}`), `missing image ${src}`).toBe(true);
		}
		expect(html, 'unrewritten .md link').not.toMatch(/href="[^"]*\.md(#[^"]*)?"/);
	});

	it.each(docsPages.map((p) => [p.slug, p]))('%s: contains no secrets', (_, page) => {
		expect(page.body).not.toMatch(/cfut_[A-Za-z0-9]/);
		expect(page.body).not.toMatch(/\b[0-9a-f]{32}\b/);
		expect(page.body).not.toMatch(/\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
		expect(page.body).not.toMatch(/Bearer [A-Za-z0-9_-]{16,}/);
	});
});

describe('renderDocs', () => {
	it('turns mermaid blocks into escaped, re-renderable nodes', () => {
		const { html } = renderDocs('```mermaid\nflowchart LR\n  A["<b>x</b>"] --> B\n```\n');
		expect(html).toContain('<pre class="mermaid" data-src="flowchart LR');
		expect(html).not.toContain('<b>x</b>');
		expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
	});

	it('escapes code blocks and builds a table of contents', () => {
		const { html, toc } = renderDocs(
			'## First\n\n### Sub part\n\n## First\n\n```js\n<script>\n```\n'
		);
		expect(toc).toEqual([
			{ id: 'first', text: 'First', depth: 2 },
			{ id: 'sub-part', text: 'Sub part', depth: 3 },
			{ id: 'first-1', text: 'First', depth: 2 }
		]);
		expect(html).toContain('&lt;script&gt;');
		expect(html).not.toContain('<script>');
	});

	it('rewrites .md links, marks external links and renders callouts and tables', () => {
		const { html } = renderDocs(
			'[a](catalog.md#x) [b](index.md) [c](https://example.com)\n\n> [!TIP]\n> Hello\n\n| a |\n|---|\n| 1 |\n'
		);
		expect(html).toContain('href="/docs/catalog#x"');
		expect(html).toContain('href="/docs"');
		expect(html).toContain('href="https://example.com" target="_blank" rel="noopener noreferrer"');
		expect(html).toContain('docs-callout docs-callout-tip');
		expect(html).toContain('<div class="docs-table-wrap"><table>');
	});
});
