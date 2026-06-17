import { describe, expect, it } from 'vitest';
import {
	extractDocumentYaml,
	inferManifestIdentity,
	replaceDocumentInBundle,
	validateAiFixApply,
	validateAiMigrationApply,
	isParseIssue
} from './replaceDocument';

const doc1 = `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: topo-a
spec:
  type: evpn`;

const doc2 = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: fabric-b
spec:
  os: SRL`;

const bundle = `${doc1}\n---\n${doc2}`;

describe('replaceDocumentInBundle', () => {
	it('replaces document 2 in a multi-doc bundle', () => {
		const fixed = doc2.replace('os: SRL', 'os: srl');
		const updated = replaceDocumentInBundle(bundle, 2, fixed);
		expect(updated).toContain('name: topo-a');
		expect(updated).toContain('os: srl');
		expect(updated).not.toContain('os: SRL');
	});

	it('replaces the only document in a single-doc bundle', () => {
		const fixed = doc1.replace('type: evpn', 'type: EVPN');
		const updated = replaceDocumentInBundle(doc1, 1, fixed);
		expect(updated).toBe(fixed);
	});

	it('returns null for out-of-range docIndex', () => {
		expect(replaceDocumentInBundle(bundle, 3, doc1)).toBeNull();
	});
});

describe('extractDocumentYaml with broken YAML', () => {
	it('returns raw section when document does not parse', () => {
		const broken = `apiVersion: x
kind Fabric
---
apiVersion: y
kind: Topology`;
		expect(extractDocumentYaml(broken, 1)).toContain('kind Fabric');
		expect(extractDocumentYaml(broken, 2)).toContain('kind: Topology');
	});

	it('replaces broken document in bundle', () => {
		const broken = `apiVersion: x
kind Fabric
---
${doc2}`;
		const fixedDoc1 = `apiVersion: x
kind: Fabric`;
		const updated = replaceDocumentInBundle(broken, 1, fixedDoc1);
		expect(updated).toContain('kind: Fabric');
		expect(updated).toContain('fabric-b');
	});
});

describe('inferManifestIdentity', () => {
	it('reads kind and group from partial yaml', () => {
		const id = inferManifestIdentity(`apiVersion: fabrics.eda.nokia.com/v1\nkind: Fabric\n`);
		expect(id.kind).toBe('Fabric');
		expect(id.group).toBe('fabrics.eda.nokia.com');
	});
});

describe('isParseIssue', () => {
	it('detects parse issue ids', () => {
		expect(isParseIssue({ id: 'parse-1', message: 'x' })).toBe(true);
	});
});

describe('validateAiFixApply', () => {
	it('allows spec-only changes', () => {
		const fixed = doc2.replace('os: SRL', 'os: srl');
		expect(validateAiFixApply(doc2, fixed, { id: 'schema-1', message: 'enum value', fieldPath: 'spec.os' }).ok).toBe(
			true
		);
	});

	it('allows parse fixes when original YAML is invalid', () => {
		const broken = `apiVersion: fabrics.eda.nokia.com/v1
kind Fabric
metadata:
  name: demo`;
		const fixed = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: demo`;
		expect(
			validateAiFixApply(broken, fixed, {
				id: 'parse-1',
				message: 'YAML parsing error: bad indentation'
			}).ok
		).toBe(true);
	});

	it('rejects kind change when issue is not about kind', () => {
		const fixed = doc2.replace('kind: Fabric', 'kind: Topology');
		const result = validateAiFixApply(doc2, fixed, {
			id: 'schema-1',
			message: 'invalid enum',
			fieldPath: 'spec.os'
		});
		expect(result.ok).toBe(false);
	});

	it('rejects rename AI output that adds extra list items', () => {
		const original = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  bgp:
    protocol:
    - EBGP`;
		const overCorrected = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  bgp:
    protocols:
      - EBGP
      - OSPF
      - ISIS`;
		const result = validateAiFixApply(original, overCorrected, {
			id: 'schema-1',
			message: 'Misspelled field "spec.bgp.protocol"',
			fieldPath: 'spec.bgp.protocol',
			suggestedFix: {
				action: 'renameKey',
				field: 'protocol',
				value: 'protocols'
			}
		});
		expect(result.ok).toBe(false);
		expect(result.reason).toContain('preserve the exact value');
	});

	it('allows rename AI output that only renames the key', () => {
		const original = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  bgp:
    protocol:
    - EBGP`;
		const fixed = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  bgp:
    protocols:
    - EBGP`;
		const result = validateAiFixApply(original, fixed, {
			id: 'schema-1',
			message: 'Misspelled field "spec.bgp.protocol"',
			fieldPath: 'spec.bgp.protocol',
			suggestedFix: {
				action: 'renameKey',
				field: 'protocol',
				value: 'protocols'
			}
		});
		expect(result.ok).toBe(true);
	});
});

describe('validateAiFixApply — Fabric protocol parent context', () => {
	const underlayRenameIssue = {
		id: 'schema-underlay',
		message: 'Misspelled field "spec.underlayProtocol.protocol"',
		fieldPath: 'spec.underlayProtocol.protocol',
		suggestedFix: {
			action: 'renameKey' as const,
			field: 'protocol',
			value: 'protocols'
		}
	};

	const userFabricYaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  overlayProtocol:
    protocols: BGP
  underlayProtocol:
    protocol:
    - EBGP`;

	it('rejects AI output that leaves protocol under underlayProtocol', () => {
		const unchanged = userFabricYaml;
		const result = validateAiFixApply(userFabricYaml, unchanged, underlayRenameIssue);
		expect(result.ok).toBe(false);
	});

	it('rejects AI output that fixes overlay but leaves protocol under underlay', () => {
		const wrong = userFabricYaml.replace('protocols: BGP', 'protocol: BGP');
		const result = validateAiFixApply(userFabricYaml, wrong, underlayRenameIssue);
		expect(result.ok).toBe(false);
	});

	it('allows correct underlay protocol rename preserving list value', () => {
		const fixed = userFabricYaml.replace('protocol:\n    - EBGP', 'protocols:\n    - EBGP');
		const result = validateAiFixApply(userFabricYaml, fixed, underlayRenameIssue);
		expect(result.ok).toBe(true);
	});
});

const bgpRenameIssue = {
	id: 'schema-1',
	message: 'Misspelled field "spec.bgp.protocol"',
	fieldPath: 'spec.bgp.protocol',
	suggestedFix: {
		action: 'renameKey' as const,
		field: 'protocol',
		value: 'protocols'
	}
};

const bgpRenameOriginal = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  bgp:
    protocol:
    - EBGP
    timers: {}`;

describe('validateAiFixApply — minimal fix guard', () => {
	it('rejects AI output that adds OSPFv2/OSPFv3 to protocol list on rename', () => {
		const overCorrected = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  bgp:
    protocols:
    - EBGP
    - OSPFv2
    - OSPFv3
    timers: {}`;
		const result = validateAiFixApply(bgpRenameOriginal, overCorrected, bgpRenameIssue);
		expect(result.ok).toBe(false);
	});

	it('rejects expanding timers: {} into a full object', () => {
		const overCorrected = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  bgp:
    protocols:
    - EBGP
    timers:
      connectRetry: 120
      holdTime: 90
      keepaliveInterval: 30
      minimumAdvertisementInterval: 30`;
		const result = validateAiFixApply(bgpRenameOriginal, overCorrected, bgpRenameIssue);
		expect(result.ok).toBe(false);
	});

	it('rejects adding a new ospf block not in the original', () => {
		const overCorrected = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  bgp:
    protocols:
    - EBGP
    timers: {}
  ospf:
    addressFamilies:
    - ipv4-unicast`;
		const result = validateAiFixApply(bgpRenameOriginal, overCorrected, bgpRenameIssue);
		expect(result.ok).toBe(false);
		expect(result.reason).toMatch(/ospf|unrelated|Rename/i);
	});
});

const bridgeDomainTypeIssue = {
	id: 'schema-mac-learning',
	message: 'must be object (Line 11, column 1)',
	fieldPath: 'spec.macLearning'
};

const bridgeDomainUnknownFieldIssue = {
	id: 'schema-tunnel-index',
	message: 'Unknown field "spec.tunnelIndexPool" — not defined in the CRD schema for BridgeDomain',
	fieldPath: 'spec.tunnelIndexPool'
};

const bridgeDomainOriginal = `apiVersion: services.eda.nokia.com/v1
kind: BridgeDomain
metadata:
  name: l2-bridge-domain-102
  namespace: clab-orange-tsc
spec:
  description: l2-bridge-domain-102
  evi: 102
  eviPool: evi-pool
  macAging: 300
  macLearning: true
  tunnelIndexPool: tunnel-index-pool
  type: EVPNVXLAN
  vni: 102
  vniPool: vni-pool`;

describe('validateAiFixApply — structural type and unknown-field fixes', () => {
	it('allows wrapping a boolean scalar into an object at the reported field path', () => {
		const fixed = bridgeDomainOriginal.replace(
			'  macLearning: true',
			`  macLearning:
    enabled: true
    agingTimeSeconds: 300`
		);
		const result = validateAiFixApply(bridgeDomainOriginal, fixed, bridgeDomainTypeIssue);
		expect(result.ok).toBe(true);
	});

	it('allows relocating an unknown spec field into a nested schema path', () => {
		const fixed = bridgeDomainOriginal
			.replace('  tunnelIndexPool: tunnel-index-pool\n', '')
			.replace(
				'  type: EVPNVXLAN',
				`  encapOptions:
    vxlan:
      tunnelIndexPool: tunnel-index-pool
  type: EVPNVXLAN`
			);
		const result = validateAiFixApply(
			bridgeDomainOriginal,
			fixed,
			bridgeDomainUnknownFieldIssue
		);
		expect(result.ok).toBe(true);
	});

	it('allows multi-field structural migration within spec scope', () => {
		const fixed = `apiVersion: services.eda.nokia.com/v1
kind: BridgeDomain
metadata:
  name: l2-bridge-domain-102
  namespace: clab-orange-tsc
spec:
  description: l2-bridge-domain-102
  encapOptions:
    vxlan:
      tunnelIndexPool: tunnel-index-pool
      vni: 102
      vniPool: vni-pool
  evi: 102
  eviPool: evi-pool
  macLearning:
    enabled: true
    agingTimeSeconds: 300
  type: EVPNVXLAN`;
		const result = validateAiFixApply(
			bridgeDomainOriginal,
			fixed,
			bridgeDomainUnknownFieldIssue
		);
		expect(result.ok, result.reason).toBe(true);
	});
});

describe('validateAiMigrationApply', () => {
	it('allows multi-field spec migration when batch issues are provided', () => {
		const fixed = `apiVersion: services.eda.nokia.com/v1
kind: BridgeDomain
metadata:
  name: l2-bridge-domain-102
  namespace: clab-orange-tsc
spec:
  description: l2-bridge-domain-102
  encapOptions:
    vxlan:
      tunnelIndexPool: tunnel-index-pool
      vni: 102
      vniPool: vni-pool
  evi: 102
  eviPool: evi-pool
  macLearning:
    enabled: true
    agingTimeSeconds: 300
  type: EVPNVXLAN`;

		const result = validateAiMigrationApply(bridgeDomainOriginal, fixed, [
			bridgeDomainTypeIssue,
			bridgeDomainUnknownFieldIssue,
			{
				id: 'api-version',
				message: 'apiVersion services.eda.nokia.com/v1 is deprecated for kind BridgeDomain',
				fieldPath: 'apiVersion'
			}
		]);
		expect(result.ok, result.reason).toBe(true);
	});
});
