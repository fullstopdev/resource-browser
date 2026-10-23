import type { Handle } from '@sveltejs/kit';

/**
 * Baseline security headers for dynamic responses. Static assets get the same set from
 * `_headers` (Cloudflare Pages does not apply `_headers` to Functions responses).
 */
const SECURITY_HEADERS: Record<string, string> = {
	'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'SAMEORIGIN',
	'Content-Security-Policy': "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
	'Cross-Origin-Opener-Policy': 'same-origin'
};

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	// Suppress noisy 404 handling for intentional CRD version availability HEAD checks.
	// The handle hook returns the response without additional server-side logging.
	if (
		response.status === 404 &&
		event.url.pathname.includes('/resources/') &&
		event.url.pathname.endsWith('.yaml')
	) {
		return response;
	}

	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		if (!response.headers.has(name)) response.headers.set(name, value);
	}

	return response;
};
