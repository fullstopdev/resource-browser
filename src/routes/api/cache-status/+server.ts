import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildCacheKey } from '$lib/ai/kvCache';

const CHECK_ACTIONS = ['explain', 'example', 'compare'] as const;

export const GET: RequestHandler = async ({ url, platform }) => {
	const release = url.searchParams.get('release')?.trim();
	const kind = url.searchParams.get('kind')?.trim();

	if (!release || !kind) {
		return json({ error: 'release and kind are required' }, { status: 400 });
	}

	const kv = platform?.env?.AI_CACHE;
	if (!kv) {
		return json({
			release,
			kind,
			cache: Object.fromEntries(CHECK_ACTIONS.map((a) => [a, 'kv_unavailable'])),
			kvBound: false
		});
	}

	const status: Record<string, string> = {};
	for (const action of CHECK_ACTIONS) {
		const key = buildCacheKey({ release, kind, action });
		const val = await kv.get(key);
		status[action] = val ? 'cached' : 'missing';
	}

	return json({ release, kind, cache: status, kvBound: true });
};
