import { describe, expect, it } from 'vitest';
import {
	buildYamlCompletions,
	yamlPropertyInsertText,
	yamlValueInsertText,
	type YamlCompletionContext
} from './yamlCompletions';
import type { BundleResource } from './types';

const fabricSpecSchema = {
	type: 'object',
	properties: {
		leafs: {
			type: 'object',
			properties: {
				asnPool: {
					type: 'string',
					description: 'Reference to an IndexAllocationPool pool to use for ASN allocations.'
				},
				leafNodeSelectors: {
					type: 'array',
					items: { type: 'string' }
				}
			},
			required: ['asnPool']
		}
	}
};

function mockResource(partial: Partial<BundleResource> & Pick<BundleResource, 'docIndex'>): BundleResource {
	return {
		id: 'eda/default/Fabric/lab-fabric',
		docIndex: partial.docIndex,
		kind: partial.kind ?? 'Fabric',
		apiVersion: partial.apiVersion ?? 'fabrics.eda.nokia.com/v1',
		group: partial.group ?? 'fabrics.eda.nokia.com',
		version: 'v1',
		name: partial.name ?? 'lab-fabric',
		namespace: partial.namespace ?? 'eda',
		data: partial.data ?? {},
		doc: partial.doc ?? { data: {}, rawText: '', startLine: 0, index: partial.docIndex }
	};
}

const YAML = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab-fabric
  namespace: eda
spec:
  leafs:
    asnPool: 
---
apiVersion: allocations.eda.nokia.com/v1
kind: IndexAllocationPool
metadata:
  name: asn-pool
  namespace: eda
spec: {}
`;

describe('buildYamlCompletions', () => {
	const ctx: YamlCompletionContext = {
		releaseFolder: 'resources/26.4.2',
		manifest: [
			{
				name: 'fabrics.fabrics.eda.nokia.com',
				kind: 'Fabric',
				group: 'fabrics.eda.nokia.com',
				versions: [{ name: 'v1' }]
			},
			{
				name: 'indexallocationpools.allocations.eda.nokia.com',
				kind: 'IndexAllocationPool',
				group: 'allocations.eda.nokia.com',
				versions: [{ name: 'v1' }]
			}
		],
		resources: [
			mockResource({
				docIndex: 0,
				kind: 'Fabric',
				name: 'lab-fabric',
				group: 'fabrics.eda.nokia.com'
			}),
			mockResource({
				docIndex: 1,
				kind: 'IndexAllocationPool',
				name: 'asn-pool',
				group: 'allocations.eda.nokia.com'
			})
		],
		schemas: new Map([
			[
				'/resources/26.4.2/fabrics.fabrics.eda.nokia.com/v1.yaml',
				{ spec: fabricSpecSchema, isSpecRequired: true }
			]
		])
	};

	it('suggests spec root keys when cursor is on spec: value position', () => {
		const fabricYaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab-fabric
  namespace: eda
spec:`;
		const line = fabricYaml.split('\n').length;
		const column = fabricYaml.split('\n').pop()!.length + 1;
		const items = buildYamlCompletions(fabricYaml, line, column, ctx);
		const labels = items.map((i) => i.label);
		expect(labels).toContain('leafs');
		expect(labels.length).toBeGreaterThan(0);
	});

	it('suggests manifest root keys without completion context', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
`;
		const line = yaml.split('\n').length;
		const labels = buildYamlCompletions(yaml, line, 1, null).map((i) => i.label);
		expect(labels).toContain('metadata');
		expect(labels).toContain('spec');
	});

	it('suggests metadata keys inside metadata block', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  `;
		const line = yaml.split('\n').length;
		const labels = buildYamlCompletions(yaml, line, 3, null).map((i) => i.label);
		expect(labels).toContain('name');
		expect(labels).toContain('namespace');
	});

	it('suggests sibling keys under spec.leafs', () => {
		const lines = YAML.split('\n');
		const leafsIdx = lines.findIndex((l) => l.trim() === 'leafs:');
		const yaml = [...lines.slice(0, leafsIdx + 1), '    '].join('\n');
		const line = yaml.split('\n').length;
		const items = buildYamlCompletions(yaml, line, 5, ctx);
		const labels = items.map((i) => i.label);
		expect(labels).toContain('asnPool');
		expect(labels).toContain('leafNodeSelectors');
	});

	it('suggests IndexAllocationPool name for asnPool value', () => {
		const lines = YAML.split('\n');
		const line = lines.findIndex((l) => l.includes('asnPool:')) + 1;
		const column = lines[line - 1]!.length;
		const items = buildYamlCompletions(YAML, line, column, ctx);
		expect(items.some((i) => i.label === 'asn-pool' && i.kind === 'reference')).toBe(true);
	});

	it('suggests protocol enum values when underlayProtocol uses typo key protocol', () => {
		const underlaySpecSchema = {
			type: 'object',
			properties: {
				underlayProtocol: {
					type: 'object',
					properties: {
						bfd: {
							type: 'object',
							properties: {
								enabled: { type: 'boolean' }
							}
						},
						protocols: {
							type: 'array',
							items: {
								type: 'string',
								enum: ['EBGP', 'OSPFv2', 'OSPFv3']
							}
						}
					}
				},
				overlayProtocol: { type: 'object', properties: {} }
			}
		};

		const fabricYaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab-fabric
  namespace: eda
spec:
  underlayProtocol:
    bfd:
      enabled: true
    protocol:
      - `;

		const fabricCtx: YamlCompletionContext = {
			...ctx,
			schemas: new Map([
				[
					'/resources/26.4.2/fabrics.fabrics.eda.nokia.com/v1.yaml',
					{ spec: underlaySpecSchema, isSpecRequired: true }
				]
			])
		};

		const line = fabricYaml.split('\n').length;
		const column = fabricYaml.split('\n').pop()!.length + 1;
		const items = buildYamlCompletions(fabricYaml, line, column, fabricCtx);
		const labels = items.map((i) => i.label);

		expect(labels).toContain('EBGP');
		expect(labels).toContain('OSPFv2');
		expect(labels).toContain('OSPFv3');
	});

	it('suggests protocol enum values inside underlayProtocol.protocols array', () => {
		const underlaySpecSchema = {
			type: 'object',
			properties: {
				underlayProtocol: {
					type: 'object',
					properties: {
						bfd: {
							type: 'object',
							properties: {
								enabled: { type: 'boolean' }
							}
						},
						protocols: {
							type: 'array',
							items: {
								type: 'string',
								enum: ['EBGP', 'OSPFv2', 'OSPFv3']
							}
						}
					}
				},
				overlayProtocol: { type: 'object', properties: {} }
			}
		};

		const fabricYaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab-fabric
  namespace: eda
spec:
  underlayProtocol:
    bfd:
      enabled: true
    protocols:
      - `;

		const fabricCtx: YamlCompletionContext = {
			...ctx,
			schemas: new Map([
				[
					'/resources/26.4.2/fabrics.fabrics.eda.nokia.com/v1.yaml',
					{ spec: underlaySpecSchema, isSpecRequired: true }
				]
			])
		};

		const line = fabricYaml.split('\n').length;
		const column = fabricYaml.split('\n').pop()!.length + 1;
		const items = buildYamlCompletions(fabricYaml, line, column, fabricCtx);
		const labels = items.map((i) => i.label);

		expect(labels).toContain('EBGP');
		expect(labels).toContain('OSPFv2');
		expect(labels).not.toContain('overlayProtocol');
		expect(labels).not.toContain('underlayProtocol');
	});

	it('does not suggest root spec keys when completing inside a nested array field', () => {
		const underlaySpecSchema = {
			type: 'object',
			properties: {
				underlayProtocol: {
					type: 'object',
					properties: {
						bfd: {
							type: 'object',
							properties: {
								enabled: { type: 'boolean' }
							}
						},
						protocols: {
							type: 'array',
							items: { type: 'string', enum: ['EBGP', 'OSPFv2', 'OSPFv3'] }
						}
					}
				},
				overlayProtocol: { type: 'object', properties: { protocol: { type: 'string' } } }
			}
		};

		const fabricYaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab-fabric
  namespace: eda
spec:
  underlayProtocol:
    bfd:
      enabled: true
    protocols:
      - EBGP`;

		const fabricCtx: YamlCompletionContext = {
			...ctx,
			schemas: new Map([
				[
					'/resources/26.4.2/fabrics.fabrics.eda.nokia.com/v1.yaml',
					{ spec: underlaySpecSchema, isSpecRequired: true }
				]
			])
		};

		const line = fabricYaml.split('\n').length;
		const column = fabricYaml.split('\n').pop()!.length;
		const items = buildYamlCompletions(fabricYaml, line, column, fabricCtx);
		const labels = items.map((i) => i.label);

		expect(labels).not.toContain('overlayProtocol');
		expect(labels).not.toContain('underlayProtocol');
	});
});

describe('yamlPropertyInsertText', () => {
	it('adds colon and space when the line has no colon after the key', () => {
		const line = '  systemPool';
		expect(yamlPropertyInsertText(line, 3, 15, 'systemPoolIPv6')).toBe('systemPoolIPv6: ');
	});

	it('inserts key only when colon already follows the replaced range', () => {
		const line = '  systemPoolIPv6:';
		expect(yamlPropertyInsertText(line, 3, 18, 'systemPoolIPv6')).toBe('systemPoolIPv6');
	});

	it('inserts key only when colon is inside the replaced region', () => {
		const line = '  systemPoolIPv6: systemipv6-pool';
		expect(yamlPropertyInsertText(line, 3, 19, 'systemPoolIPv6')).toBe('systemPoolIPv6');
	});
});

describe('yamlValueInsertText', () => {
	it('quotes values with spaces for string fields', () => {
		expect(yamlValueInsertText('my pool', { referencedKinds: [], required: false, type: 'string' })).toBe(
			'"my pool"'
		);
	});

	it('leaves simple values unquoted', () => {
		expect(yamlValueInsertText('systemipv6-pool', { referencedKinds: [], required: false, type: 'string' })).toBe(
			'systemipv6-pool'
		);
	});
});

describe('required field completions', () => {
	const completionCtx: YamlCompletionContext = {
		releaseFolder: 'resources/26.4.2',
		manifest: [
			{
				name: 'fabrics.fabrics.eda.nokia.com',
				kind: 'Fabric',
				group: 'fabrics.eda.nokia.com',
				versions: [{ name: 'v1' }]
			}
		],
		resources: [
			mockResource({
				docIndex: 0,
				kind: 'Fabric',
				name: 'lab-fabric',
				group: 'fabrics.eda.nokia.com'
			})
		],
		schemas: new Map([
			['/resources/26.4.2/fabrics.fabrics.eda.nokia.com/v1.yaml', { spec: fabricSpecSchema, isSpecRequired: true }]
		])
	};

	it('marks required spec keys with required detail', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
  namespace: eda
spec:
  leafs:
    `;
		const line = yaml.split('\n').length;
		const items = buildYamlCompletions(yaml, line, 5, completionCtx);
		const asnPool = items.find((i) => i.label === 'asnPool');
		expect(asnPool?.detail).toBe('required');
		expect(asnPool?.documentation).toContain('IndexAllocationPool');
	});
});
