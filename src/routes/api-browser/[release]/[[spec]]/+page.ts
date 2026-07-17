import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { decodeSpecIdFromRoute } from '$lib/openapi/urlState';

/** Deep-link route: `/api-browser/<release>/<app>#operationId` → OpenAPI viewer. */
export const load: PageLoad = ({ params, url }) => {
	const release = params.release;
	const spec = decodeSpecIdFromRoute(params.spec);
	const search = new URLSearchParams();
	if (release) search.set('release', release);
	if (spec) search.set('spec', spec);
	const qs = search.toString();
	const target = qs ? `/openapi?${qs}${url.hash}` : `/openapi${url.hash}`;
	redirect(308, target);
};
