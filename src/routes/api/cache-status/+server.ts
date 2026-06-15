import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildCacheKey, buildLegacyCacheKey } from '$lib/ai/kvCache';

const CHECK_ACTIONS = ['schema-summary', 'explain', 'example', 'full-context', 'compare'] as const;

export const GET: RequestHandler = async ({ url, platform }) => {
	const release = url.searchParams.get('release')?.trim();
	const kind = url.searchParams.get('kind')?.trim();
	const group = url.searchParams.get('group')?.trim();

	if (!release || !kind) {
		return json({ error: 'release and kind are required' }, { status: 400 });
	}

	const kv = platform?.env?.AI_CACHE;
	if (!kv) {
		return json({
			release,
			kind,
			group: group ?? null,
			cache: Object.fromEntries(CHECK_ACTIONS.map((a) => [a, 'kv_unavailable'])),
			kvBound: false
		});
	}

	const status: Record<string, string> = {};
	for (const action of CHECK_ACTIONS) {
		const primaryKey = buildCacheKey({ release, kind, group, action });
		let val = await kv.get(primaryKey);
		if (!val && group) {
			val = await kv.get(buildLegacyCacheKey({ release, kind, action }));
		}
		status[action] = val ? 'cached' : 'missing';
	}

	return json({ release, kind, group: group ?? null, cache: status, kvBound: true });
};
