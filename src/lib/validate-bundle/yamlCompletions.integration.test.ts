import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStaticYaml } from '$lib/yaml/safeYaml';
import { buildYamlCompletions, type YamlCompletionContext } from './yamlCompletions';
import type { BundleResource } from './types';

const FABRIC_SCHEMA_PATH = resolve(
	process.cwd(),
	'static/resources/26.4.2/fabrics.fabrics.eda.nokia.com/v1.yaml'
);

function loadFabricSpecSchema(): unknown {
	const text = readFileSync(FABRIC_SCHEMA_PATH, 'utf8');
	const parsed = loadStaticYaml(text) as {
		schema?: { openAPIV3Schema?: { properties?: { spec?: unknown } } };
	};
	return parsed.schema?.openAPIV3Schema?.properties?.spec;
}

function fabricCtx(specSchema: unknown): YamlCompletionContext {
	const resource: BundleResource = {
		id: 'eda/lab-fabric/Fabric',
		docIndex: 0,
		kind: 'Fabric',
		apiVersion: 'fabrics.eda.nokia.com/v1',
		group: 'fabrics.eda.nokia.com',
		version: 'v1',
		name: 'lab-fabric',
		namespace: 'eda',
		data: {},
		doc: { data: {}, rawText: '', startLine: 0, index: 0 }
	};

	return {
		releaseFolder: 'resources/26.4.2',
		manifest: [
			{
				name: 'fabrics.fabrics.eda.nokia.com',
				kind: 'Fabric',
				group: 'fabrics.eda.nokia.com',
				versions: [{ name: 'v1' }]
			}
		],
		resources: [resource],
		schemas: new Map([
			[
				'/resources/26.4.2/fabrics.fabrics.eda.nokia.com/v1.yaml',
				{ spec: specSchema, isSpecRequired: true }
			]
		])
	};
}

const FABRIC_HEADER = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab-fabric
  namespace: eda
spec:
`;

describe('buildYamlCompletions (Fabric CRD integration)', () => {
	const specSchema = loadFabricSpecSchema();
	const ctx = fabricCtx(specSchema);

	it('suggests underlayProtocol children after underlayProtocol:', () => {
		const yaml = `${FABRIC_HEADER}  underlayProtocol:`;
		const line = yaml.split('\n').length;
		const column = yaml.split('\n').pop()!.length + 1;
		const labels = buildYamlCompletions(yaml, line, column, ctx).map((i) => i.label);
		expect(labels).toContain('bfd');
		expect(labels).toContain('bgp');
		expect(labels).toContain('protocols');
		expect(labels).not.toContain('overlayProtocol');
	});

	it('suggests bfd fields after bfd:', () => {
		const yaml = `${FABRIC_HEADER}  underlayProtocol:
    bfd:`;
		const line = yaml.split('\n').length;
		const column = yaml.split('\n').pop()!.length + 1;
		const labels = buildYamlCompletions(yaml, line, column, ctx).map((i) => i.label);
		expect(labels).toContain('enabled');
		expect(labels).toContain('desiredMinTransmitIntMs');
		expect(labels).not.toContain('underlayProtocol');
	});

	it('suggests bgp fields on new line under bgp', () => {
		const yaml = `${FABRIC_HEADER}  underlayProtocol:
    bgp:
      asnPool: asn-pool
      `;
		const line = yaml.split('\n').length;
		const labels = buildYamlCompletions(yaml, line, 7, ctx).map((i) => i.label);
		expect(labels).toContain('timers');
		expect(labels).toContain('asnPool');
		expect(labels).not.toContain('overlayProtocol');
		expect(labels).not.toContain('protocols');
	});

	it('suggests overlayProtocol.protocol enum values', () => {
		const yaml = `${FABRIC_HEADER}  overlayProtocol:
    protocol: `;
		const line = yaml.split('\n').length;
		const column = yaml.split('\n').pop()!.length;
		const labels = buildYamlCompletions(yaml, line, column, ctx).map((i) => i.label);
		expect(labels).toContain('EBGP');
		expect(labels).toContain('IBGP');
	});

	it('suggests leafs keys under spec.leafs', () => {
		const yaml = `${FABRIC_HEADER}  leafs:
    `;
		const line = yaml.split('\n').length;
		const labels = buildYamlCompletions(yaml, line, 5, ctx).map((i) => i.label);
		expect(labels).toContain('asnPool');
		expect(labels).toContain('leafNodeSelectors');
	});

	it('suggests top-level spec keys at spec root with loaded Fabric schema', () => {
		const yaml = `${FABRIC_HEADER}  `;
		const line = yaml.split('\n').length;
		const labels = buildYamlCompletions(yaml, line, 3, ctx).map((i) => i.label);
		expect(labels).toContain('leafs');
		expect(labels).toContain('underlayProtocol');
		expect(labels).toContain('overlayProtocol');
	});

	const USER_FABRIC_YAML = `${FABRIC_HEADER}  overlayProtocol:
    protocol: IBGP
  underlayProtocol:
    bfd:
      enabled: true
      desiredMinTransmitInt: 1000
    bgp:
      asnPool: asn-pool
      timers: {}
    protocol:
      - EBGP
`;

	it('suggests underlay sibling keys when bfd and bgp are already present', () => {
		const yaml = `${FABRIC_HEADER}  underlayProtocol:
    bfd:
      enabled: true
    bgp:
      asnPool: asn-pool
      timers: {}
    `;
		const line = yaml.split('\n').length;
		const labels = buildYamlCompletions(yaml, line, 5, ctx).map((i) => i.label);
		expect(labels).toContain('bfd');
		expect(labels).toContain('bgp');
		expect(labels).toContain('protocols');
		expect(labels).toContain('ospf');
		expect(labels).not.toContain('overlayProtocol');
	});

	it('suggests protocols when typing protocol key under underlayProtocol', () => {
		const yaml = `${FABRIC_HEADER}  underlayProtocol:
    bfd:
      enabled: true
    bgp:
      asnPool: asn-pool
    protocol:`;
		const line = yaml.split('\n').length;
		const labels = buildYamlCompletions(yaml, line, 12, ctx).map((i) => i.label);
		expect(labels).toContain('protocols');
		expect(labels).not.toContain('overlayProtocol');
	});

	it('filters enum values by typed prefix on array items', () => {
		const lines = USER_FABRIC_YAML.split('\n');
		const line = lines.findIndex((l) => l.includes('- EBGP')) + 1;
		const column = lines[line - 1]!.length;
		const labels = buildYamlCompletions(USER_FABRIC_YAML, line, column, ctx).map((i) => i.label);
		expect(labels).toEqual(['EBGP']);
	});

	it('suggests enum values on empty array item when protocol is misspelled', () => {
		const yaml = `${FABRIC_HEADER}  underlayProtocol:
    protocol:
      - `;
		const line = yaml.split('\n').length;
		const column = yaml.split('\n').pop()!.length;
		const labels = buildYamlCompletions(yaml, line, column, ctx).map((i) => i.label);
		expect(labels).toContain('EBGP');
		expect(labels).toContain('OSPFv2');
		expect(labels).toContain('OSPFv3');
	});

	it('suggests overlayProtocol.protocol enum values in user fabric snippet', () => {
		const yaml = `${FABRIC_HEADER}  overlayProtocol:
    protocol: `;
		const line = yaml.split('\n').length;
		const column = yaml.split('\n').pop()!.length;
		const labels = buildYamlCompletions(yaml, line, column, ctx).map((i) => i.label);
		expect(labels).toContain('IBGP');
		expect(labels).toContain('EBGP');
	});
});
