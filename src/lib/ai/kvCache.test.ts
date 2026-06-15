import { describe, expect, it } from 'vitest';
import {
	ASK_WARM_ACTIONS,
	buildCacheKey,
	DETERMINISTIC_CACHE_ACTIONS,
	isDeterministicCacheAction
} from './kvCache';

describe('kvCache warm actions', () => {
	it('defines Ask AI warm actions in dependency order', () => {
		expect(ASK_WARM_ACTIONS).toEqual([
			'schema-summary',
			'relationships',
			'explain',
			'example',
			'full-context'
		]);
	});

	it('marks schema-summary, relationships, and full-context as deterministic', () => {
		expect(DETERMINISTIC_CACHE_ACTIONS.has('schema-summary')).toBe(true);
		expect(DETERMINISTIC_CACHE_ACTIONS.has('relationships')).toBe(true);
		expect(DETERMINISTIC_CACHE_ACTIONS.has('full-context')).toBe(true);
		expect(isDeterministicCacheAction('explain')).toBe(false);
	});

	it('builds distinct cache keys per action', () => {
		const base = { release: '26.4.2', kind: 'Interface', group: 'interfaces.eda.nokia.com' };
		const explainKey = buildCacheKey({ ...base, action: 'explain' });
		const summaryKey = buildCacheKey({ ...base, action: 'schema-summary' });
		const fullKey = buildCacheKey({ ...base, action: 'full-context' });
		expect(explainKey).not.toBe(summaryKey);
		expect(summaryKey).not.toBe(fullKey);
		expect(explainKey).toContain(':explain');
		expect(summaryKey).toContain(':schema-summary');
		expect(fullKey).toContain(':full-context');
	});
});
