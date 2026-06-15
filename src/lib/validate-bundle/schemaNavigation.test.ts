import { describe, expect, it } from 'vitest';
import { resolveSchemaAtPath, schemaAtYamlPath, schemaLeafMeta } from './schemaNavigation';

const fabricLeafsSchema = {
	type: 'object',
	properties: {
		leafs: {
			type: 'object',
			properties: {
				asnPool: {
					type: 'string',
					description:
						'Reference to an IndexAllocationPool pool to use for Autonomous System Number allocations.'
				},
				leafNodeSelectors: {
					type: 'array',
					items: { type: 'string' },
					description: 'Label selector used to select Toponodes to configure as Leaf nodes.'
				}
			}
		}
	}
};

describe('schemaAtYamlPath', () => {
	it('resolves nested spec paths', () => {
		const leaf = schemaAtYamlPath(fabricLeafsSchema, ['leafs']);
		const asnPool = schemaAtYamlPath(fabricLeafsSchema, ['leafs', 'asnPool']);
		expect(leaf).toBeTruthy();
		expect((asnPool as { type?: string }).type).toBe('string');
	});
});

describe('resolveSchemaAtPath', () => {
	const underlaySchema = {
		type: 'object',
		properties: {
			underlayProtocol: {
				type: 'object',
				properties: {
					protocols: {
						type: 'array',
						items: { type: 'string', enum: ['EBGP', 'OSPFv2', 'OSPFv3'] }
					}
				}
			}
		}
	};

	it('resolves protocol → protocols under underlayProtocol', () => {
		const resolved = resolveSchemaAtPath(underlaySchema, ['underlayProtocol', 'protocol']);
		expect(resolved?.path).toEqual(['underlayProtocol', 'protocols']);
		expect((resolved?.schema as { type?: string }).type).toBe('array');
	});

	it('does not alias overlayProtocol.protocol', () => {
		const overlaySchema = {
			type: 'object',
			properties: {
				overlayProtocol: {
					type: 'object',
					properties: {
						protocol: { type: 'string', enum: ['IBGP', 'EBGP'] }
					}
				}
			}
		};
		const resolved = resolveSchemaAtPath(overlaySchema, ['overlayProtocol', 'protocol']);
		expect(resolved?.path).toEqual(['overlayProtocol', 'protocol']);
		expect((resolved?.schema as { type?: string }).type).toBe('string');
	});
});

describe('schemaLeafMeta', () => {
	it('infers IndexAllocationPool from asnPool description', () => {
		const node = schemaAtYamlPath(fabricLeafsSchema, ['leafs', 'asnPool']);
		const meta = schemaLeafMeta(node, 'asnPool');
		expect(meta.referencedKinds).toContain('IndexAllocationPool');
	});
});
