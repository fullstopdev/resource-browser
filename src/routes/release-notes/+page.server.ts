import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Permanent redirect from legacy /release-notes URL to /release-changes */
export const load: PageServerLoad = ({ url }) => {
	redirect(301, `/release-changes${url.search}`);
};
