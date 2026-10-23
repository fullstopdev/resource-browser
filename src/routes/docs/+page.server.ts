import { DOCS_INDEX_SLUG } from '$lib/docs/registry';
import { loadDocsPage } from '$lib/docs/loadDocsPage';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => loadDocsPage(DOCS_INDEX_SLUG);
