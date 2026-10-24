/**
 * More AI Fix eval cases, made by breaking the curated Insert examples (valid on EDA 26.8.2, from
 * docs.eda.dev) in one or two places: Fabric, BGP, routing policy, services and topology kinds.
 * fixCases.test.ts checks every mutation applies and that the validator reports the issue.
 */
import curated from '$lib/validate-bundle/curatedExamples.json';
import type { FixEvalCase } from './fixCases';

type Doc = Record<string, unknown>;

/** Value at a dot path such as `spec.overlayProtocol.protocol` or `spec.links.0.speed`. */
export function valueAt(doc: Doc, path: string): unknown {
	return path
		.split('.')
		.reduce<unknown>(
			(node, key) =>
				node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
			doc
		);
}

const oneOf = (path: string, allowed: unknown[]) => (doc: Doc) =>
	allowed.includes(valueAt(doc, path))
		? null
		: `${path} = ${JSON.stringify(valueAt(doc, path))}, expected one of ${allowed.join(', ')}`;

const isType = (path: string, type: 'integer' | 'boolean' | 'string') => (doc: Doc) => {
	const value = valueAt(doc, path);
	const ok = type === 'integer' ? Number.isInteger(value) : typeof value === (type as string);
	return ok ? null : `${path} = ${JSON.stringify(value)}, expected ${type}`;
};

const present = (path: string) => (doc: Doc) =>
	valueAt(doc, path) !== undefined ? null : `${path} is still missing`;

const absent = (path: string) => (doc: Doc) =>
	valueAt(doc, path) === undefined ? null : `${path} is still present`;

/** Every check passes (the target issue is fixed and nothing else was broken). */
const all =
	(...checks: Array<(doc: Doc) => string | null>) =>
	(doc: Doc) => {
		for (const check of checks) {
			const problem = check(doc);
			if (problem) return problem;
		}
		return null;
	};

/** Unchanged value: the model must not "fix" fields that were already right. */
const keeps = (path: string, value: unknown) => (doc: Doc) =>
	JSON.stringify(valueAt(doc, path)) === JSON.stringify(value)
		? null
		: `${path} changed to ${JSON.stringify(valueAt(doc, path))}, expected ${JSON.stringify(value)}`;

function example(label: string) {
	const found = curated.examples.find((e) => e.label === label);
	if (!found) throw new Error(`curated example "${label}" not found`);
	return found;
}

/** A curated example with `from` replaced by `to` (each pair must match). */
export function mutate(label: string, ...edits: Array<[string, string]>): string {
	let yaml = example(label).yaml;
	for (const [from, to] of edits) {
		if (!yaml.includes(from)) throw new Error(`"${label}": "${from}" not found`);
		yaml = yaml.replace(from, to);
	}
	return yaml;
}

type CaseSpec = Omit<FixEvalCase, 'kind' | 'group' | 'yaml'> & {
	label: string;
	edits: Array<[string, string]>;
};

function build(spec: CaseSpec): FixEvalCase & { label: string } {
	const { label, edits, ...rest } = spec;
	const ex = example(label);
	return { ...rest, label, kind: ex.kind, group: ex.group, yaml: mutate(label, ...edits) };
}

const OS = ['srl', 'sros', 'eos', 'sonic', 'ios-xr', 'nxos', 'junos', 'cumulus'];
const UNDERLAY = ['EBGP', 'OSPFv2', 'OSPFv3', 'ISIS'];

const SPECS: CaseSpec[] = [
	// Fabric
	{
		id: 'fabric-enum-overlay-protocol-case',
		label: 'Fabric',
		issueKind: 'enum',
		edits: [['protocol: IBGP', 'protocol: iBGP']],
		message:
			"spec.overlayProtocol.protocol: value 'iBGP' is invalid; must be one of: IBGP, EBGP (exact case)",
		fieldPath: 'spec.overlayProtocol.protocol',
		check: oneOf('spec.overlayProtocol.protocol', ['IBGP'])
	},
	{
		id: 'fabric-enum-underlay-protocol',
		label: 'Fabric',
		issueKind: 'enum',
		edits: [['- OSPFv2', '- OSPF']],
		message:
			"spec.underlayProtocol.protocols.0: value 'OSPF' is invalid; must be one of: EBGP, OSPFv2, OSPFv3, ISIS (exact case)",
		fieldPath: 'spec.underlayProtocol.protocols.0',
		check: oneOf('spec.underlayProtocol.protocols.0', UNDERLAY)
	},
	{
		id: 'fabric-type-mtu-string',
		label: 'Fabric',
		issueKind: 'type',
		edits: [['ipMTU: 8922', "ipMTU: '8922'"]],
		message: 'spec.interSwitchLinks.ipMTU must be integer,null (found string "8922")',
		fieldPath: 'spec.interSwitchLinks.ipMTU',
		check: all(
			isType('spec.interSwitchLinks.ipMTU', 'integer'),
			keeps('spec.interSwitchLinks.ipMTU', 8922)
		)
	},
	{
		id: 'fabric-type-asn-string',
		label: 'Fabric',
		issueKind: 'type',
		edits: [['autonomousSystem: 65500', "autonomousSystem: '65500'"]],
		message:
			'spec.overlayProtocol.bgp.autonomousSystem must be integer,null (found string "65500")',
		fieldPath: 'spec.overlayProtocol.bgp.autonomousSystem',
		check: keeps('spec.overlayProtocol.bgp.autonomousSystem', 65500)
	},
	{
		id: 'fabric-type-bfd-enabled-word',
		label: 'Fabric',
		issueKind: 'type',
		edits: [['enabled: true', 'enabled: "yes"']],
		message: 'spec.underlayProtocol.bfd.enabled must be boolean (found string "yes")',
		fieldPath: 'spec.underlayProtocol.bfd.enabled',
		check: keeps('spec.underlayProtocol.bfd.enabled', true)
	},
	{
		id: 'fabric-required-overlay-protocol',
		label: 'Fabric',
		issueKind: 'required',
		edits: [['    protocol: IBGP\n', '']],
		message: 'spec.overlayProtocol.protocol is required',
		fieldPath: 'spec.overlayProtocol',
		check: oneOf('spec.overlayProtocol.protocol', ['IBGP', 'EBGP'])
	},
	{
		id: 'fabric-unknown-underlay-field',
		label: 'Fabric',
		issueKind: 'unknownField',
		edits: [
			['    protocols:\n      - OSPFv2', '    protocols:\n      - OSPFv2\n    area: 0.0.0.0']
		],
		message:
			'Unknown field "spec.underlayProtocol.area" — not defined in the CRD schema for Fabric',
		fieldPath: 'spec.underlayProtocol.area',
		check: all(
			absent('spec.underlayProtocol.area'),
			keeps('spec.underlayProtocol.protocols', ['OSPFv2'])
		)
	},
	{
		id: 'fabric-unknown-misspelled-spines',
		label: 'Fabric',
		issueKind: 'unknownField',
		edits: [['  spines:\n', '  spine:\n']],
		message: 'Misspelled field "spec.spine" — use "spec.spines" per the CRD schema for Fabric',
		fieldPath: 'spec.spine',
		check: all(absent('spec.spine'), present('spec.spines.spineNodeSelectors'))
	},
	// BGP
	{
		id: 'bgppeer-enum-interface-kind',
		label: 'BGPPeer',
		issueKind: 'enum',
		edits: [['interfaceKind: RoutedInterface', 'interfaceKind: routed-interface']],
		message:
			"spec.interfaceKind: value 'routed-interface' is invalid; must be one of: RoutedInterface, IRBInterface (exact case)",
		fieldPath: 'spec.interfaceKind',
		check: oneOf('spec.interfaceKind', ['RoutedInterface'])
	},
	{
		id: 'bgppeer-required-group',
		label: 'BGPPeer',
		issueKind: 'required',
		edits: [['  group: my-bgp-group\n', '']],
		message: 'spec.group is required',
		fieldPath: 'spec',
		check: isType('spec.group', 'string')
	},
	{
		id: 'bgppeer-type-ipv4-enabled-string',
		label: 'BGPPeer',
		issueKind: 'type',
		edits: [['  ipv4Unicast:\n    enabled: true', '  ipv4Unicast:\n    enabled: "true"']],
		message: 'spec.ipv4Unicast.enabled must be boolean,null (found string "true")',
		fieldPath: 'spec.ipv4Unicast.enabled',
		check: keeps('spec.ipv4Unicast.enabled', true)
	},
	{
		id: 'bgppeer-unknown-remote-as',
		label: 'BGPPeer',
		issueKind: 'unknownField',
		edits: [['  peerIP: 192.168.0.2', '  peerIP: 192.168.0.2\n  remoteAS: 65001']],
		message: 'Unknown field "spec.remoteAS" — not defined in the CRD schema for BGPPeer',
		fieldPath: 'spec.remoteAS',
		check: all(absent('spec.remoteAS'), keeps('spec.peerIP', '192.168.0.2'))
	},
	{
		id: 'bgpgroup-required-local-as',
		label: 'BGPGroup',
		issueKind: 'required',
		edits: [['  localAS:\n    autonomousSystem: 100\n', '  localAS: {}\n']],
		message: 'spec.localAS.autonomousSystem is required',
		fieldPath: 'spec.localAS',
		check: isType('spec.localAS.autonomousSystem', 'integer')
	},
	{
		id: 'bgpgroup-type-peer-as-string',
		label: 'BGPGroup',
		issueKind: 'type',
		edits: [['  peerAS:\n    autonomousSystem: 100', "  peerAS:\n    autonomousSystem: 'AS100'"]],
		message: 'spec.peerAS.autonomousSystem must be integer (found string "AS100")',
		fieldPath: 'spec.peerAS.autonomousSystem',
		check: keeps('spec.peerAS.autonomousSystem', 100)
	},
	{
		id: 'bgpgroup-unknown-flat-asn',
		label: 'BGPGroup',
		issueKind: 'unknownField',
		edits: [['  localAS:\n', '  localASN: 100\n  localAS:\n']],
		message: 'Unknown field "spec.localASN" — not defined in the CRD schema for BGPGroup',
		fieldPath: 'spec.localASN',
		check: all(absent('spec.localASN'), keeps('spec.localAS.autonomousSystem', 100))
	},
	{
		id: 'defaultrouter-type-ecmp-string',
		label: 'DefaultRouter',
		issueKind: 'type',
		edits: [['  ecmp: 64', "  ecmp: '64'"]],
		message: 'spec.ecmp must be integer,null (found string "64")',
		fieldPath: 'spec.ecmp',
		check: keeps('spec.ecmp', 64)
	},
	{
		id: 'defaultrouter-required-router-id',
		label: 'DefaultRouter',
		issueKind: 'required',
		edits: [['  routerID: 11.0.0.2\n', '']],
		message: 'spec.routerID is required',
		fieldPath: 'spec',
		check: isType('spec.routerID', 'string')
	},
	{
		id: 'defaultrouter-unknown-misspelled-fib',
		label: 'DefaultRouter',
		issueKind: 'unknownField',
		edits: [['waitForFibInstall: false', 'waitForFIBinstall: false']],
		message:
			'Misspelled field "spec.bgp.waitForFIBinstall" — use "spec.bgp.waitForFibInstall" per the CRD schema for DefaultRouter',
		fieldPath: 'spec.bgp.waitForFIBinstall',
		check: absent('spec.bgp.waitForFIBinstall')
	},
	// Routing policy
	{
		id: 'aspathset-enum-regex-mode',
		label: 'ASPathSet',
		issueKind: 'enum',
		edits: [['regexMode: ASN', 'regexMode: asn']],
		message: "spec.regexMode: value 'asn' is invalid; must be one of: ASN, Character (exact case)",
		fieldPath: 'spec.regexMode',
		check: oneOf('spec.regexMode', ['ASN'])
	},
	{
		id: 'prefixset-type-exact-string',
		label: 'PrefixSet',
		issueKind: 'type',
		edits: [['exact: true', 'exact: "true"']],
		message: 'spec.prefixes.0.exact must be boolean,null (found string "true")',
		fieldPath: 'spec.prefixes.0.exact',
		check: keeps('spec.prefixes.0.exact', true)
	},
	{
		id: 'prefixset-required-prefix',
		label: 'PrefixSet',
		issueKind: 'required',
		edits: [['    - prefix: 10.10.10.0/24\n      exact: true', '    - exact: true']],
		message: 'spec.prefixes.0.prefix is required',
		fieldPath: 'spec.prefixes.0',
		check: isType('spec.prefixes.0.prefix', 'string')
	},
	// Services
	{
		id: 'bridgedomain-v2-enum-type-case',
		label: 'BridgeDomain',
		issueKind: 'enum',
		edits: [['  type: EVPNVXLAN', '  type: evpn-vxlan']],
		message:
			"spec.type: value 'evpn-vxlan' is invalid; must be one of: Simple, EVPNVXLAN, EVPNMPLS (exact case)",
		fieldPath: 'spec.type',
		check: oneOf('spec.type', ['EVPNVXLAN'])
	},
	{
		id: 'bridgedomain-v2-type-aging-string',
		label: 'BridgeDomain',
		issueKind: 'type',
		edits: [['agingTimeSeconds: 300', "agingTimeSeconds: '300s'"]],
		message: 'spec.macLearning.agingTimeSeconds must be integer,null (found string "300s")',
		fieldPath: 'spec.macLearning.agingTimeSeconds',
		check: keeps('spec.macLearning.agingTimeSeconds', 300)
	},
	{
		id: 'bridgedomain-v2-required-maclearning-enabled',
		label: 'BridgeDomain',
		issueKind: 'required',
		edits: [['    agingTimeSeconds: 300\n    enabled: true\n', '    agingTimeSeconds: 300\n']],
		message: 'spec.macLearning.enabled is required',
		fieldPath: 'spec.macLearning',
		check: isType('spec.macLearning.enabled', 'boolean')
	},
	{
		id: 'router-enum-type',
		label: 'Router',
		issueKind: 'enum',
		edits: [['  type: EVPNVXLAN', '  type: VXLAN']],
		message:
			"spec.type: value 'VXLAN' is invalid; must be one of: Simple, EVPNVXLAN, EVPNMPLS, IPVPN (exact case)",
		fieldPath: 'spec.type',
		check: oneOf('spec.type', ['EVPNVXLAN'])
	},
	{
		id: 'router-type-preference-string',
		label: 'Router',
		issueKind: 'type',
		edits: [['    ebgpPreference: 170', "    ebgpPreference: '170'"]],
		message: 'spec.bgp.ebgpPreference must be integer,null (found string "170")',
		fieldPath: 'spec.bgp.ebgpPreference',
		check: keeps('spec.bgp.ebgpPreference', 170)
	},
	{
		id: 'irb-enum-index-mode',
		label: 'IRBInterface',
		issueKind: 'enum',
		edits: [['mode: GlobalPool', 'mode: Global']],
		message:
			"spec.indexAllocation.mode: value 'Global' is invalid; must be one of: GlobalPool, PerNodePool, Manual (exact case)",
		fieldPath: 'spec.indexAllocation.mode',
		check: oneOf('spec.indexAllocation.mode', ['GlobalPool'])
	},
	{
		id: 'irb-required-router',
		label: 'IRBInterface',
		issueKind: 'required',
		edits: [['  router: dhcp-router\n', '']],
		message: 'spec.router is required',
		fieldPath: 'spec',
		check: all(isType('spec.router', 'string'), present('spec.ipAddresses.2'))
	},
	{
		id: 'irb-type-anycast-string',
		label: 'IRBInterface',
		issueKind: 'type',
		edits: [['        anycast: true', "        anycast: 'true'"]],
		message: 'spec.ipAddresses.0.ipv4Address.anycast must be boolean,null (found string "true")',
		fieldPath: 'spec.ipAddresses.0.ipv4Address.anycast',
		check: keeps('spec.ipAddresses.0.ipv4Address.anycast', true)
	},
	{
		id: 'routedinterface-required-interface',
		label: 'RoutedInterface',
		issueKind: 'required',
		edits: [['  interface: dc1-leaf-1-ethernet-1-8\n', '']],
		message: 'spec.interface is required',
		fieldPath: 'spec',
		check: isType('spec.interface', 'string')
	},
	{
		id: 'routedinterface-type-mtu-string',
		label: 'RoutedInterface',
		issueKind: 'type',
		edits: [['  ipMTU: 1500', "  ipMTU: '1500'"]],
		message: 'spec.ipMTU must be integer,null (found string "1500")',
		fieldPath: 'spec.ipMTU',
		check: keeps('spec.ipMTU', 1500)
	},
	{
		id: 'vlan-required-bridge-domain',
		label: 'VLAN',
		issueKind: 'required',
		edits: [['  bridgeDomain: stretched-l2\n', '']],
		message: 'spec.bridgeDomain is required',
		fieldPath: 'spec',
		check: all(isType('spec.bridgeDomain', 'string'), keeps('spec.vlanID', '100'))
	},
	{
		id: 'bridgeinterface-unknown-vlan-key',
		label: 'BridgeInterface',
		issueKind: 'unknownField',
		edits: [["  vlanID: '123'", "  vlanID: '123'\n  vlan: 123"]],
		message: 'Unknown field "spec.vlan" — not defined in the CRD schema for BridgeInterface',
		fieldPath: 'spec.vlan',
		check: all(absent('spec.vlan'), keeps('spec.vlanID', '123'))
	},
	// Topology
	{
		id: 'toponode-v26-enum-npp-mode',
		label: 'TopoNode',
		issueKind: 'enum',
		edits: [['mode: normal', 'mode: Normal']],
		message:
			"spec.npp.mode: value 'Normal' is invalid; must be one of: normal, maintenance, null, emulate, monitor (exact case)",
		fieldPath: 'spec.npp.mode',
		check: oneOf('spec.npp.mode', ['normal'])
	},
	{
		id: 'toponode-v26-required-platform',
		label: 'TopoNode',
		issueKind: 'required',
		edits: [['  platform: 7220 IXR-D3L\n', '']],
		message: 'spec.platform is required',
		fieldPath: 'spec',
		check: isType('spec.platform', 'string')
	},
	{
		id: 'topolink-enum-speed',
		label: 'TopoLink',
		issueKind: 'enum',
		edits: [['speed: 25G', 'speed: 25Gbps']],
		message:
			"spec.links.0.speed: value '25Gbps' is invalid; must be one of: 1.6T, 800G, 400G, 200G, 100G, 50G, 40G, 25G, 10G, 2.5G, 1G, 100M (exact case)",
		fieldPath: 'spec.links.0.speed',
		check: oneOf('spec.links.0.speed', ['25G'])
	},
	{
		id: 'topolink-enum-link-type',
		label: 'TopoLink',
		issueKind: 'enum',
		edits: [['      type: interSwitch', '      type: inter-switch']],
		message:
			"spec.links.0.type: value 'inter-switch' is invalid; must be one of: edge, interSwitch, loopback (exact case)",
		fieldPath: 'spec.links.0.type',
		check: oneOf('spec.links.0.type', ['interSwitch'])
	},
	{
		id: 'interface-curated-type-mtu-string',
		label: 'Interface',
		issueKind: 'type',
		edits: [['  mtu: 2500', "  mtu: '2500'"]],
		message: 'spec.mtu must be integer,null (found string "2500")',
		fieldPath: 'spec.mtu',
		check: keeps('spec.mtu', 2500)
	},
	// Multi-issue: fix the reported one, leave the document otherwise intact.
	{
		id: 'multi-toponode-os-and-npp',
		label: 'TopoNode',
		issueKind: 'enum',
		edits: [
			['operatingSystem: srl', 'operatingSystem: SRL'],
			['mode: normal', 'mode: Normal']
		],
		message:
			"spec.operatingSystem: value 'SRL' is invalid; must be one of: srl, sros, eos, sonic, ios-xr, nxos, junos, cumulus (exact case)",
		fieldPath: 'spec.operatingSystem',
		check: all(
			oneOf('spec.operatingSystem', OS),
			present('spec.npp.mode'),
			keeps('spec.version', '26.7.1')
		)
	},
	{
		id: 'multi-fabric-protocol-and-mtu',
		label: 'Fabric',
		issueKind: 'enum',
		edits: [
			['protocol: IBGP', 'protocol: ibgp'],
			['ipMTU: 8922', "ipMTU: '8922'"]
		],
		message:
			"spec.overlayProtocol.protocol: value 'ibgp' is invalid; must be one of: IBGP, EBGP (exact case)",
		fieldPath: 'spec.overlayProtocol.protocol',
		check: all(
			oneOf('spec.overlayProtocol.protocol', ['IBGP']),
			present('spec.leafs.asnPool'),
			present('spec.underlayProtocol.bfd.enabled')
		)
	},
	{
		id: 'multi-bgppeer-kind-and-unknown',
		label: 'BGPPeer',
		issueKind: 'unknownField',
		edits: [
			['interfaceKind: RoutedInterface', 'interfaceKind: Routed'],
			['  peerIP: 192.168.0.2', '  peerIP: 192.168.0.2\n  password: secret']
		],
		message: 'Unknown field "spec.password" — not defined in the CRD schema for BGPPeer',
		fieldPath: 'spec.password',
		check: all(absent('spec.password'), keeps('spec.group', 'my-bgp-group'))
	}
];

export const CURATED_FIX_EVAL_CASES = SPECS.map(build);
