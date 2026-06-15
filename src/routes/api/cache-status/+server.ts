import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ASK_WARM_ACTIONS, buildCacheKey, buildReleaseCacheKey } from '$lib/ai/kvCache';
import { activeApiVersion, filterActiveManifest } from '$lib/manifest/activeCrds';
import { fetchManifest } from '$lib/manifest/fetch';
import releasesYaml from '$lib/releases.yaml?raw';
import type { ReleasesConfig } from '$lib/structure';
import { loadStaticYaml } from '$lib/yaml/safeYaml';
import { assertSafeFolderPath } from '$lib/yaml-validation/schemaCache';

const CHECK_ACTIONS = [...ASK_WARM_ACTIONS, 'compare'] as const;

const releasesConfig = loadStaticYaml(releasesYaml) as ReleasesConfig;

function releaseFolder(releaseName: string): string | null {
	return releasesConfig.releases.find((r) => r.name === releaseName)?.folder ?? null;
}

async function actionCached(
	kv: KVNamespace,
	release: string,
	kind: string,
	group: string | undefined,
	apiVersion: string | undefined,
	action: string
): Promise<boolean> {
	const primaryKey = buildCacheKey({ release, kind, group, apiVersion, action });
	const val = await kv.get(primaryKey);
	return !!val;
}

export const GET: RequestHandler = async ({ url, platform, fetch: originFetch }) => {
	const release = url.searchParams.get('release')?.trim();
	const kind = url.searchParams.get('kind')?.trim();
	const group = url.searchParams.get('group')?.trim();
	const summary = url.searchParams.get('summary') === 'true';

	if (!release) {
		return json({ error: 'release is required' }, { status: 400 });
	}

	const kv = platform?.env?.AI_CACHE;
	if (!kv) {
		return json({
			release,
			kvBound: false,
			cache: Object.fromEntries(CHECK_ACTIONS.map((a) => [a, 'kv_unavailable']))
		});
	}

	if (summary) {
		const folder = releaseFolder(release);
		if (!folder) {
			return json({ error: `Unknown release: ${release}` }, { status: 404 });
		}
		const manifest = filterActiveManifest(
			(await fetchManifest(assertSafeFolderPath(folder), undefined, originFetch)) ?? []
		);
		const targets = manifest
			.filter((e) => e.kind && e.group)
			.map((e) => ({
				kind: e.kind!,
				group: e.group!,
				apiVersion: activeApiVersion(e)
			}))
			.filter((e) => e.apiVersion);

		const coreActions = ['schema-summary', 'relationships', 'full-context'] as const;
		let complete = 0;
		const perAction: Record<string, number> = {};

		for (const action of coreActions) {
			perAction[action] = 0;
		}

		for (const target of targets) {
			let targetComplete = true;
			for (const action of coreActions) {
				const hit = await actionCached(
					kv,
					release,
					target.kind,
					target.group,
					target.apiVersion,
					action
				);
				if (hit) perAction[action] += 1;
				else targetComplete = false;
			}
			if (targetComplete) complete += 1;
		}

		const total = targets.length;
		const releaseDependencyMap = !!(await kv.get(
			buildReleaseCacheKey({ release, action: 'dependency-map' })
		));
		return json({
			release,
			kvBound: true,
			summary: true,
			totalCrds: total,
			fullContextComplete: complete,
			percentComplete: total ? Math.round((complete / total) * 1000) / 10 : 0,
			releaseActions: {
				'dependency-map': { cached: releaseDependencyMap }
			},
			perAction: Object.fromEntries(
				coreActions.map((a) => [
					a,
					{ cached: perAction[a], percent: total ? Math.round((perAction[a] / total) * 1000) / 10 : 0 }
				])
			)
		});
	}

	if (!kind) {
		return json({ error: 'kind is required unless summary=true' }, { status: 400 });
	}

	const versionParam = url.searchParams.get('version')?.trim();
	let apiVersion = versionParam || undefined;
	if (!apiVersion && group) {
		const folder = releaseFolder(release);
		if (folder) {
			const manifest = filterActiveManifest(
				(await fetchManifest(assertSafeFolderPath(folder), undefined, originFetch)) ?? []
			);
			const entry = manifest.find((e) => e.kind === kind && e.group === group);
			apiVersion = entry ? activeApiVersion(entry) : undefined;
		}
	}

	const status: Record<string, string> = {};
	for (const action of CHECK_ACTIONS) {
		status[action] = (await actionCached(kv, release, kind, group, apiVersion, action))
			? 'cached'
			: 'missing';
	}

	return json({ release, kind, group: group ?? null, version: apiVersion ?? null, cache: status, kvBound: true });
};
