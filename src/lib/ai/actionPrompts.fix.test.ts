import { describe, expect, it } from 'vitest';
import {
	promptFixYaml,
	promptFixYamlMigration,
	promptFixYamlSyntax,
	buildFixScopedSchemaPrompt
} from './actionPrompts';
import type { AiSchemaPayload } from './loadAiSchema';

const schema: AiSchemaPayload = {
	apiVersion: 'fabrics.eda.nokia.com/v1',
	kind: 'Fabric',
	group: 'fabrics.eda.nokia.com',
	release: '26.4.2',
	deprecated: false,
	specSchema: {
		type: 'object',
		properties: {
			os: { type: 'string', enum: ['srl', 'sros'] },
			underlayProtocol: {
				type: 'object',
				properties: {
					protocols: { type: 'array', items: { type: 'string', enum: ['EBGP', 'OSPFv2'] } }
				}
			}
		}
	},
	statusSchema: null,
	specRequired: ['os'],
	statusRequired: [],
	resourceName: 'fabrics.eda.nokia.com',
	version: 'v1'
};

describe('promptFixYaml', () => {
	it('includes issue context and document YAML', () => {
		const prompt = promptFixYaml('26.4.2', 'Fabric', schema, 'kind: Fabric\n', {
			message: 'spec.os must be srl or sros',
			fieldPath: 'spec.os',
			line: 8,
			severity: 'error'
		});

		expect(prompt.user).toContain('spec.os must be srl or sros');
		expect(prompt.user).toContain('Field: spec.os');
		expect(prompt.user).toContain('kind: Fabric');
		expect(prompt.user).toContain('FIXABLE:');
	});

	it('syntax prompt works without CRD schema', () => {
		const prompt = promptFixYamlSyntax('26.4.2', 'kind Fabric\n', {
			message: 'YAML parsing error at line 1',
			line: 1
		});
		expect(prompt.user).toContain('YAML parsing error');
		expect(prompt.user).toContain('kind Fabric');
	});

	it('includes preserve-values rules for rename issues', () => {
		const prompt = promptFixYaml('26.4.2', 'Fabric', schema, 'spec:\n  protocol:\n  - EBGP\n', {
			message: 'Misspelled field "spec.underlayProtocol.protocol"',
			fieldPath: 'spec.underlayProtocol.protocol',
			issueKind: 'misspelledField',
			renameHint: { from: 'protocol', to: 'protocols' },
			parentPathContext:
				'spec.underlayProtocol requires the plural key "protocols" (array). Do not use singular "protocol" here.'
		});

		expect(prompt.user).toContain('RENAME ONLY');
		expect(prompt.user).toContain('rename the YAML key only');
		expect(prompt.user).toContain('FORBIDDEN: expanding a list');
		expect(prompt.user).toContain('protocol');
		expect(prompt.user).toContain('protocols');
		expect(prompt.user).toContain('Parent path context');
		expect(prompt.user).toContain('underlayProtocol');
	});

	it('enum prompt forbids expanding lists to all schema values', () => {
		const prompt = promptFixYaml('26.4.2', 'Fabric', schema, 'spec:\n  os: bad\n', {
			message: 'spec.os must be one of srl, sros',
			fieldPath: 'spec.os',
			issueKind: 'enum',
			allowedValues: ['srl', 'sros']
		});

		expect(prompt.user).toContain('Never expand a list to include all schema enum options');
		expect(prompt.user).toContain('FORBIDDEN: expanding a list');
	});

	it('includes minimal-fix and byte-identical rules', () => {
		const prompt = promptFixYaml('26.4.2', 'Fabric', schema, 'spec:\n  os: bad\n', {
			message: 'spec.os must be one of srl, sros',
			fieldPath: 'spec.os',
			issueKind: 'enum'
		});

		expect(prompt.user).toContain('MINIMAL FIX');
		expect(prompt.user).toContain('byte-identical');
		expect(prompt.user).toContain('FORBIDDEN: filling an empty object');
	});

	it('syntax prompt includes minimal-fix rules', () => {
		const prompt = promptFixYamlSyntax('26.4.2', 'kind Fabric\n', {
			message: 'YAML parsing error at line 1',
			line: 1
		});

		expect(prompt.user).toContain('MINIMAL FIX');
		expect(prompt.user).toContain('byte-identical');
	});

	it('fix prompt uses scoped CRD schema, not full CRD dump', () => {
		const largeSpec = {
			type: 'object',
			properties: {
				os: { type: 'string', enum: ['srl', 'sros'] },
				nested: {
					type: 'object',
					properties: Object.fromEntries(
						Array.from({ length: 40 }, (_, i) => [`field${i}`, { type: 'string' }])
					)
				}
			}
		};
		const largeSchema: AiSchemaPayload = {
			...schema,
			specSchema: largeSpec
		};

		const issue = {
			message: 'spec.os must be one of srl, sros',
			fieldPath: 'spec.os',
			issueKind: 'enum' as const,
			allowedValues: ['srl', 'sros']
		};

		const prompt = promptFixYaml('26.4.2', 'Fabric', largeSchema, 'spec:\n  os: bad\n', issue);
		const scoped = buildFixScopedSchemaPrompt('26.4.2', 'Fabric', largeSchema, issue);

		expect(prompt.system).toContain('relevant subtree');
		expect(prompt.system).toContain('fieldSchema');
		expect(prompt.system).not.toContain('field39');
		expect(scoped).not.toContain('field39');
		expect(prompt.user).not.toContain('Schema at field path');
	});

	it('unknownField prompt without renameHint allows relocation within spec', () => {
		const prompt = promptFixYaml('26.4.2', 'BridgeDomain', schema, 'spec:\n  tunnelIndexPool: pool\n', {
			message: 'Unknown field "spec.tunnelIndexPool"',
			fieldPath: 'spec.tunnelIndexPool',
			issueKind: 'unknownField',
			allowedSiblingKeys: ['encapOptions', 'type']
		});

		expect(prompt.user).not.toContain('RENAME ONLY');
		expect(prompt.user).not.toContain('rename the YAML key only');
		expect(prompt.user).toContain('relocate its value');
		expect(prompt.user).toContain('ALLOWED for unknown-field fixes');
	});

	it('type prompt allows structural wrapping at the reported field path', () => {
		const prompt = promptFixYaml('26.4.2', 'BridgeDomain', schema, 'spec:\n  macLearning: true\n', {
			message: 'must be object',
			fieldPath: 'spec.macLearning',
			issueKind: 'type',
			expectedTypes: ['object']
		});

		expect(prompt.user).toContain('Structural wrapping is allowed');
		expect(prompt.user).toContain('ALLOWED for type fixes');
		expect(prompt.user).not.toContain(
			'FORBIDDEN: adding new keys, list items, object properties, or blocks'
		);
	});

	it('includes parentObjectSchema for direct spec children on unknown-field fixes', () => {
		const issue = {
			message: 'Unknown field "spec.tunnelIndexPool"',
			fieldPath: 'spec.tunnelIndexPool',
			issueKind: 'unknownField' as const
		};
		const scoped = buildFixScopedSchemaPrompt('26.4.2', 'BridgeDomain', schema, issue);
		expect(scoped).toContain('parentObjectSchema');
	});

	it('does not include full spec parent for shallow enum fixes', () => {
		const issue = {
			message: 'spec.os must be one of srl, sros',
			fieldPath: 'spec.os',
			issueKind: 'enum' as const
		};
		const scoped = buildFixScopedSchemaPrompt('26.4.2', 'Fabric', schema, issue);
		expect(scoped).toContain('fieldSchema');
		expect(scoped).not.toContain('parentObjectSchema');
	});

	it('uses YAML excerpt for single-issue fixes when provided', () => {
		const fullDoc = `apiVersion: example/v1\nkind: Test\nmetadata:\n  name: x\nspec:\n  os: bad\n  other: true`;
		const excerpt = 'spec:\n  os: bad';
		const prompt = promptFixYaml('26.4.2', 'Fabric', schema, fullDoc, {
			message: 'invalid enum',
			fieldPath: 'spec.os',
			issueKind: 'enum'
		}, { excerptYaml: excerpt });

		expect(prompt.user).toContain(excerpt);
		expect(prompt.user).not.toContain('other: true');
		expect(prompt.user).toContain('excerpt is for context only');
	});

	it('migration prompt lists all issues and uses full document YAML', () => {
		const docYaml = 'spec:\n  macLearning: true\n  tunnelIndexPool: pool';
		const prompt = promptFixYamlMigration('26.4.2', 'BridgeDomain', schema, docYaml, [
			{
				message: 'must be object',
				fieldPath: 'spec.macLearning',
				issueKind: 'type'
			},
			{
				message: 'Unknown field',
				fieldPath: 'spec.tunnelIndexPool',
				issueKind: 'unknownField',
				relocationHint: {
					from: 'spec.tunnelIndexPool',
					to: 'spec.encapOptions.vxlan.tunnelIndexPool'
				}
			}
		]);

		expect(prompt.user).toContain('ISSUES TO FIX:');
		expect(prompt.user).toContain('spec.macLearning');
		expect(prompt.user).toContain('spec.tunnelIndexPool');
		expect(prompt.user).toContain(docYaml);
		expect(prompt.user).toContain('Fix every listed issue');
	});
});
