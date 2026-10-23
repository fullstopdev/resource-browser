import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { buildFixInput } from '../fixInput';
import { FIX_EVAL_CASES } from './fixCases';

describe('AI fix eval cases', () => {
	it('have unique ids', () => {
		const ids = FIX_EVAL_CASES.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it.each(FIX_EVAL_CASES.map((c) => [c.id, c]))('%s is actually broken', (_, c) => {
		if (c.issueKind === 'syntax') {
			expect(() => yaml.load(c.yaml)).toThrow();
			return;
		}
		const doc = yaml.load(c.yaml) as Record<string, unknown>;
		expect(c.check(doc), 'the check must flag the broken document').not.toBeNull();
	});

	it('includes a long document that the server sends as an excerpt', () => {
		const long = FIX_EVAL_CASES.find((c) => c.id === 'enum-long-interface-excerpt')!;
		expect(buildFixInput(long.yaml, long.fieldPath).mode).toBe('excerpt');
	});
});
