import { describe, expect, it } from 'vitest';
import { walkUnknownFields } from './schemaValidator';
import type { BundleIssue, BundleResource } from './types';

function makeResource(spec: Record<string, unknown>): BundleResource {
	const rawText = `apiVersion: test.eda.nokia.com/v1
kind: TestResource
metadata:
  name: test
spec:
  members:
    - name: one
      unknownField: value
`;
	return {
		id: 'test-resource-0',
		name: 'test',
		kind: 'TestResource',
		group: 'test.eda.nokia.com',
		apiVersion: 'test.eda.nokia.com/v1',
		version: 'v1',
		namespace: '',
		docIndex: 0,
		data: {
			apiVersion: 'test.eda.nokia.com/v1',
			kind: 'TestResource',
			metadata: { name: 'test' },
			spec
		},
		doc: {
			data: {},
			rawText,
			startLine: 0,
			index: 0
		}
	};
}

describe('walkUnknownFields', () => {
	it('reports unknown fields inside array items', () => {
		const resource = makeResource({
			members: [{ name: 'one', unknownField: 'value' }]
		});
		const schema = {
			type: 'object',
			properties: {
				members: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							name: { type: 'string' }
						}
					}
				}
			}
		};
		const issues: BundleIssue[] = [];

		walkUnknownFields(resource.data.spec, schema, 'spec', resource.doc, '/spec/', issues, resource);

		const unknown = issues.filter((i) => i.message.includes('Unknown field'));
		expect(unknown).toHaveLength(1);
		expect(unknown[0].fieldPath).toBe('spec.members[0].unknownField');
		expect(unknown[0].message).toContain('TestResource');
	});

	it('flags keys that differ only by IPv4/IPv6 casing as misspelled', () => {
		const resource = makeResource({
			spines: { systemPoolIPV6: 'pool-a' }
		});
		const schema = {
			type: 'object',
			properties: {
				spines: {
					type: 'object',
					properties: {
						systemPoolIPv6: { type: 'string' }
					}
				}
			}
		};
		const issues: BundleIssue[] = [];

		walkUnknownFields(resource.data.spec, schema, 'spec', resource.doc, '/spec/', issues, resource);

		expect(issues).toHaveLength(1);
		expect(issues[0].message).toContain('Misspelled field');
		expect(issues[0].suggestedFix).toEqual({
			action: 'renameKey',
			field: 'systemPoolIPV6',
			value: 'systemPoolIPv6',
			line: undefined
		});
	});

	it('flags true typos that are not normalization matches', () => {
		const resource = makeResource({
			spines: { systemPollIPv4: 'pool-a' }
		});
		const schema = {
			type: 'object',
			properties: {
				spines: {
					type: 'object',
					properties: {
						systemPoolIPv4: { type: 'string' }
					}
				}
			}
		};
		const issues: BundleIssue[] = [];

		walkUnknownFields(resource.data.spec, schema, 'spec', resource.doc, '/spec/', issues, resource);

		expect(issues).toHaveLength(1);
		expect(issues[0].message).toContain('Misspelled field');
	});

	it('does not flag known nested object fields', () => {
		const resource = makeResource({
			members: [{ name: 'one' }]
		});
		const schema = {
			type: 'object',
			properties: {
				members: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							name: { type: 'string' }
						}
					}
				}
			}
		};
		const issues: BundleIssue[] = [];

		walkUnknownFields(resource.data.spec, schema, 'spec', resource.doc, '/spec/', issues, resource);

		expect(issues).toHaveLength(0);
	});

	it('reports nested unknown fields in doc 2 when doc 1 has a parent-path issue', () => {
		const schema = {
			type: 'object',
			properties: {
				spines: {
					type: 'object',
					properties: {
						name: { type: 'string' }
					}
				}
			}
		};
		const issues: BundleIssue[] = [
			{
				id: 'ajv-doc1',
				severity: 'error',
				category: 'schema',
				message: 'spec.spines is invalid',
				docIndex: 1,
				fieldPath: 'spec.spines'
			}
		];
		const resource = makeResource({
			spines: { name: 'two', badNested: 'value' }
		});
		resource.docIndex = 1;
		resource.doc.index = 1;
		resource.doc.rawText = `spec:
  spines:
    name: two
    badNested: value
`;

		walkUnknownFields(resource.data.spec, schema, 'spec', resource.doc, '/spec/', issues, resource);

		const doc2Nested = issues.filter(
			(i) => i.docIndex === 2 && i.fieldPath === 'spec.spines.badNested'
		);
		expect(doc2Nested).toHaveLength(1);
	});

	it('suggests renameKey for singular protocol vs plural protocols', () => {
		const resource = makeResource({
			bgp: { protocol: ['EBGP'] }
		});
		const schema = {
			type: 'object',
			properties: {
				bgp: {
					type: 'object',
					properties: {
						protocols: {
							type: 'array',
							items: { type: 'string', enum: ['EBGP', 'OSPF', 'ISIS'] }
						}
					}
				}
			}
		};
		const issues: BundleIssue[] = [];

		walkUnknownFields(resource.data.spec, schema, 'spec', resource.doc, '/spec/', issues, resource);

		expect(issues).toHaveLength(1);
		expect(issues[0].message).toContain('Misspelled field');
		expect(issues[0].suggestedFix).toMatchObject({
			action: 'renameKey',
			field: 'protocol',
			value: 'protocols'
		});
	});
});
