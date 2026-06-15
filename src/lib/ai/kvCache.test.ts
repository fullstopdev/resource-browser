import { describe, expect, it } from 'vitest';
import {
	ASK_WARM_ACTIONS,
	buildCacheKey,
	buildReleaseCacheKey,
	DETERMINISTIC_CACHE_ACTIONS,
	isDeterministicCacheAction,
	RELEASE_CACHE_KIND
} from './kvCache';

describe('kvCache warm actions', () => {
	it('defines Ask AI warm actions in dependency order', () => {
		expect(ASK_WARM_ACTIONS).toEqual([
			'dependency-map',
			'schema-summary',
			'relationships',
			'explain',
			'example',
			'full-context'
		]);
	});

	it('marks deterministic actions including release dependency map', () => {
		expect(DETERMINISTIC_CACHE_ACTIONS.has('dependency-map')).toBe(true);
		expect(DETERMINISTIC_CACHE_ACTIONS.has('schema-summary')).toBe(true);
		expect(DETERMINISTIC_CACHE_ACTIONS.has('relationships')).toBe(true);
		expect(DETERMINISTIC_CACHE_ACTIONS.has('full-context')).toBe(true);
		expect(isDeterministicCacheAction('explain')).toBe(false);
	});

	it('builds release-scoped cache key', () => {
		const key = buildReleaseCacheKey({ release: '26.4.2', action: 'dependency-map' });
		expect(key).toContain(RELEASE_CACHE_KIND);
		expect(key).toContain(':dependency-map');
	});

	it('builds distinct cache keys per action and apiVersion', () => {
		const base = {
			release: '26.4.2',
			kind: 'Interface',
			group: 'interfaces.eda.nokia.com',
			apiVersion: 'v2'
		};
		const explainKey = buildCacheKey({ ...base, action: 'explain' });
		const summaryKey = buildCacheKey({ ...base, action: 'schema-summary' });
		const fullKey = buildCacheKey({ ...base, action: 'full-context' });
		expect(explainKey).toContain('ai:v2:');
		expect(explainKey).toContain(':v2:');
		expect(explainKey).not.toBe(summaryKey);
		expect(summaryKey).not.toBe(fullKey);
		expect(explainKey).toContain(':explain');
		expect(summaryKey).toContain(':schema-summary');
		expect(fullKey).toContain(':full-context');
	});
});
