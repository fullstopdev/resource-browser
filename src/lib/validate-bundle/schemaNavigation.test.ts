import { describe, expect, it } from 'vitest';
import {
	findFabricProtocolKeyMatch,
	findNestedSchemaPropertyPath,
	findSimilarSchemaProperty,
	fabricProtocolParentHint,
	normalizePropertyStem,
	normalizeSchemaPropertyName,
	resolveSchemaPropertyKey
} from './schemaNavigation';

describe('normalizeSchemaPropertyName', () => {
	it('normalizes IPV6 suffix casing', () => {
		expect(normalizeSchemaPropertyName('systemPoolIPV6')).toBe('systemPoolIPv6');
	});
});

describe('resolveSchemaPropertyKey', () => {
	it('matches schema keys that differ only by IPv casing', () => {
		const props = new Set(['systemPoolIPv6', 'asnPool']);
		expect(resolveSchemaPropertyKey('systemPoolIPV6', props)).toBe('systemPoolIPv6');
	});

	it('matches schema keys that differ only by letter casing', () => {
		const props = new Set(['borderLeafs']);
		expect(resolveSchemaPropertyKey('borderleafs', props)).toBe('borderLeafs');
	});
});

describe('findSimilarSchemaProperty', () => {
	it('suggests canonical key when YAML uses IPV6 casing', () => {
		const props = new Set(['systemPoolIPv6', 'asnPool']);
		expect(findSimilarSchemaProperty('systemPoolIPV6', props)).toBe('systemPoolIPv6');
	});

	it('returns null when the key matches the schema exactly', () => {
		const props = new Set(['systemPoolIPv6', 'asnPool']);
		expect(findSimilarSchemaProperty('systemPoolIPv6', props)).toBeNull();
	});

	it('returns null when no similar property exists', () => {
		const props = new Set(['asnPool']);
		expect(findSimilarSchemaProperty('totallyWrong', props)).toBeNull();
	});

	it('matches plural schema keys when YAML uses singular', () => {
		const props = new Set(['protocols', 'enabled']);
		expect(findSimilarSchemaProperty('protocol', props)).toBe('protocols');
	});

	it('uses Fabric parent context for underlay vs overlay protocol keys', () => {
		const underlayProps = new Set(['protocols', 'bgp', 'bfd']);
		const overlayProps = new Set(['protocol', 'bgp', 'bfd']);
		expect(findSimilarSchemaProperty('protocol', underlayProps, 'underlayProtocol')).toBe(
			'protocols'
		);
		expect(findSimilarSchemaProperty('protocols', overlayProps, 'overlayProtocol')).toBe(
			'protocol'
		);
		expect(findFabricProtocolKeyMatch('protocol', 'underlayProtocol', underlayProps)).toBe(
			'protocols'
		);
		expect(fabricProtocolParentHint('underlayProtocol')).toContain('protocols');
		expect(fabricProtocolParentHint('overlayProtocol')).toContain('"protocol"');
	});

	it('blocks generic pluralization that violates Fabric parent protocol rules', () => {
		expect(
			findSimilarSchemaProperty('protocol', new Set(['protocols']), 'overlayProtocol')
		).toBeNull();
		expect(
			findSimilarSchemaProperty('protocols', new Set(['protocol']), 'underlayProtocol')
		).toBeNull();
	});

	it('matches BFD field stems (minEchoReceiveInterval → requiredMinEchoReceiveIntMs)', () => {
		const bfdProps = new Set([
			'desiredMinTransmitIntMs',
			'requiredMinEchoReceiveIntMs',
			'requiredMinReceiveIntMs',
			'enabled'
		]);
		expect(findSimilarSchemaProperty('minEchoReceiveInterval', bfdProps)).toBe(
			'requiredMinEchoReceiveIntMs'
		);
		expect(findSimilarSchemaProperty('requiredMinReceive', bfdProps)).toBe(
			'requiredMinReceiveIntMs'
		);
	});

	it('blocks short-key Levenshtein matches (vni vs evi)', () => {
		const props = new Set(['evi', 'eviPool', 'encapOptions']);
		expect(findSimilarSchemaProperty('vni', props)).toBeNull();
	});

	it('skips rename when suggested sibling already exists in parent data', () => {
		const props = new Set(['evi', 'eviPool', 'encapOptions']);
		const parentData = { evi: 102, vni: 102 };
		expect(findSimilarSchemaProperty('vni', props, undefined, parentData)).toBeNull();
	});
});

describe('findNestedSchemaPropertyPath', () => {
	const spec = {
		type: 'object',
		properties: {
			encapOptions: {
				type: 'object',
				properties: {
					vxlan: {
						type: 'object',
						properties: {
							tunnelIndexPool: { type: 'string' },
							vni: { type: 'integer' }
						}
					}
				}
			},
			evi: { type: 'integer' }
		}
	};

	it('returns unique nested path for relocated spec-root keys', () => {
		expect(findNestedSchemaPropertyPath(spec, 'tunnelIndexPool')).toBe(
			'encapOptions.vxlan.tunnelIndexPool'
		);
		expect(findNestedSchemaPropertyPath(spec, 'vni')).toBe('encapOptions.vxlan.vni');
	});

	it('returns null when multiple nested matches exist', () => {
		const ambiguous = {
			type: 'object',
			properties: {
				a: { type: 'object', properties: { name: { type: 'string' } } },
				b: { type: 'object', properties: { name: { type: 'string' } } }
			}
		};
		expect(findNestedSchemaPropertyPath(ambiguous, 'name')).toBeNull();
	});
});

describe('normalizePropertyStem', () => {
	it('strips IntMs/Interval suffixes and required prefix', () => {
		expect(normalizePropertyStem('requiredMinEchoReceiveIntMs')).toBe('minechoreceive');
		expect(normalizePropertyStem('minEchoReceiveInterval')).toBe('minechoreceive');
	});
});
