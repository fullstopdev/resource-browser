import { describe, expect, it } from 'vitest';
import { buildSearchIndex, indexMightMatch, pruneSchema } from './schemaUtils';

describe('buildSearchIndex / indexMightMatch', () => {
	const schema = {
		type: 'object',
		properties: {
			adminState: {
				type: 'string',
				enum: ['enabled', 'disabled'],
				description: 'Administrative state of the interface'
			},
			vlanId: { type: 'integer', default: 1 }
		},
		required: ['adminState']
	};

	it('finds camelCase property names via compact query', () => {
		const index = buildSearchIndex(schema, false);
		expect(indexMightMatch(index, 'adminState')).toBe(true);
		expect(indexMightMatch(index, 'adminstate')).toBe(true);
	});

	it('finds enum values', () => {
		const index = buildSearchIndex(schema, false);
		expect(indexMightMatch(index, 'disabled')).toBe(true);
	});

	it('skips non-matching resources safely', () => {
		const index = buildSearchIndex(schema, false);
		expect(indexMightMatch(index, 'multihoming')).toBe(false);
	});

	it('includes descriptions only when requested', () => {
		const withoutDesc = buildSearchIndex(schema, false);
		const withDesc = buildSearchIndex(schema, true);
		expect(indexMightMatch(withoutDesc, 'administrative')).toBe(false);
		expect(indexMightMatch(withDesc, 'administrative')).toBe(true);
	});

	it('prefilter agrees with pruneSchema for hits and misses', () => {
		const index = buildSearchIndex(schema, false);
		for (const q of ['vlan', 'adminState', 'enabled', 'missingField']) {
			const pruned = pruneSchema(schema, q, false);
			const might = indexMightMatch(index, q);
			if (pruned) expect(might).toBe(true);
			if (!might) expect(pruned).toBeNull();
		}
	});
});
