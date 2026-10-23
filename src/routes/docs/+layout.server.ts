import { docsNav } from '$lib/docs/registry';
import type { LayoutServerLoad } from './$types';

// Docs are static: prerender every page so crawlers get full HTML.
export const prerender = true;

export const load: LayoutServerLoad = () => ({ nav: docsNav() });
