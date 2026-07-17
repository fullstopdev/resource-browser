import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** Permanent redirect: legacy API Browser URL → consolidated OpenAPI tool. */
export const load: PageLoad = ({ url }) => {
	redirect(308, `/openapi${url.search}`);
};
