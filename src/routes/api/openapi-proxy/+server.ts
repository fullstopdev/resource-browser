import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const MAX_BODY_BYTES = 5 * 1024 * 1024;

function allowedOrigins(): string[] {
	const raw = env.EDA_API_URL ?? env.PUBLIC_EDA_API_URL ?? 'https://try.eda.dev:9443';
	try {
		const u = new URL(raw);
		return [u.origin];
	} catch {
		return [];
	}
}

function isAllowedUrl(urlStr: string): boolean {
	try {
		const u = new URL(urlStr);
		return allowedOrigins().includes(u.origin);
	} catch {
		return false;
	}
}

/** Forward Try-it-out requests to the EDA cluster (CORS bypass). */
export const POST: RequestHandler = async ({ request }) => {
	const declaredLength = Number(request.headers.get('content-length') ?? 0);
	if (declaredLength > MAX_BODY_BYTES) {
		return new Response(JSON.stringify({ error: 'Request body too large' }), { status: 413 });
	}

	let body: { url?: string; method?: string; headers?: Record<string, string>; body?: string };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
	}

	const { url, method = 'GET', headers = {}, body: reqBody } = body;
	if (!url || typeof url !== 'string') {
		return new Response(JSON.stringify({ error: 'url is required' }), { status: 400 });
	}
	if (!isAllowedUrl(url)) {
		return new Response(JSON.stringify({ error: 'URL origin not allowed' }), { status: 403 });
	}

	const safeMethod = method.toUpperCase();
	if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(safeMethod)) {
		return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
	}

	if (reqBody && reqBody.length > MAX_BODY_BYTES) {
		return new Response(JSON.stringify({ error: 'Request body too large' }), { status: 413 });
	}

	const forwardHeaders = new Headers();
	for (const [key, value] of Object.entries(headers)) {
		if (typeof value !== 'string') continue;
		const lower = key.toLowerCase();
		if (['host', 'connection', 'content-length', 'cookie', 'transfer-encoding'].includes(lower)) {
			continue;
		}
		forwardHeaders.set(key, value);
	}

	try {
		const upstream = await fetch(url, {
			method: safeMethod,
			headers: forwardHeaders,
			body: reqBody && safeMethod !== 'GET' && safeMethod !== 'HEAD' ? reqBody : undefined,
			// Following redirects would let the allowed origin bounce us to any host (SSRF).
			redirect: 'manual'
		});

		const responseBody = await upstream.arrayBuffer();
		const responseHeaders = new Headers();
		const contentType = upstream.headers.get('content-type');
		if (contentType) responseHeaders.set('content-type', contentType);

		return new Response(responseBody, {
			status: upstream.status,
			statusText: upstream.statusText,
			headers: responseHeaders
		});
	} catch {
		return new Response(JSON.stringify({ error: 'Proxy fetch failed' }), { status: 502 });
	}
};
