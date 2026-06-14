import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	return new Response('google-site-verification: google795c3198bb040340.html\n', {
		headers: {
			'Content-Type': 'text/html; charset=UTF-8'
		}
	});
};
