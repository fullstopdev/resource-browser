import { describe, expect, it } from 'vitest';
import { checkStructuralRules } from './listTypeRules';

const schema = {
	type: 'object',
	properties: {
		tags: { type: 'array', 'x-kubernetes-list-type': 'set', items: { type: 'string' } },
		pools: {
			type: 'array',
			'x-kubernetes-list-type': 'map',
			'x-kubernetes-list-map-keys': ['name'],
			items: {
				type: 'object',
				'x-kubernetes-validations': [
					{ message: 'at least one of end or size must be set', rule: 'x' }
				],
				properties: { name: { type: 'string' }, size: { type: 'integer' } }
			}
		}
	}
};

describe('checkStructuralRules', () => {
	it('accepts unique sets and maps, with one CEL hint per rule', () => {
		const findings = checkStructuralRules(
			{
				tags: ['a', 'b'],
				pools: [
					{ name: 'p1', size: 1 },
					{ name: 'p2', size: 2 }
				]
			},
			schema
		);
		expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
		const hints = findings.filter((f) => f.severity === 'info');
		expect(hints).toHaveLength(1);
		expect(hints[0]!.message).toContain('spec.pools[]');
		expect(hints[0]!.message).toContain('at least one of end or size must be set');
	});

	it('flags duplicate set items and duplicate map keys', () => {
		const findings = checkStructuralRules(
			{
				tags: ['a', 'a'],
				pools: [
					{ name: 'p1', size: 1 },
					{ name: 'p1', size: 9 }
				]
			},
			schema
		).filter((f) => f.severity === 'error');
		expect(findings).toHaveLength(2);
		expect(findings[0]).toMatchObject({ path: 'spec.tags' });
		expect(findings[0]!.message).toContain('item 2 repeats item 1');
		expect(findings[1]).toMatchObject({ path: 'spec.pools' });
		expect(findings[1]!.message).toContain('name="p1"');
	});
});
