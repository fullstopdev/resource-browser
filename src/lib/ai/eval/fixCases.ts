/**
 * AI Fix evaluation cases (EDA 26.8.2). Each case is a known-good manifest broken in one place,
 * the issue the validator reports for it, and an independent check on the returned document.
 * Run with `npm run eval:fix` (scripts/eval-fix.ts) against a deployment with Workers AI.
 */

import { CURATED_FIX_EVAL_CASES } from './fixCasesCurated';

export type FixEvalCase = {
	id: string;
	kind: string;
	group: string;
	issueKind: 'enum' | 'type' | 'required' | 'unknownField' | 'syntax';
	yaml: string;
	message: string;
	fieldPath?: string;
	/** Returns null when the fixed document is acceptable, else what is wrong with it. */
	check: (fixed: Record<string, unknown>) => string | null;
};

export const FIX_EVAL_RELEASE = '26.8.2';

const spec = (doc: Record<string, unknown>) => (doc.spec ?? {}) as Record<string, unknown>;

const oneOf =
	(field: string, allowed: unknown[]) =>
	(doc: Record<string, unknown>): string | null =>
		allowed.includes(spec(doc)[field])
			? null
			: `spec.${field} = ${JSON.stringify(spec(doc)[field])}, expected one of ${allowed.join(', ')}`;

const isType =
	(field: string, type: 'integer' | 'boolean') =>
	(doc: Record<string, unknown>): string | null => {
		const value = spec(doc)[field];
		const ok = type === 'integer' ? Number.isInteger(value) : typeof value === 'boolean';
		return ok ? null : `spec.${field} = ${JSON.stringify(value)}, expected ${type}`;
	};

const present = (field: string) => (doc: Record<string, unknown>) =>
	spec(doc)[field] !== undefined ? null : `spec.${field} is still missing`;

const absent = (field: string) => (doc: Record<string, unknown>) =>
	spec(doc)[field] === undefined ? null : `spec.${field} is still present`;

const parses = () => null;

const toponode = (specLines: string) => `apiVersion: core.eda.nokia.com/v1
kind: TopoNode
metadata:
  name: leaf-01
  namespace: eda
spec:
${specLines}`;

const iface = (specLines: string) => `apiVersion: interfaces.eda.nokia.com/v1
kind: Interface
metadata:
  name: ethernet-1-1
  namespace: eda
spec:
${specLines}`;

const bridgeDomain = (specLines: string) => `apiVersion: services.eda.nokia.com/v1
kind: BridgeDomain
metadata:
  name: bd-blue
  namespace: eda
spec:
${specLines}`;

const topology = (specLines: string) => `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: lab-topology
  namespace: eda
spec:
${specLines}`;

const TOPONODE_OK = `  platform: 7220 IXR-D3L
  version: "24.10.1"
  nodeProfile: default-node-profile`;
const IFACE_MEMBERS = `  members:
    - interface: ethernet-1-1
      node: leaf-01`;

const OS_VALUES = ['srl', 'sros', 'eos', 'sonic', 'ios-xr', 'nxos', 'junos', 'cumulus'];

/** An Interface with enough members to exceed the full-document limit (excerpt mode). */
const longInterface = iface(
	`  enabled: true
  members:
${Array.from({ length: 110 }, (_, i) => `    - interface: ethernet-1-${i + 1}\n      node: leaf-01`).join('\n')}
  type: Ethernet`
);

const BASE_FIX_EVAL_CASES: FixEvalCase[] = [
	// enum
	{
		id: 'enum-toponode-os-name',
		kind: 'TopoNode',
		group: 'core.eda.nokia.com',
		issueKind: 'enum',
		yaml: toponode(`${TOPONODE_OK}\n  operatingSystem: SR Linux`),
		message:
			'spec.operatingSystem must be one of: srl, sros, eos, sonic, ios-xr, nxos, junos, cumulus',
		fieldPath: 'spec.operatingSystem',
		check: oneOf('operatingSystem', OS_VALUES)
	},
	{
		id: 'enum-toponode-os-case',
		kind: 'TopoNode',
		group: 'core.eda.nokia.com',
		issueKind: 'enum',
		yaml: toponode(`${TOPONODE_OK}\n  operatingSystem: SRL`),
		message:
			'spec.operatingSystem must be one of: srl, sros, eos, sonic, ios-xr, nxos, junos, cumulus',
		fieldPath: 'spec.operatingSystem',
		check: oneOf('operatingSystem', ['srl'])
	},
	{
		id: 'enum-interface-type',
		kind: 'Interface',
		group: 'interfaces.eda.nokia.com',
		issueKind: 'enum',
		yaml: iface(`  type: Ethernet\n${IFACE_MEMBERS}`),
		message: 'spec.type must be one of: LAG, Interface, Loopback',
		fieldPath: 'spec.type',
		check: oneOf('type', ['LAG', 'Interface', 'Loopback'])
	},
	{
		id: 'enum-interface-encap-case',
		kind: 'Interface',
		group: 'interfaces.eda.nokia.com',
		issueKind: 'enum',
		yaml: iface(`  encapType: dot1q\n${IFACE_MEMBERS}`),
		message: 'spec.encapType must be one of: Null, Dot1q',
		fieldPath: 'spec.encapType',
		check: oneOf('encapType', ['Dot1q'])
	},
	{
		id: 'enum-interface-mode-case',
		kind: 'Interface',
		group: 'interfaces.eda.nokia.com',
		issueKind: 'enum',
		yaml: iface(`  mode: access\n${IFACE_MEMBERS}`),
		message: 'spec.mode must be one of: Access, Network, Hybrid',
		fieldPath: 'spec.mode',
		check: oneOf('mode', ['Access'])
	},
	{
		id: 'enum-bridgedomain-type',
		kind: 'BridgeDomain',
		group: 'services.eda.nokia.com',
		issueKind: 'enum',
		yaml: bridgeDomain('  type: VXLAN\n  evi: 100'),
		message: 'spec.type must be one of: SIMPLE, EVPNVXLAN',
		fieldPath: 'spec.type',
		check: oneOf('type', ['EVPNVXLAN'])
	},
	// type
	{
		id: 'type-interface-mtu-string',
		kind: 'Interface',
		group: 'interfaces.eda.nokia.com',
		issueKind: 'type',
		yaml: iface(`  mtu: "9000"\n${IFACE_MEMBERS}`),
		message: 'spec.mtu must be integer',
		fieldPath: 'spec.mtu',
		check: isType('mtu', 'integer')
	},
	{
		id: 'type-bridgedomain-evi-string',
		kind: 'BridgeDomain',
		group: 'services.eda.nokia.com',
		issueKind: 'type',
		yaml: bridgeDomain('  type: EVPNVXLAN\n  evi: "100"'),
		message: 'spec.evi must be integer',
		fieldPath: 'spec.evi',
		check: isType('evi', 'integer')
	},
	{
		id: 'type-interface-enabled-word',
		kind: 'Interface',
		group: 'interfaces.eda.nokia.com',
		issueKind: 'type',
		yaml: iface(`  enabled: "yes"\n${IFACE_MEMBERS}`),
		message: 'spec.enabled must be boolean',
		fieldPath: 'spec.enabled',
		check: isType('enabled', 'boolean')
	},
	{
		id: 'type-topology-enabled-string',
		kind: 'Topology',
		group: 'topologies.eda.nokia.com',
		issueKind: 'type',
		yaml: topology('  enabled: "true"\n  overlays:\n    - enabled: true\n      key: default'),
		message: 'spec.enabled must be boolean',
		fieldPath: 'spec.enabled',
		check: isType('enabled', 'boolean')
	},
	{
		id: 'type-bridgedomain-maclearning-string',
		kind: 'BridgeDomain',
		group: 'services.eda.nokia.com',
		issueKind: 'type',
		yaml: bridgeDomain('  type: EVPNVXLAN\n  macLearning: "true"'),
		message: 'spec.macLearning must be boolean',
		fieldPath: 'spec.macLearning',
		check: isType('macLearning', 'boolean')
	},
	// required
	{
		id: 'required-toponode-version',
		kind: 'TopoNode',
		group: 'core.eda.nokia.com',
		issueKind: 'required',
		yaml: toponode(
			'  platform: 7220 IXR-D3L\n  nodeProfile: default-node-profile\n  operatingSystem: srl'
		),
		message: 'spec.version is required',
		fieldPath: 'spec.version',
		check: present('version')
	},
	{
		id: 'required-topology-overlays',
		kind: 'Topology',
		group: 'topologies.eda.nokia.com',
		issueKind: 'required',
		yaml: topology('  enabled: true\n  uiName: Lab'),
		message: 'spec.overlays is required',
		fieldPath: 'spec.overlays',
		check: present('overlays')
	},
	{
		id: 'required-interface-members',
		kind: 'Interface',
		group: 'interfaces.eda.nokia.com',
		issueKind: 'required',
		yaml: iface('  enabled: true\n  type: Interface'),
		message: 'spec.members is required',
		fieldPath: 'spec.members',
		check: present('members')
	},
	// unknown field
	{
		id: 'unknown-toponode-hostname',
		kind: 'TopoNode',
		group: 'core.eda.nokia.com',
		issueKind: 'unknownField',
		yaml: toponode(`${TOPONODE_OK}\n  operatingSystem: srl\n  hostname: leaf-01`),
		message: 'Unknown field "spec.hostname" — not defined in the CRD schema for TopoNode',
		fieldPath: 'spec.hostname',
		check: absent('hostname')
	},
	{
		id: 'unknown-interface-speed',
		kind: 'Interface',
		group: 'interfaces.eda.nokia.com',
		issueKind: 'unknownField',
		yaml: iface(`  speed: 100G\n${IFACE_MEMBERS}`),
		message: 'Unknown field "spec.speed" — not defined in the CRD schema for Interface',
		fieldPath: 'spec.speed',
		check: absent('speed')
	},
	{
		id: 'unknown-bridgedomain-vlanid',
		kind: 'BridgeDomain',
		group: 'services.eda.nokia.com',
		issueKind: 'unknownField',
		yaml: bridgeDomain('  type: EVPNVXLAN\n  vlanId: 10'),
		message: 'Unknown field "spec.vlanId" — not defined in the CRD schema for BridgeDomain',
		fieldPath: 'spec.vlanId',
		check: absent('vlanId')
	},
	// syntax
	{
		id: 'syntax-bad-indent',
		kind: 'TopoNode',
		group: 'core.eda.nokia.com',
		issueKind: 'syntax',
		yaml: toponode(
			`  platform: 7220 IXR-D3L\n   version: "24.10.1"\n  nodeProfile: default-node-profile\n  operatingSystem: srl`
		),
		message: 'YAML syntax error: bad indentation of a mapping entry (line 8)',
		check: parses
	},
	{
		id: 'syntax-missing-colon',
		kind: 'Interface',
		group: 'interfaces.eda.nokia.com',
		issueKind: 'syntax',
		yaml: iface(`  enabled true\n${IFACE_MEMBERS}`),
		message: 'YAML syntax error: can not read a block mapping entry (line 7)',
		check: parses
	},
	// long document → excerpt mode on the server
	{
		id: 'enum-long-interface-excerpt',
		kind: 'Interface',
		group: 'interfaces.eda.nokia.com',
		issueKind: 'enum',
		yaml: longInterface,
		message: 'spec.type must be one of: LAG, Interface, Loopback',
		fieldPath: 'spec.type',
		check: (doc) =>
			oneOf('type', ['LAG', 'Interface', 'Loopback'])(doc) ??
			((spec(doc).members as unknown[] | undefined)?.length === 110
				? null
				: 'members were lost while splicing the excerpt')
	}
];

export const FIX_EVAL_CASES: FixEvalCase[] = [...BASE_FIX_EVAL_CASES, ...CURATED_FIX_EVAL_CASES];
