import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadStaticYaml } from '$lib/yaml/safeYaml';
import { walkUnknownFields } from './schemaValidator';
import { applySuggestedFix } from './applyIssueFix';
import { fixAllBundle } from './fixAllBundle';
import { deriveRequiredFieldFix } from './schemaSuggestedFix';
import { findSimilarSchemaProperty, collectSchemaProperties, getChildPropertySchema } from './schemaNavigation';
import { resolveYamlFieldContext } from './yamlFieldContext';
import { buildYamlHoverMarkdown } from './yamlHover';
import type { YamlCompletionContext } from './yamlSchemaKeys';
import type { BundleIssue, BundleResource } from './types';

const FABRIC_SCHEMA_PATH = resolve(
	process.cwd(),
	'static/resources/26.4.2/fabrics.fabrics.eda.nokia.com/v1.yaml'
);

const VALID_FABRIC_YAML = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
  namespace: eda
spec:
  borderLeafs:
    asnPool: asn-pool
    borderLeafNodeSelectors:
      - eda.nokia.com/role = borderleaf
    systemPoolIPv6: systemipv6-pool
  interSwitchLinks:
    linkSelectors:
      - eda.nokia.com/role = interSwitch
    unnumbered: IPv6
`;

function loadFabricSpecSchema(): unknown {
	const text = readFileSync(FABRIC_SCHEMA_PATH, 'utf8');
	const parsed = loadStaticYaml(text) as {
		schema?: { openAPIV3Schema?: { properties?: { spec?: unknown } } };
	};
	return parsed.schema?.openAPIV3Schema?.properties?.spec;
}

function makeFabricResource(yaml: string): BundleResource {
	return {
		id: 'fabric-0',
		name: 'lab',
		kind: 'Fabric',
		group: 'fabrics.eda.nokia.com',
		apiVersion: 'fabrics.eda.nokia.com/v1',
		version: 'v1',
		namespace: 'eda',
		docIndex: 0,
		data: loadStaticYaml(yaml) as Record<string, unknown>,
		doc: { data: {}, rawText: yaml, startLine: 0, index: 0 }
	};
}

describe('Fabric borderLeafs / interSwitchLinks validation', () => {
	const specSchema = loadFabricSpecSchema();

	it('walkUnknownFields produces no warnings for valid Fabric spec keys', () => {
		const resource = makeFabricResource(VALID_FABRIC_YAML);
		const issues: BundleIssue[] = [];
		walkUnknownFields(
			resource.data.spec,
			specSchema,
			'spec',
			resource.doc,
			'/spec/',
			issues,
			resource
		);
		expect(issues).toEqual([]);
	});

	it('findSimilarSchemaProperty returns null for exact schema keys on valid Fabric fields', () => {
		const borderLeafProps = collectSchemaProperties(
			getChildPropertySchema(specSchema, 'borderLeafs')
		)!;
		expect(findSimilarSchemaProperty('borderLeafNodeSelectors', borderLeafProps)).toBeNull();
		expect(findSimilarSchemaProperty('systemPoolIPv6', borderLeafProps)).toBeNull();

		const islProps = collectSchemaProperties(getChildPropertySchema(specSchema, 'interSwitchLinks'))!;
		expect(findSimilarSchemaProperty('linkSelectors', islProps)).toBeNull();
		expect(findSimilarSchemaProperty('unnumbered', islProps)).toBeNull();
	});

	it('flags systemPoolIPV6 as misspelled when schema defines systemPoolIPv6', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  borderLeafs:
    systemPoolIPV6: systemipv6-pool
`;
		const resource = makeFabricResource(yaml);
		const issues: BundleIssue[] = [];
		walkUnknownFields(
			resource.data.spec,
			specSchema,
			'spec',
			resource.doc,
			'/spec/',
			issues,
			resource
		);
		expect(issues).toHaveLength(1);
		expect(issues[0].message).toContain('Misspelled field');
		expect(issues[0].fieldPath).toBe('spec.borderLeafs.systemPoolIPV6');
		expect(issues[0].suggestedFix).toMatchObject({
			action: 'renameKey',
			field: 'systemPoolIPV6',
			value: 'systemPoolIPv6'
		});
	});

	it('applySuggestedFix renames systemPoolIPV6 to systemPoolIPv6 at nested path', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  borderLeafs:
    systemPoolIPV6: systemipv6-pool
`;
		const issue: BundleIssue = {
			id: 'fix-ipv6',
			severity: 'warning',
			category: 'schema',
			message: 'Misspelled field',
			docIndex: 1,
			fieldPath: 'spec.borderLeafs.systemPoolIPV6',
			suggestedFix: {
				action: 'renameKey',
				field: 'systemPoolIPV6',
				value: 'systemPoolIPv6'
			}
		};
		const updated = applySuggestedFix(yaml, issue);
		expect(updated).toContain('systemPoolIPv6: systemipv6-pool');
		expect(updated).not.toContain('systemPoolIPV6:');
	});

	it('flags protocol under underlayProtocol as misspelled protocols', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  underlayProtocol:
    protocol:
    - EBGP
`;
		const resource = makeFabricResource(yaml);
		const issues: BundleIssue[] = [];
		walkUnknownFields(
			resource.data.spec,
			specSchema,
			'spec',
			resource.doc,
			'/spec/',
			issues,
			resource
		);
		expect(issues).toHaveLength(1);
		expect(issues[0].message).toContain('Misspelled field');
		expect(issues[0].fieldPath).toBe('spec.underlayProtocol.protocol');
		expect(issues[0].suggestedFix).toMatchObject({
			action: 'renameKey',
			field: 'protocol',
			value: 'protocols'
		});
	});

	it('flags protocols under overlayProtocol as misspelled protocol', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  overlayProtocol:
    protocols: BGP
`;
		const resource = makeFabricResource(yaml);
		const issues: BundleIssue[] = [];
		walkUnknownFields(
			resource.data.spec,
			specSchema,
			'spec',
			resource.doc,
			'/spec/',
			issues,
			resource
		);
		expect(issues).toHaveLength(1);
		expect(issues[0].message).toContain('Misspelled field');
		expect(issues[0].fieldPath).toBe('spec.overlayProtocol.protocols');
		expect(issues[0].suggestedFix).toMatchObject({
			action: 'renameKey',
			field: 'protocols',
			value: 'protocol'
		});
	});

	it('allows protocol under overlayProtocol (singular is correct there)', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  overlayProtocol:
    protocol: IBGP
`;
		const resource = makeFabricResource(yaml);
		const issues: BundleIssue[] = [];
		walkUnknownFields(
			resource.data.spec,
			specSchema,
			'spec',
			resource.doc,
			'/spec/',
			issues,
			resource
		);
		expect(issues).toEqual([]);
	});

	it('flags protocol nested under bgp as misplaced underlayProtocol.protocols', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  underlayProtocol:
    bgp:
      protocol:
      - EBGP
`;
		const resource = makeFabricResource(yaml);
		const issues: BundleIssue[] = [];
		walkUnknownFields(
			resource.data.spec,
			specSchema,
			'spec',
			resource.doc,
			'/spec/',
			issues,
			resource
		);
		expect(issues).toHaveLength(1);
		expect(issues[0].message).toContain('Misplaced field');
		expect(issues[0].fieldPath).toBe('spec.underlayProtocol.bgp.protocol');
		expect(issues[0].message).toContain('spec.underlayProtocol.protocols');
		expect(issues[0].suggestedFix).toBeUndefined();
	});

	it('walkUnknownFields and applySuggestedFix fix root and nested systemPoolIPV6', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: test
spec:
  systemPoolIPV6: pool-a
  borderLeafs:
    systemPoolIPV6: pool-b
`;
		const resource = makeFabricResource(yaml);
		const issues: BundleIssue[] = [];
		walkUnknownFields(
			resource.data.spec,
			specSchema,
			'spec',
			resource.doc,
			'/spec/',
			issues,
			resource
		);
		expect(issues).toHaveLength(2);
		expect(issues.map((i) => i.fieldPath).sort()).toEqual([
			'spec.borderLeafs.systemPoolIPV6',
			'spec.systemPoolIPV6'
		]);
		for (const issue of issues) {
			expect(issue.suggestedFix).toMatchObject({
				action: 'renameKey',
				field: 'systemPoolIPV6',
				value: 'systemPoolIPv6'
			});
		}

		let updated = yaml;
		for (const issue of issues) {
			updated = applySuggestedFix(updated!, issue)!;
		}
		expect(updated).toContain('systemPoolIPv6: pool-a');
		expect(updated).toContain('systemPoolIPv6: pool-b');
		expect(updated).not.toMatch(/systemPoolIPV6:/);
	});

	it('applySuggestedFix sets unnumbered enum to canonical IPv6', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  interSwitchLinks:
    unnumbered: ipv6
`;
		const issue: BundleIssue = {
			id: 'fix-enum',
			severity: 'error',
			category: 'schema',
			message: 'enum mismatch',
			docIndex: 1,
			fieldPath: 'spec.interSwitchLinks.unnumbered',
			suggestedFix: {
				action: 'setValue',
				field: 'unnumbered',
				value: 'IPv6'
			}
		};
		const updated = applySuggestedFix(yaml, issue);
		expect(updated).toContain('unnumbered: IPv6');
	});

	it('flags minEchoReceiveInterval as misspelled requiredMinEchoReceiveIntMs on overlay BFD', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  overlayProtocol:
    bfd:
      enabled: true
      minEchoReceiveInterval: 1000
`;
		const resource = makeFabricResource(yaml);
		const issues: BundleIssue[] = [];
		walkUnknownFields(
			resource.data.spec,
			specSchema,
			'spec',
			resource.doc,
			'/spec/',
			issues,
			resource
		);
		expect(issues).toHaveLength(1);
		expect(issues[0].fieldPath).toBe('spec.overlayProtocol.bfd.minEchoReceiveInterval');
		expect(issues[0].suggestedFix).toMatchObject({
			action: 'renameKey',
			field: 'minEchoReceiveInterval',
			value: 'requiredMinEchoReceiveIntMs'
		});
	});

	it('applySuggestedFix clamps desiredMinTransmitIntMs to schema maximum', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  overlayProtocol:
    bfd:
      enabled: true
      desiredMinTransmitIntMs: 500000
`;
		const issue: BundleIssue = {
			id: 'clamp-bfd',
			severity: 'error',
			category: 'schema',
			message: 'must be <= 100000',
			docIndex: 1,
			fieldPath: 'spec.overlayProtocol.bfd.desiredMinTransmitIntMs',
			suggestedFix: {
				action: 'setValue',
				field: 'desiredMinTransmitIntMs',
				value: '100000'
			}
		};
		const updated = applySuggestedFix(yaml, issue);
		expect(updated).toContain('desiredMinTransmitIntMs: 100000');
	});

	it('applySuggestedFix adds missing underlayProtocol.protocols', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  underlayProtocol:
    bgp: {}
`;
		const issue: BundleIssue = {
			id: 'add-protocols',
			severity: 'error',
			category: 'schema',
			message: 'spec.underlayProtocol.protocols is required',
			docIndex: 1,
			fieldPath: 'spec.underlayProtocol.protocols',
			suggestedFix: {
				action: 'addField',
				field: 'protocols',
				value: '[]'
			}
		};
		const updated = applySuggestedFix(yaml, issue);
		expect(updated).toContain('protocols: []');
	});

	it('renames protocol to protocols instead of adding empty protocols array', async () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  underlayProtocol:
    protocol: EBGP
`;
		const requiredFix = deriveRequiredFieldFix(
			{
				id: 'req-protocol',
				severity: 'error',
				category: 'schema',
				message: 'spec.underlayProtocol.protocols is required',
				fieldPath: 'spec.underlayProtocol.protocols'
			},
			specSchema,
			loadStaticYaml(yaml).spec
		);
		expect(requiredFix).toMatchObject({
			action: 'renameKey',
			field: 'protocol',
			value: 'protocols'
		});

		const resource = makeFabricResource(yaml);
		const issues: BundleIssue[] = [];
		walkUnknownFields(
			resource.data.spec,
			specSchema,
			'spec',
			resource.doc,
			'/spec/',
			issues,
			resource
		);
		expect(issues).toHaveLength(1);
		expect(issues[0].suggestedFix).toMatchObject({
			action: 'renameKey',
			field: 'protocol',
			value: 'protocols'
		});

		const renameIssue: BundleIssue = {
			...issues[0],
			id: 'rename-protocol'
		};
		const duplicateAddIssues: BundleIssue[] = [
			{
				id: 'dup-1',
				severity: 'error',
				category: 'schema',
				message: 'spec.underlayProtocol.protocols is required',
				docIndex: 1,
				fieldPath: 'spec.underlayProtocol.protocols',
				suggestedFix: requiredFix
			},
			{
				id: 'dup-2',
				severity: 'error',
				category: 'schema',
				message: 'spec.underlayProtocol.protocols is required',
				docIndex: 1,
				fieldPath: 'spec.underlayProtocol.protocols',
				suggestedFix: {
					action: 'addField',
					field: 'protocols',
					value: '[]'
				}
			}
		];

		const result = await fixAllBundle(yaml, [renameIssue, ...duplicateAddIssues]);
		expect(result.ok).toBe(true);
		expect(result.yaml).toContain('protocols: EBGP');
		expect(result.yaml).not.toContain('protocol:');
		expect(result.yaml).not.toMatch(/protocols:\s*\[\]/);
		expect((result.yaml.match(/protocols:/g) ?? []).length).toBe(1);
	});

	const USER_FABRIC_PROTOCOL_YAML = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  overlayProtocol:
    bfd:
      enabled: true
    protocols: BGP
  underlayProtocol:
    bfd:
      enabled: true
    bgp:
      timers: {}
    protocol:
    - EBGP
`;

	const USER_EXACT_FABRIC_PROTOCOL_YAML = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  overlayProtocol:
    bfd:
      enabled: true
    protocols: IBGP
  underlayProtocol:
    bfd:
      enabled: true
    bgp:
      timers: {}
    protocol:
    - EBGP
`;

	it('flags both underlay protocol and overlay protocols typos in user fabric snippet', () => {
		const resource = makeFabricResource(USER_FABRIC_PROTOCOL_YAML);
		const issues: BundleIssue[] = [];
		walkUnknownFields(
			resource.data.spec,
			specSchema,
			'spec',
			resource.doc,
			'/spec/',
			issues,
			resource
		);
		expect(issues).toHaveLength(2);
		const byPath = Object.fromEntries(issues.map((i) => [i.fieldPath, i]));
		expect(byPath['spec.underlayProtocol.protocol']?.suggestedFix).toMatchObject({
			action: 'renameKey',
			field: 'protocol',
			value: 'protocols'
		});
		expect(byPath['spec.overlayProtocol.protocols']?.suggestedFix).toMatchObject({
			action: 'renameKey',
			field: 'protocols',
			value: 'protocol'
		});
	});

	it('fixAllBundle renames both protocol keys in user fabric snippet', async () => {
		const resource = makeFabricResource(USER_FABRIC_PROTOCOL_YAML);
		const issues: BundleIssue[] = [];
		walkUnknownFields(
			resource.data.spec,
			specSchema,
			'spec',
			resource.doc,
			'/spec/',
			issues,
			resource
		);
		const result = await fixAllBundle(USER_FABRIC_PROTOCOL_YAML, issues);
		expect(result.ok).toBe(true);
		expect(result.yaml).toMatch(
			/underlayProtocol:[\s\S]*?protocols:\s*\n\s*- EBGP/
		);
		expect(result.yaml).toMatch(/overlayProtocol:[\s\S]*?protocol: BGP/);
		expect(result.yaml).not.toMatch(
			/underlayProtocol:[\s\S]*?overlayProtocol:[\s\S]*?protocol:\s*\n\s*- EBGP/
		);
		expect(result.yaml).not.toMatch(
			/overlayProtocol:[\s\S]*?underlayProtocol:[\s\S]*?protocols: BGP/
		);
	});

	it('fixAllBundle fixes exact user YAML with IBGP overlay and EBGP underlay list', async () => {
		const resource = makeFabricResource(USER_EXACT_FABRIC_PROTOCOL_YAML);
		const issues: BundleIssue[] = [];
		walkUnknownFields(
			resource.data.spec,
			specSchema,
			'spec',
			resource.doc,
			'/spec/',
			issues,
			resource
		);
		expect(issues).toHaveLength(2);

		const aiFix = vi.fn(async () => ({
			fixable: true,
			fixedYaml: USER_EXACT_FABRIC_PROTOCOL_YAML
		}));
		const result = await fixAllBundle(USER_EXACT_FABRIC_PROTOCOL_YAML, issues, {
			includeAi: true,
			aiFix,
			manifest: [],
			releaseFolder: '26.4.2'
		});
		expect(result.ok).toBe(true);
		expect(result.suggestedFixCount).toBe(2);
		expect(result.yaml).toMatch(/overlayProtocol:[\s\S]*?protocol: IBGP/);
		expect(result.yaml).toMatch(
			/underlayProtocol:[\s\S]*?protocols:\s*\n\s*- EBGP/
		);
		expect(result.yaml).not.toContain('protocols: IBGP');
		expect(result.yaml).not.toMatch(/underlayProtocol:[\s\S]*?\n\s+protocol:/);
		expect(aiFix).not.toHaveBeenCalled();
	});

	it('applySuggestedFix fixes each protocol issue at the correct nested path', () => {
		const resource = makeFabricResource(USER_EXACT_FABRIC_PROTOCOL_YAML);
		const issues: BundleIssue[] = [];
		walkUnknownFields(
			resource.data.spec,
			specSchema,
			'spec',
			resource.doc,
			'/spec/',
			issues,
			resource
		);
		const byPath = Object.fromEntries(issues.map((i) => [i.fieldPath, i]));

		let updated = USER_EXACT_FABRIC_PROTOCOL_YAML;
		updated = applySuggestedFix(updated, byPath['spec.overlayProtocol.protocols']!)!;
		expect(updated).toContain('protocol: IBGP');
		expect(updated).not.toContain('protocols: IBGP');
		expect(updated).toMatch(/underlayProtocol:[\s\S]*?\n\s+protocol:\s*\n\s+- EBGP/);

		updated = applySuggestedFix(updated, byPath['spec.underlayProtocol.protocol']!)!;
		expect(updated).toMatch(/underlayProtocol:[\s\S]*?protocols:\s*\n\s+- EBGP/);
		expect(updated).toMatch(/overlayProtocol:[\s\S]*?protocol: IBGP/);
		expect(updated).not.toMatch(/underlayProtocol:[\s\S]*?\n\s+protocol:/);
	});
});

function fabricHoverCtx(yaml: string): YamlCompletionContext {
	const specSchema = loadFabricSpecSchema();
	const resource = makeFabricResource(yaml);
	return {
		resources: [resource],
		manifest: [
			{
				name: 'fabrics.fabrics.eda.nokia.com',
				kind: 'Fabric',
				group: 'fabrics.eda.nokia.com',
				versions: [{ name: 'v1' }]
			}
		],
		schemas: new Map([
			['/resources/26.4.2/fabrics.fabrics.eda.nokia.com/v1.yaml', { spec: specSchema, isSpecRequired: true }]
		]),
		releaseFolder: 'resources/26.4.2'
	};
}

function fabricHoverMarkdown(yaml: string, line: number, column: number): string | null {
	const ctx = fabricHoverCtx(yaml);
	const lines = yaml.split('\n');
	const fieldCtx = resolveYamlFieldContext(yaml, line, column, ctx);
	if (!fieldCtx) return null;
	return buildYamlHoverMarkdown(fieldCtx, lines[line - 1]!, column);
}

describe('Fabric protocol hover', () => {
	const USER_FABRIC_PROTOCOL_YAML = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  overlayProtocol:
    bfd:
      enabled: true
    protocols: BGP
  underlayProtocol:
    bfd:
      enabled: true
    bgp:
      timers: {}
    protocol:
    - EBGP
`;

	it('warns on protocol key under underlayProtocol', () => {
		const line = USER_FABRIC_PROTOCOL_YAML.split('\n').findIndex((l) => /^\s+protocol:/.test(l)) + 1;
		const col = USER_FABRIC_PROTOCOL_YAML.split('\n')[line - 1]!.indexOf('protocol') + 3;
		const md = fabricHoverMarkdown(USER_FABRIC_PROTOCOL_YAML, line, col);
		expect(md).toMatch(/Misspelled field/i);
		expect(md).toContain('`protocols`');
	});

	it('warns on protocols key and value under overlayProtocol', () => {
		const line =
			USER_FABRIC_PROTOCOL_YAML.split('\n').findIndex((l) => /^\s+protocols: BGP/.test(l)) + 1;
		const keyCol = USER_FABRIC_PROTOCOL_YAML.split('\n')[line - 1]!.indexOf('protocols') + 3;
		const valueCol = USER_FABRIC_PROTOCOL_YAML.split('\n')[line - 1]!.indexOf('BGP') + 1;
		expect(fabricHoverMarkdown(USER_FABRIC_PROTOCOL_YAML, line, keyCol)).toMatch(/Misspelled field/i);
		const valueMd = fabricHoverMarkdown(USER_FABRIC_PROTOCOL_YAML, line, valueCol);
		expect(valueMd).toMatch(/Misspelled field/i);
		expect(valueMd).not.toContain('*Required*');
	});

	it('shows valid schema for protocol under overlayProtocol and protocols under underlayProtocol', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  overlayProtocol:
    protocol: IBGP
  underlayProtocol:
    protocols:
    - EBGP
`;
		const overlayLine = yaml.split('\n').findIndex((l) => l.includes('protocol: IBGP')) + 1;
		const underlayLine = yaml.split('\n').findIndex((l) => /^\s+protocols:/.test(l)) + 1;
		expect(fabricHoverMarkdown(yaml, overlayLine, 18)).not.toMatch(/Misspelled field/i);
		expect(fabricHoverMarkdown(yaml, underlayLine, 6)).not.toMatch(/Misspelled field/i);
	});
});
