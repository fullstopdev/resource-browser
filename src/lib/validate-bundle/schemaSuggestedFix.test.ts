import { describe, expect, it } from 'vitest';
import {
	deriveClampFixFromSchema,
	deriveEnumFixFromSchema,
	deriveRelocateFixFromSchema,
	deriveRequiredFieldFix,
	deriveSuggestedFixForIssue,
	deriveTypeFixFromSchema,
	findSiblingRenameForRequiredField,
	findUniqueFuzzyEnumMatch,
	isEnumConstraintIssue,
	suggestFixFromAjvError
} from './schemaSuggestedFix';
import type { BundleIssue } from './types';

const UNDERLAY_PROTOCOLS_SCHEMA = {
	properties: {
		protocols: {
			type: 'array',
			items: { type: 'string', enum: ['EBGP'] }
		},
		bgp: { type: 'object', properties: {} }
	},
	required: ['protocols']
};

const OVERLAY_PROTOCOL_SCHEMA = {
	properties: {
		protocol: { type: 'string', enum: ['IBGP', 'EBGP', 'BGP'] },
		bfd: { type: 'object', properties: {} }
	},
	required: ['protocol']
};

const BFD_SCHEMA = {
	properties: {
		desiredMinTransmitIntMs: { type: 'integer', minimum: 10, maximum: 100000 },
		requiredMinEchoReceiveIntMs: { type: 'integer' },
		requiredMinReceiveIntMs: { type: 'integer' },
		enabled: { type: 'boolean' }
	}
};

describe('deriveRelocateFixFromSchema', () => {
	const specSchema = {
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

	it('suggests relocateField for additionalProperties-style unknown spec-root keys', () => {
		const issue: BundleIssue = {
			id: '1',
			severity: 'error',
			category: 'schema',
			message: 'spec.tunnelIndexPool is an additional property',
			docIndex: 1,
			fieldPath: 'spec.tunnelIndexPool'
		};
		const specData = { tunnelIndexPool: 'pool-a', evi: 102 };

		expect(deriveRelocateFixFromSchema(issue, specSchema, specData)).toEqual({
			action: 'relocateField',
			field: 'spec.tunnelIndexPool',
			value: 'spec.encapOptions.vxlan.tunnelIndexPool',
			line: undefined
		});
	});

	it('returns undefined when target nested path already has a value', () => {
		const issue: BundleIssue = {
			id: '2',
			severity: 'error',
			category: 'schema',
			message: 'spec.vni is an additional property',
			docIndex: 1,
			fieldPath: 'spec.vni'
		};
		const specData = {
			vni: 10,
			encapOptions: { vxlan: { vni: 99 } }
		};

		expect(deriveRelocateFixFromSchema(issue, specSchema, specData)).toBeUndefined();
	});

	it('uses explicit relocate target from issue message', () => {
		const issue: BundleIssue = {
			id: '3',
			severity: 'error',
			category: 'schema',
			message: 'Unknown field — relocate to "spec.encapOptions.vxlan.tunnelIndexPool"',
			docIndex: 1,
			fieldPath: 'spec.tunnelIndexPool'
		};
		const specData = { tunnelIndexPool: 'pool-a' };

		expect(deriveRelocateFixFromSchema(issue, specSchema, specData)).toEqual({
			action: 'relocateField',
			field: 'spec.tunnelIndexPool',
			value: 'spec.encapOptions.vxlan.tunnelIndexPool',
			line: undefined
		});
	});
});

describe('deriveTypeFixFromSchema', () => {
	it('coerces numeric value to string when schema expects string', () => {
		const issue: BundleIssue = {
			id: '1',
			severity: 'error',
			category: 'schema',
			message: 'spec.port must be string',
			fieldPath: 'spec.port',
			docIndex: 1
		};
		const leafSchema = { type: 'string' };
		const specData = { port: 8080 };

		expect(deriveTypeFixFromSchema(issue, leafSchema, specData)).toEqual({
			action: 'setValue',
			field: 'port',
			value: '8080',
			line: undefined
		});
	});
});

describe('deriveSuggestedFixForIssue', () => {
	it('suggests renameKey when parent has a similar property', () => {
		const issue: BundleIssue = {
			id: '1',
			severity: 'warning',
			category: 'schema',
			message: 'Unknown field "spec.interSwitchLinks.linkSelector"',
			docIndex: 1,
			fieldPath: 'spec.interSwitchLinks.linkSelector'
		};
		const parentProps = new Set(['linkSelectors', 'unnumbered']);

		expect(deriveSuggestedFixForIssue(issue, parentProps)).toEqual({
			action: 'renameKey',
			field: 'linkSelector',
			value: 'linkSelectors',
			line: undefined
		});
	});

	it('returns undefined when no similar property exists', () => {
		const issue: BundleIssue = {
			id: '2',
			severity: 'warning',
			category: 'schema',
			message: 'Unknown field "spec.totallyWrong"',
			docIndex: 1,
			fieldPath: 'spec.totallyWrong'
		};

		expect(deriveSuggestedFixForIssue(issue, new Set(['asnPool']))).toBeUndefined();
	});

	it('suggests renameKey when the key only differs by IPv casing', () => {
		const issue: BundleIssue = {
			id: '4',
			severity: 'warning',
			category: 'schema',
			message: 'Misspelled field "spec.spines.systemPoolIPV6"',
			docIndex: 1,
			fieldPath: 'spec.spines.systemPoolIPV6'
		};

		expect(
			deriveSuggestedFixForIssue(issue, new Set(['systemPoolIPv6', 'asnPool']))
		).toEqual({
			action: 'renameKey',
			field: 'systemPoolIPV6',
			value: 'systemPoolIPv6',
			line: undefined
		});
	});

	it('returns existing suggestedFix unchanged', () => {
		const existing = {
			action: 'renameKey' as const,
			field: 'foo',
			value: 'bar'
		};
		const issue: BundleIssue = {
			id: '3',
			severity: 'warning',
			category: 'schema',
			message: 'Misspelled field',
			docIndex: 1,
			fieldPath: 'spec.foo',
			suggestedFix: existing
		};

		expect(deriveSuggestedFixForIssue(issue, new Set(['bar']))).toBe(existing);
	});

	it('suggests renameKey for BFD minEchoReceiveInterval via stem match', () => {
		const issue: BundleIssue = {
			id: 'bfd-1',
			severity: 'warning',
			category: 'schema',
			message: 'Unknown field "spec.overlayProtocol.bfd.minEchoReceiveInterval"',
			docIndex: 1,
			fieldPath: 'spec.overlayProtocol.bfd.minEchoReceiveInterval'
		};
		const bfdProps = new Set([
			'desiredMinTransmitIntMs',
			'requiredMinEchoReceiveIntMs',
			'requiredMinReceiveIntMs',
			'enabled'
		]);

		expect(deriveSuggestedFixForIssue(issue, bfdProps)).toEqual({
			action: 'renameKey',
			field: 'minEchoReceiveInterval',
			value: 'requiredMinEchoReceiveIntMs',
			line: undefined
		});
	});

	it('suggests renameKey instead of addField when protocol sibling exists', () => {
		const issue: BundleIssue = {
			id: 'req-rename',
			severity: 'error',
			category: 'schema',
			message: 'spec.underlayProtocol.protocols is required',
			docIndex: 1,
			fieldPath: 'spec.underlayProtocol.protocols'
		};

		expect(
			deriveSuggestedFixForIssue(issue, null, {
				specSchema: { properties: { underlayProtocol: UNDERLAY_PROTOCOLS_SCHEMA } },
				specData: { underlayProtocol: { protocol: 'EBGP', bgp: {} } }
			})
		).toEqual({
			action: 'renameKey',
			field: 'protocol',
			value: 'protocols',
			line: undefined
		});
	});
	it('suggests addField for missing required protocols', () => {
		const issue: BundleIssue = {
			id: 'req-1',
			severity: 'error',
			category: 'schema',
			message: 'spec.underlayProtocol.protocols is required',
			docIndex: 1,
			fieldPath: 'spec.underlayProtocol.protocols'
		};

		expect(
			deriveSuggestedFixForIssue(issue, null, {
				specSchema: { properties: { underlayProtocol: UNDERLAY_PROTOCOLS_SCHEMA } },
				specData: { underlayProtocol: { bgp: {} } }
			})
		).toEqual({
			action: 'addField',
			field: 'protocols',
			value: '[]',
			line: undefined
		});
	});

	it('suggests clamp for desiredMinTransmitIntMs above maximum', () => {
		const issue: BundleIssue = {
			id: 'range-1',
			severity: 'error',
			category: 'schema',
			message: 'spec.overlayProtocol.bfd.desiredMinTransmitIntMs must be <= 100000',
			docIndex: 1,
			fieldPath: 'spec.overlayProtocol.bfd.desiredMinTransmitIntMs'
		};

		expect(
			deriveSuggestedFixForIssue(issue, null, {
				specSchema: {
					properties: {
						overlayProtocol: {
							properties: { bfd: BFD_SCHEMA }
						}
					}
				},
				specData: { overlayProtocol: { bfd: { desiredMinTransmitIntMs: 500000, enabled: true } } },
				leafSchema: BFD_SCHEMA.properties.desiredMinTransmitIntMs
			})
		).toEqual({
			action: 'setValue',
			field: 'desiredMinTransmitIntMs',
			value: '100000',
			line: undefined
		});
	});
});

describe('findUniqueFuzzyEnumMatch', () => {
	const interfaceTypeEnum = ['LAG', 'Interface', 'Loopback'];

	it('matches case-only differences (SRL → srl)', () => {
		expect(findUniqueFuzzyEnumMatch('SRL', ['srl', 'sros'])).toBe('srl');
	});

	it('maps Interface_ai to Interface when unique', () => {
		expect(findUniqueFuzzyEnumMatch('Interface_ai', interfaceTypeEnum)).toBe('Interface');
	});

	it('returns null when no safe unique match exists', () => {
		expect(findUniqueFuzzyEnumMatch('ios', ['srl', 'sros', 'eos'])).toBeNull();
	});

	it('returns null for values that do not map to any allowed enum', () => {
		expect(findUniqueFuzzyEnumMatch('inter', interfaceTypeEnum)).toBeNull();
	});
});

describe('deriveEnumFixFromSchema', () => {
	const INTERFACE_TYPE_SCHEMA = { type: 'string', enum: ['LAG', 'Interface', 'Loopback'] };

	it('suggests Interface for Interface_ai typo', () => {
		const issue: BundleIssue = {
			id: 'enum-1',
			severity: 'error',
			category: 'schema',
			message:
				"spec.type: value 'Interface_ai' is invalid; must be one of: LAG, Interface, Loopback (exact case)",
			docIndex: 1,
			fieldPath: 'spec.type'
		};

		expect(
			deriveEnumFixFromSchema(issue, INTERFACE_TYPE_SCHEMA, { type: 'Interface_ai' })
		).toEqual({
			action: 'setValue',
			field: 'type',
			value: 'Interface',
			line: undefined
		});
	});

	it('returns undefined for ambiguous invalid values', () => {
		const issue: BundleIssue = {
			id: 'enum-2',
			severity: 'error',
			category: 'schema',
			message: "spec.os: value 'ios' is invalid; must be one of: srl, sros (exact case)",
			docIndex: 1,
			fieldPath: 'spec.os'
		};

		expect(
			deriveEnumFixFromSchema(
				issue,
				{ type: 'string', enum: ['srl', 'sros'] },
				{ os: 'ios' }
			)
		).toBeUndefined();
	});
});

describe('isEnumConstraintIssue', () => {
	it('detects formatted AJV enum messages', () => {
		expect(
			isEnumConstraintIssue({
				id: '1',
				severity: 'error',
				category: 'schema',
				message:
					"spec.type: value 'Interface_ai' is invalid; must be one of: LAG, Interface, Loopback (exact case)"
			})
		).toBe(true);
	});
});

describe('suggestFixFromAjvError', () => {
	it('clamps maximum violations', () => {
		expect(
			suggestFixFromAjvError(
				'maximum',
				'/overlayProtocol/bfd/desiredMinTransmitIntMs',
				{ overlayProtocol: { bfd: { desiredMinTransmitIntMs: 500000 } } },
				{
					properties: {
						overlayProtocol: {
							properties: {
								bfd: BFD_SCHEMA
							}
						}
					}
				}
			)
		).toEqual({
			action: 'setValue',
			field: 'desiredMinTransmitIntMs',
			value: '100000',
			line: undefined
		});
	});

	it('renames protocol instead of adding empty protocols array', () => {
		expect(
			suggestFixFromAjvError(
				'required',
				'/underlayProtocol',
				{ underlayProtocol: { protocol: 'EBGP', bgp: {} } },
				{ properties: { underlayProtocol: UNDERLAY_PROTOCOLS_SCHEMA } },
				undefined,
				{ missingProperty: 'protocols' }
			)
		).toEqual({
			action: 'renameKey',
			field: 'protocol',
			value: 'protocols',
			line: undefined
		});
	});

	it('adds missing required array field', () => {
		expect(
			suggestFixFromAjvError(
				'required',
				'/underlayProtocol',
				{ underlayProtocol: { bgp: {} } },
				{ properties: { underlayProtocol: UNDERLAY_PROTOCOLS_SCHEMA } },
				undefined,
				{ missingProperty: 'protocols' }
			)
		).toEqual({
			action: 'addField',
			field: 'protocols',
			value: '[]',
			line: undefined
		});
	});

	it('fixes Interface_ai enum via fuzzy suffix match', () => {
		expect(
			suggestFixFromAjvError(
				'enum',
				'/type',
				{ type: 'Interface_ai', enabled: true },
				{ properties: { type: { type: 'string', enum: ['LAG', 'Interface', 'Loopback'] } } }
			)
		).toEqual({
			action: 'setValue',
			field: 'type',
			value: 'Interface',
			line: undefined
		});
	});

	it('fixes case-only enum mismatches', () => {
		expect(
			suggestFixFromAjvError(
				'enum',
				'/operatingSystem',
				{ operatingSystem: 'SRL' },
				{ properties: { operatingSystem: { type: 'string', enum: ['srl', 'sros', 'eos'] } } }
			)
		).toEqual({
			action: 'setValue',
			field: 'operatingSystem',
			value: 'srl',
			line: undefined
		});
	});
});

describe('deriveRequiredFieldFix', () => {
	it('returns renameKey when protocol sibling should become protocols', () => {
		expect(
			deriveRequiredFieldFix(
				{
					id: 'r2',
					severity: 'error',
					category: 'schema',
					message: 'spec.underlayProtocol.protocols is required',
					fieldPath: 'spec.underlayProtocol.protocols'
				},
				{ properties: { underlayProtocol: UNDERLAY_PROTOCOLS_SCHEMA } },
				{ underlayProtocol: { protocol: 'EBGP' } }
			)
		).toEqual({
			action: 'renameKey',
			field: 'protocol',
			value: 'protocols',
			line: undefined
		});
	});

	it('returns addField with empty array for required protocols', () => {
		expect(
			deriveRequiredFieldFix(
				{
					id: 'r1',
					severity: 'error',
					category: 'schema',
					message: 'spec.underlayProtocol.protocols is required',
					fieldPath: 'spec.underlayProtocol.protocols'
				},
				{ properties: { underlayProtocol: UNDERLAY_PROTOCOLS_SCHEMA } },
				{ underlayProtocol: {} }
			)
		).toEqual({
			action: 'addField',
			field: 'protocols',
			value: '[]',
			line: undefined
		});
	});

	it('renames overlay protocols sibling instead of adding protocol', () => {
		expect(
			deriveRequiredFieldFix(
				{
					id: 'r-overlay',
					severity: 'error',
					category: 'schema',
					message: 'spec.overlayProtocol.protocol is required',
					fieldPath: 'spec.overlayProtocol.protocol'
				},
				{ properties: { overlayProtocol: OVERLAY_PROTOCOL_SCHEMA } },
				{ overlayProtocol: { protocols: 'IBGP' } }
			)
		).toEqual({
			action: 'renameKey',
			field: 'protocols',
			value: 'protocol',
			line: undefined
		});
	});
});

describe('findSiblingRenameForRequiredField', () => {
	it('maps protocol to protocols on underlayProtocol', () => {
		expect(
			findSiblingRenameForRequiredField(
				'protocols',
				UNDERLAY_PROTOCOLS_SCHEMA,
				{ protocol: 'EBGP', bgp: {} },
				undefined,
				'underlayProtocol'
			)
		).toEqual({
			action: 'renameKey',
			field: 'protocol',
			value: 'protocols',
			line: undefined
		});
	});

	it('maps protocols to protocol on overlayProtocol', () => {
		expect(
			findSiblingRenameForRequiredField(
				'protocol',
				OVERLAY_PROTOCOL_SCHEMA,
				{ protocols: 'IBGP', bfd: { enabled: true } },
				undefined,
				'overlayProtocol'
			)
		).toEqual({
			action: 'renameKey',
			field: 'protocols',
			value: 'protocol',
			line: undefined
		});
	});
});

describe('deriveClampFixFromSchema', () => {
	it('clamps value to schema maximum', () => {
		expect(
			deriveClampFixFromSchema(
				{
					id: 'c1',
					severity: 'error',
					category: 'schema',
					message: 'must be <= 100000',
					fieldPath: 'spec.overlayProtocol.bfd.desiredMinTransmitIntMs'
				},
				BFD_SCHEMA.properties.desiredMinTransmitIntMs,
				{ overlayProtocol: { bfd: { desiredMinTransmitIntMs: 999999 } } }
			)
		).toEqual({
			action: 'setValue',
			field: 'desiredMinTransmitIntMs',
			value: '100000',
			line: undefined
		});
	});
});
