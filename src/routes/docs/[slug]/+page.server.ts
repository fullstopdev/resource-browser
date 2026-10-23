import { error } from '@sveltejs/kit';
import { DOCS_INDEX_SLUG, docsPages } from '$lib/docs/registry';
import { loadDocsPage } from '$lib/docs/loadDocsPage';
import type { EntryGenerator, PageServerLoad } from './$types';

export const entries: EntryGenerator = () =>
	docsPages.filter((p) => p.slug !== DOCS_INDEX_SLUG).map((p) => ({ slug: p.slug }));

export const load: PageServerLoad = ({ params }) => {
	// The overview lives at /docs only, so there is a single URL per page.
	if (params.slug === DOCS_INDEX_SLUG) throw error(404, 'Documentation page not found');
	return loadDocsPage(params.slug);
};
