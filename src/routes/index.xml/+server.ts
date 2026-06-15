import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Google Search Console and other tools sometimes expect index.xml instead of sitemap.xml. */
export const GET: RequestHandler = () => {
	throw redirect(301, '/sitemap.xml');
};
