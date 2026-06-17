import { describe, expect, it, vi } from 'vitest';
import { fixAllBundle, isAiUnavailableResult } from './fixAllBundle';
import type { BundleIssue } from './types';

const SAMPLE = `apiVersion: Topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: lab
  namespace: eda`;

describe('fixAllBundle', () => {
	it('applies suggested fixes in one pass', async () => {
		const issues: BundleIssue[] = [
			{
				id: '1',
				severity: 'error',
				category: 'schema',
				message: 'Invalid apiVersion',
				docIndex: 1,
				line: 1,
				suggestedFix: { field: 'apiVersion', value: 'topologies.eda.nokia.com/v1', line: 1 }
			}
		];

		const result = await fixAllBundle(SAMPLE, issues);
		expect(result.ok).toBe(true);
		expect(result.suggestedFixCount).toBe(1);
		expect(result.aiFixCount).toBe(0);
		expect(result.yaml).toContain('apiVersion: topologies.eda.nokia.com/v1');
	});

	it('returns parseIssue when YAML is invalid and AI is unavailable', async () => {
		const result = await fixAllBundle('kind: [broken', []);
		expect(result.ok).toBe(false);
		expect(result.parseIssue).toBeTruthy();
		expect(result.beforeYaml).toBe(result.afterYaml);
		expect(result.changes).toHaveLength(0);
	});

	it('returns ok:false when parse errors block fixes with no yaml changes', async () => {
		const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: topology
metadata:
  name: lab
---
kind: [broken`;

		const issues: BundleIssue[] = [
			{
				id: '1',
				severity: 'warning',
				category: 'schema',
				message: 'Kind casing',
				docIndex: 1,
				line: 2,
				suggestedFix: { field: 'kind', value: 'Topology', line: 2 }
			}
		];

		const result = await fixAllBundle(yaml, issues);
		expect(result.ok).toBe(false);
		expect(result.parseIssue).toBeTruthy();
		expect(result.beforeYaml).toBe(result.afterYaml);
		expect(result.changes).toHaveLength(0);
	});

	it('applies suggested fixes for warnings', async () => {
		const issues: BundleIssue[] = [
			{
				id: '1',
				severity: 'warning',
				category: 'schema',
				message: 'Kind casing',
				docIndex: 1,
				line: 2,
				suggestedFix: { field: 'kind', value: 'Topology', line: 2 }
			}
		];

		const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: topology
metadata:
  name: lab
  namespace: eda`;

		const result = await fixAllBundle(yaml, issues);
		expect(result.ok).toBe(true);
		expect(result.suggestedFixCount).toBe(1);
		expect(result.remainingWarnings).toBe(0);
		expect(result.yaml).toContain('kind: Topology');
		expect(result.beforeYaml).toBe(yaml);
		expect(result.afterYaml).toBe(result.yaml);
		expect(result.beforeYaml).not.toBe(result.afterYaml);
	});

	it('returns full multi-document bundle in beforeYaml and afterYaml for review', async () => {
		const fabricDoc = `apiVersion: fabrics.eda.nokia.com/v1
kind: fabric
metadata:
  name: dc1
spec:
  spines:
    asnPool: asn-pool`;

		const topologyDoc = `apiVersion: topologies.eda.nokia.com/v1
kind: topology
metadata:
  name: dc1-topo
  namespace: eda`;

		const yaml = `${fabricDoc}
---
${topologyDoc}`;

		const issues: BundleIssue[] = [
			{
				id: 'fabric-kind',
				severity: 'warning',
				category: 'schema',
				message: 'Kind casing',
				docIndex: 1,
				line: 2,
				suggestedFix: { field: 'kind', value: 'Fabric', line: 2 }
			},
			{
				id: 'topo-kind',
				severity: 'warning',
				category: 'schema',
				message: 'Kind casing',
				docIndex: 2,
				line: 2,
				suggestedFix: { field: 'kind', value: 'Topology', line: 2 }
			}
		];

		const result = await fixAllBundle(yaml, issues);

		expect(result.ok).toBe(true);
		expect(result.beforeYaml).toBe(yaml);
		expect(result.afterYaml).toContain('kind: Fabric');
		expect(result.afterYaml).toContain('kind: Topology');
		expect(result.afterYaml).toContain('---');
		expect(result.afterYaml.split('---').length).toBe(yaml.split('---').length);
		expect(result.afterYaml.length).toBeGreaterThanOrEqual(yaml.length);
	});

	it('uses AI for errors without suggestedFix after deterministic fixes', async () => {
		const issues: BundleIssue[] = [
			{
				id: '1',
				severity: 'error',
				category: 'schema',
				message: "spec.os: value 'ios' is invalid; must be one of: srl, sros (exact case)",
				docIndex: 1,
				fieldPath: 'spec.os'
			},
			{
				id: '2',
				severity: 'warning',
				category: 'schema',
				message: 'Kind casing',
				docIndex: 1,
				line: 2,
				suggestedFix: { field: 'kind', value: 'Topology', line: 2 }
			}
		];

		const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: topology
metadata:
  name: lab
  namespace: eda
spec:
  os: invalid`;

		const aiFix = vi.fn(async () => ({
			fixable: true,
			fixedYaml: `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: lab
  namespace: eda
spec:
  os: srl`
		}));

		const result = await fixAllBundle(yaml, issues, {
			releaseFolder: 'eda-25-4-1',
			manifest: [],
			includeAi: true,
			aiFix
		});
		expect(result.ok).toBe(true);
		expect(result.suggestedFixCount).toBe(1);
		expect(result.aiFixCount).toBe(1);
		expect(result.yaml).toContain('os: srl');
		expect(result.yaml).toContain('kind: Topology');
		expect(result.beforeYaml).toBe(yaml);
		expect(result.afterYaml).toBe(result.yaml);
		expect(result.changes.some((c) => c.source === 'suggested')).toBe(true);
		expect(result.changes.some((c) => c.source === 'ai')).toBe(true);
		expect(aiFix).toHaveBeenCalledTimes(1);
	});

	it('fixes multiple renameKey issues in one pass without layout format', async () => {
		const issues: BundleIssue[] = [
			{
				id: 'v4',
				severity: 'warning',
				category: 'schema',
				message: 'Misspelled field',
				docIndex: 1,
				fieldPath: 'spec.spines.systemPoolIPV4',
				suggestedFix: {
					action: 'renameKey',
					field: 'systemPoolIPV4',
					value: 'systemPoolIPv4'
				}
			},
			{
				id: 'v6',
				severity: 'warning',
				category: 'schema',
				message: 'Misspelled field',
				docIndex: 1,
				fieldPath: 'spec.spines.systemPoolIPV6',
				suggestedFix: {
					action: 'renameKey',
					field: 'systemPoolIPV6',
					value: 'systemPoolIPv6'
				}
			}
		];

		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  spines:
    asnPool:  asn-pool
    systemPoolIPV4:  systemipv4-pool
    systemPoolIPV6:  systemipv6-pool
`;

		const result = await fixAllBundle(yaml, issues, {
			releaseFolder: 'eda-25-4-1',
			manifest: []
		});

		expect(result.ok).toBe(true);
		expect(result.suggestedFixCount).toBe(2);
		expect(result.yaml).toContain('systemPoolIPv4:  systemipv4-pool');
		expect(result.yaml).toContain('systemPoolIPv6:  systemipv6-pool');
		expect(result.yaml).not.toContain('systemPoolIPV4:');
		expect(result.yaml).not.toContain('systemPoolIPV6:');
		expect(result.beforeYaml).toBe(yaml);
	});

	it('applies multiple Fabric protocol renameKey fixes in one doc', async () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  overlayProtocol:
    protocols: IBGP
  underlayProtocol:
    protocol:
    - EBGP
`;

		const issues: BundleIssue[] = [
			{
				id: 'overlay-protocols',
				severity: 'warning',
				category: 'schema',
				message: 'Misspelled field',
				docIndex: 1,
				fieldPath: 'spec.overlayProtocol.protocols',
				suggestedFix: {
					action: 'renameKey',
					field: 'protocols',
					value: 'protocol'
				}
			},
			{
				id: 'underlay-protocol',
				severity: 'warning',
				category: 'schema',
				message: 'Misspelled field',
				docIndex: 1,
				fieldPath: 'spec.underlayProtocol.protocol',
				suggestedFix: {
					action: 'renameKey',
					field: 'protocol',
					value: 'protocols'
				}
			}
		];

		const aiFix = vi.fn(async () => ({ fixable: true, fixedYaml: yaml }));
		const result = await fixAllBundle(yaml, issues, {
			releaseFolder: '26.4.2',
			manifest: [],
			includeAi: true,
			aiFix
		});

		expect(result.ok).toBe(true);
		expect(result.suggestedFixCount).toBe(2);
		expect(result.aiFixCount).toBe(0);
		expect(aiFix).not.toHaveBeenCalled();

		expect(result.yaml).toContain('protocol: IBGP');
		expect(result.yaml).toMatch(/underlayProtocol:[\s\S]*?protocols:/);
		expect(result.yaml).toMatch(/underlayProtocol:[\s\S]*?protocols:\s*\n\s*-\s*EBGP/);
		expect(result.yaml).not.toContain('protocols: IBGP');
		expect(result.yaml).not.toMatch(/underlayProtocol:[\s\S]*?\n\s*protocol:/);
	});

	it('skips AI when renameKey suggestedFix succeeds', async () => {
		const issues: BundleIssue[] = [
			{
				id: '1',
				severity: 'warning',
				category: 'schema',
				message: 'Misspelled field',
				docIndex: 1,
				line: 7,
				suggestedFix: {
					action: 'renameKey',
					field: 'systemPoolIPV6',
					value: 'systemPoolIPv6',
					line: 7
				}
			}
		];

		const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: lab
  namespace: eda
spec:
  systemPoolIPV6: true`;

		const aiFix = vi.fn(async () => ({ fixable: true, fixedYaml: yaml }));

		const result = await fixAllBundle(yaml, issues, {
			releaseFolder: 'eda-25-4-1',
			manifest: [],
			includeAi: true,
			aiFix
		});

		expect(result.ok).toBe(true);
		expect(result.suggestedFixCount).toBe(1);
		expect(result.aiFixCount).toBe(0);
		expect(result.yaml).toContain('systemPoolIPv6: true');
		expect(aiFix).not.toHaveBeenCalled();
	});

	it('does not call AI when a suggestedFix exists (use deterministic path instead)', async () => {
		const issues: BundleIssue[] = [
			{
				id: '1',
				severity: 'warning',
				category: 'schema',
				message: 'Misspelled field',
				docIndex: 1,
				line: 99,
				fieldPath: 'spec.missingKey',
				suggestedFix: {
					action: 'renameKey',
					field: 'missingKey',
					value: 'knownKey',
					line: 99
				}
			}
		];

		const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: lab
spec:
  otherField: true`;

		const aiFix = vi.fn(async () => ({ fixable: true, fixedYaml: yaml }));

		const result = await fixAllBundle(yaml, issues, {
			releaseFolder: 'eda-25-4-1',
			manifest: [],
			includeAi: true,
			aiFix
		});

		expect(result.ok).toBe(true);
		expect(result.suggestedFixCount).toBe(0);
		expect(result.aiFixCount).toBe(0);
		expect(aiFix).not.toHaveBeenCalled();
	});

	it('does not call AI by default when includeAi is false', async () => {
		const issues: BundleIssue[] = [
			{
				id: '1',
				severity: 'warning',
				category: 'schema',
				message: 'Unknown field "spec.unknownFlag"',
				docIndex: 1,
				fieldPath: 'spec.unknownFlag'
			}
		];

		const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: lab
spec:
  unknownFlag: true`;

		const aiFix = vi.fn(async () => ({
			fixable: true,
			fixedYaml: `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: lab
spec: {}`
		}));

		const result = await fixAllBundle(yaml, issues, {
			releaseFolder: 'eda-25-4-1',
			manifest: [],
			aiFix
		});

		expect(result.ok).toBe(true);
		expect(result.aiFixCount).toBe(0);
		expect(aiFix).not.toHaveBeenCalled();
	});

	it('does not call AI for parse errors when includeAi is false', async () => {
		const aiFix = vi.fn(async () => ({ fixable: true, fixedYaml: 'kind: Topology\n' }));
		const result = await fixAllBundle('kind: [broken', [], {
			aiFix,
			includeAi: false
		});
		expect(result.ok).toBe(false);
		expect(aiFix).not.toHaveBeenCalled();
	});

	it('uses AI when includeAi is true', async () => {
		const issues: BundleIssue[] = [
			{
				id: '1',
				severity: 'warning',
				category: 'schema',
				message: 'Unknown field "spec.unknownFlag"',
				docIndex: 1,
				fieldPath: 'spec.unknownFlag'
			}
		];

		const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: lab
  namespace: eda
spec:
  unknownFlag: true`;

		const aiFix = vi.fn(async () => ({
			fixable: true,
			fixedYaml: `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: lab
  namespace: eda
spec: {}`
		}));

		const result = await fixAllBundle(yaml, issues, {
			releaseFolder: 'eda-25-4-1',
			manifest: [],
			includeAi: true,
			aiFix
		});

		expect(result.ok).toBe(true);
		expect(result.aiFixCount).toBe(1);
		expect(aiFix).toHaveBeenCalledTimes(1);
	});

	it('revalidate skips AI for issues cleared by deterministic fixes when includeAi is true', async () => {
		const issues: BundleIssue[] = [
			{
				id: '1',
				severity: 'warning',
				category: 'schema',
				message: 'Misspelled field',
				docIndex: 1,
				line: 6,
				fieldPath: 'spec.systemPoolIPV6',
				suggestedFix: {
					action: 'renameKey',
					field: 'systemPoolIPV6',
					value: 'systemPoolIPv6',
					line: 6
				}
			},
			{
				id: '2',
				severity: 'error',
				category: 'schema',
				message: 'Unknown field',
				docIndex: 1,
				fieldPath: 'spec.unknownFlag'
			}
		];

		const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: lab
spec:
  systemPoolIPV6: true
  unknownFlag: true`;

		const aiFix = vi.fn(async () => ({
			fixable: true,
			fixedYaml: `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: lab
spec:
  systemPoolIPv6: true`
		}));

		let revalidatePass = 0;
		const revalidateIssues = vi.fn(async (currentYaml: string) => {
			revalidatePass += 1;
			const remaining: BundleIssue[] = [];
			if (currentYaml.includes('unknownFlag')) {
				remaining.push({
					id: `remaining-${revalidatePass}`,
					severity: 'error' as const,
					category: 'schema' as const,
					message: 'Unknown field',
					docIndex: 1,
					fieldPath: 'spec.unknownFlag'
				});
			}
			return remaining;
		});

		const result = await fixAllBundle(yaml, issues, {
			releaseFolder: 'eda-25-4-1',
			manifest: [],
			includeAi: true,
			aiFix,
			revalidateIssues
		});

		expect(result.ok).toBe(true);
		expect(result.suggestedFixCount).toBe(1);
		expect(result.yaml).toContain('systemPoolIPv6: true');
		expect(aiFix).toHaveBeenCalledTimes(1);
		expect(revalidateIssues).toHaveBeenCalled();
	});

	it('falls back to standard fixes when AI hits quota', async () => {
		const issues: BundleIssue[] = [
			{
				id: '1',
				severity: 'error',
				category: 'schema',
				message: 'Invalid enum',
				docIndex: 1
			},
			{
				id: '2',
				severity: 'warning',
				category: 'schema',
				message: 'Kind casing',
				docIndex: 1,
				line: 2,
				suggestedFix: { field: 'kind', value: 'Topology', line: 2 }
			}
		];

		const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: topology
metadata:
  name: lab
  namespace: eda`;

		const aiFix = vi.fn(async () => ({
			error: 'Workers AI daily limit reached',
			fallbackReason: 'quota' as const
		}));

		const result = await fixAllBundle(yaml, issues, {
			releaseFolder: 'eda-25-4-1',
			manifest: [],
			includeAi: true,
			aiFix
		});
		expect(result.ok).toBe(true);
		expect(result.aiUnavailable).toBe(true);
		expect(result.aiFixCount).toBe(0);
		expect(result.suggestedFixCount).toBe(1);
		expect(result.yaml).toContain('kind: Topology');
	});

	it('fixes Fabric underlay and overlay protocol keys in one pass', async () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
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
		const issues: BundleIssue[] = [
			{
				id: 'overlay-protocols',
				severity: 'warning',
				category: 'schema',
				message: 'Misspelled field',
				docIndex: 1,
				fieldPath: 'spec.overlayProtocol.protocols',
				suggestedFix: {
					action: 'renameKey',
					field: 'protocols',
					value: 'protocol'
				}
			},
			{
				id: 'underlay-protocol',
				severity: 'warning',
				category: 'schema',
				message: 'Misspelled field',
				docIndex: 1,
				fieldPath: 'spec.underlayProtocol.protocol',
				suggestedFix: {
					action: 'renameKey',
					field: 'protocol',
					value: 'protocols'
				}
			}
		];

		const result = await fixAllBundle(yaml, issues);
		expect(result.ok).toBe(true);
		expect(result.suggestedFixCount).toBe(2);
		expect(result.yaml).toMatch(/overlayProtocol:[\s\S]*?protocol: IBGP/);
		expect(result.yaml).toMatch(/underlayProtocol:[\s\S]*?protocols:\s*\n\s*- EBGP/);
		expect(result.yaml).not.toContain('protocols: IBGP');
	});

	it('dedupes duplicate addField suggestions for the same parent field', async () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  underlayProtocol:
    bgp: {}
`;
		const makeIssue = (id: string): BundleIssue => ({
			id,
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
		});

		const result = await fixAllBundle(yaml, [makeIssue('dup-1'), makeIssue('dup-2')]);
		expect(result.ok).toBe(true);
		expect(result.suggestedFixCount).toBe(1);
		expect((result.yaml.match(/protocols:/g) ?? []).length).toBe(1);
		expect(result.yaml).toContain('protocols: []');
	});

	it('applies deterministic enum fix for Interface_ai without calling AI', async () => {
		const yaml = `apiVersion: interfaces.eda.nokia.com/v1
kind: Interface
metadata:
  name: eth-1
  namespace: eda
spec:
  enabled: true
  type: Interface_ai
  members:
    - interface: ethernet-1-1
      node: leaf-01`;

		const issues: BundleIssue[] = [
			{
				id: 'enum-interface-ai',
				severity: 'error',
				category: 'schema',
				message:
					"spec.type: value 'Interface_ai' is invalid; must be one of: LAG, Interface, Loopback (exact case)",
				docIndex: 1,
				fieldPath: 'spec.type',
				suggestedFix: { action: 'setValue', field: 'type', value: 'Interface' }
			}
		];

		const aiFix = vi.fn();
		const result = await fixAllBundle(yaml, issues, {
			releaseFolder: 'eda-25-4-1',
			manifest: [],
			includeAi: true,
			aiFix
		});

		expect(result.ok).toBe(true);
		expect(result.suggestedFixCount).toBe(1);
		expect(result.aiFixCount).toBe(0);
		expect(result.yaml).toContain('type: Interface');
		expect(result.yaml).not.toContain('Interface_ai');
		expect(aiFix).not.toHaveBeenCalled();
	});

	it('batches structural AI fixes into one migration call per document', async () => {
		const yaml = `apiVersion: services.eda.nokia.com/v1
kind: BridgeDomain
metadata:
  name: bd
spec:
  macLearning: true
  tunnelIndexPool: pool
  vni: 10`;

		const issues: BundleIssue[] = [
			{
				id: 'type-mac',
				severity: 'error',
				category: 'schema',
				message: 'must be object',
				docIndex: 1,
				fieldPath: 'spec.macLearning'
			},
			{
				id: 'unknown-tunnel',
				severity: 'warning',
				category: 'schema',
				message: 'Unknown field',
				docIndex: 1,
				fieldPath: 'spec.tunnelIndexPool'
			},
			{
				id: 'unknown-vni',
				severity: 'warning',
				category: 'schema',
				message: 'Unknown field',
				docIndex: 1,
				fieldPath: 'spec.vni'
			}
		];

		const aiFix = vi.fn(async ({ issues: batch }) => ({
			fixable: true,
			fixedYaml: `apiVersion: services.eda.nokia.com/v1
kind: BridgeDomain
metadata:
  name: bd
spec:
  encapOptions:
    vxlan:
      tunnelIndexPool: pool
      vni: 10
  macLearning:
    enabled: true`
		}));

		const result = await fixAllBundle(yaml, issues, {
			releaseFolder: '26.4.2',
			manifest: [],
			includeAi: true,
			aiFix
		});

		expect(result.ok).toBe(true);
		expect(result.aiFixCount).toBe(1);
		expect(aiFix).toHaveBeenCalledTimes(1);
		expect(aiFix.mock.calls[0]?.[0]?.issues?.length).toBe(3);
	});

	it('applies BridgeDomain relocateField fixes without AI', async () => {
		const yaml = `apiVersion: services.eda.nokia.com/v1
kind: BridgeDomain
metadata:
  name: bd
spec:
  evi: 102
  tunnelIndexPool: tunnel-index-pool
  vni: 102
  vniPool: vni-pool`;

		const issues: BundleIssue[] = [
			{
				id: 'rel-tunnel',
				severity: 'warning',
				category: 'schema',
				message: 'relocate tunnelIndexPool',
				docIndex: 1,
				fieldPath: 'spec.tunnelIndexPool',
				suggestedFix: {
					action: 'relocateField',
					field: 'spec.tunnelIndexPool',
					value: 'spec.encapOptions.vxlan.tunnelIndexPool'
				}
			},
			{
				id: 'rel-vni',
				severity: 'warning',
				category: 'schema',
				message: 'relocate vni',
				docIndex: 1,
				fieldPath: 'spec.vni',
				suggestedFix: {
					action: 'relocateField',
					field: 'spec.vni',
					value: 'spec.encapOptions.vxlan.vni'
				}
			},
			{
				id: 'rel-vni-pool',
				severity: 'warning',
				category: 'schema',
				message: 'relocate vniPool',
				docIndex: 1,
				fieldPath: 'spec.vniPool',
				suggestedFix: {
					action: 'relocateField',
					field: 'spec.vniPool',
					value: 'spec.encapOptions.vxlan.vniPool'
				}
			}
		];

		const aiFix = vi.fn();
		const result = await fixAllBundle(yaml, issues, {
			releaseFolder: '26.4.2',
			manifest: [],
			includeAi: true,
			aiFix
		});

		expect(result.ok).toBe(true);
		expect(result.suggestedFixCount).toBe(3);
		expect(result.aiFixCount).toBe(0);
		expect(aiFix).not.toHaveBeenCalled();
		expect(result.yaml).toContain('encapOptions:');
		expect(result.yaml).toContain('tunnelIndexPool: tunnel-index-pool');
		expect(result.yaml).not.toMatch(/^  tunnelIndexPool:/m);
	});
});

describe('isAiUnavailableResult', () => {
	it('detects token limit messages', () => {
		expect(isAiUnavailableResult({ error: 'prompt is too long' })).toBe(true);
		expect(isAiUnavailableResult({ fallbackReason: 'quota' })).toBe(true);
		expect(isAiUnavailableResult({ error: 'some other error' })).toBe(false);
	});
});
