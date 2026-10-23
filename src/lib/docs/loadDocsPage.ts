import { error } from '@sveltejs/kit';
import { docsHref, docsPages, getDocsPage } from './registry';
import { renderDocs } from './render';

/** Server-side load shared by `/docs` and `/docs/[slug]`: rendered HTML plus prev/next links. */
export function loadDocsPage(slug: string) {
	const page = getDocsPage(slug);
	if (!page) throw error(404, 'Documentation page not found');

	const { html, toc } = renderDocs(page.body);
	const index = docsPages.indexOf(page);
	const link = (p: (typeof docsPages)[number] | undefined) =>
		p ? { href: docsHref(p.slug), title: p.title } : null;

	return {
		slug: page.slug,
		title: page.title,
		description: page.description,
		section: page.section,
		html,
		toc,
		prev: link(docsPages[index - 1]),
		next: link(docsPages[index + 1])
	};
}
