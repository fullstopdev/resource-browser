import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStaticYaml } from '$lib/yaml/safeYaml';
import { describe, expect, it } from 'vitest';
import { applyIntentTierFilter } from './graphFilters';
import {
	buildCatalogFromManifest,
	getKindIndex,
	getGvkIndex,
	inferSchemaLinks,
	mergeGraphLinks
} from './inferEdges';
import {
	collectSpecProperties,
	extractExplicitRefEdges,
	extractKindsFromDescription,
	extractSchemaReferences,
	inferRelationFromDescription,
	isDescriptionMetaReference,
	kindFromRoutingPolicySetField,
	resolveGvkTarget,
	resolveKindTarget,
	resolveKindTargetWithContext,
	shouldSkipDescriptionInference
} from './schemaRefs';
import type { CrdResource } from '$lib/structure';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = JSON.parse(
	readFileSync(join(root, 'static/resources/26.4.2/manifest.json'), 'utf8')
) as CrdResource[];

const ROUTER_INTERCONNECT_ID = 'routerinterconnects.services.eda.nokia.com';
const BGP_PEER_ID = 'bgppeers.protocols.eda.nokia.com';
const ROUTER_ID = 'routers.services.eda.nokia.com';
const VIRTUAL_NETWORK_ID = 'virtualnetworks.services.eda.nokia.com';
const BRIDGE_INTERFACE_ID = 'bridgeinterfaces.services.eda.nokia.com';
const DEFAULT_BGP_PEER_ID = 'defaultbgppeers.protocols.eda.nokia.com';
const NODE_CONFIG_ID = 'nodeconfigs.core.eda.nokia.com';

function loadSpec(resourceName: string): unknown {
	const res = manifest.find((r) => r.name === resourceName);
	const version = res?.versions.find((v) => !v.deprecated)?.name ?? res?.versions[0]?.name;
	const yaml = readFileSync(join(root, 'static/resources/26.4.2', resourceName, `${version}.yaml`), 'utf8');
	return (loadStaticYaml(yaml) as { schema?: { openAPIV3Schema?: { properties?: { spec?: unknown } } } })
		.schema?.openAPIV3Schema?.properties?.spec;
}

function loadOpenApi(resourceName: string): unknown {
	const res = manifest.find((r) => r.name === resourceName);
	const version = res?.versions.find((v) => !v.deprecated)?.name ?? res?.versions[0]?.name;
	const yaml = readFileSync(join(root, 'static/resources/26.4.2', resourceName, `${version}.yaml`), 'utf8');
	return (loadStaticYaml(yaml) as { schema?: { openAPIV3Schema?: unknown } }).schema?.openAPIV3Schema;
}

describe('schemaRefs extraction', () => {
	const catalog = buildCatalogFromManifest(manifest);
	const kindIndex = getKindIndex(catalog);
	const gvkIndex = getGvkIndex(catalog);

	it('extractSchemaReferences handles x-references string and array', () => {
		const hits = extractSchemaReferences({
			properties: {
				routerRef: { type: 'string', 'x-references': 'Router' },
				policies: {
					type: 'array',
					items: { type: 'string' },
					'x-references': ['Policy', 'Keychain']
				}
			}
		});
		expect(hits.map((h) => [h.pattern, h.kind, h.fieldPath])).toEqual([
			['x-references', 'Router', 'routerRef'],
			['x-references', 'Policy', 'policies'],
			['x-references', 'Keychain', 'policies']
		]);
	});

	it('extractSchemaReferences handles root x-references and x-kubernetes-gvk', () => {
		const hits = extractSchemaReferences({
			'x-references': ['Fabric', 'TopoNode'],
			properties: {
				spec: {
					properties: {
						node: {
							type: 'object',
							'x-kubernetes-group-version-kind': {
								group: 'core.eda.nokia.com',
								kind: 'TopoNode',
								version: 'v1'
							}
						}
					}
				}
			}
		});
		expect(hits.some((h) => h.pattern === 'root-x-references' && h.kind === 'Fabric')).toBe(true);
		expect(hits.some((h) => h.pattern === 'x-kubernetes-gvk' && h.gvk?.kind === 'TopoNode')).toBe(
			true
		);
		expect(resolveGvkTarget({ group: 'core.eda.nokia.com', kind: 'TopoNode' }, gvkIndex, catalog)).toBe(
			'toponodes.core.eda.nokia.com'
		);
	});

	it('extractSchemaReferences handles kind enum inside apiVersion object', () => {
		const hits = extractSchemaReferences({
			properties: {
				spec: {
					properties: {
						resourceRef: {
							type: 'object',
							properties: {
								apiVersion: { type: 'string' },
								kind: { type: 'string', enum: ['Router', 'Policy'] }
							}
						}
					}
				}
			}
		});
		expect(hits.filter((h) => h.pattern === 'kind-apiVersion-enum').map((h) => h.kind)).toEqual([
			'Router',
			'Policy'
		]);
	});

	it('26.4.2 corpus has no x-references or x-kubernetes-gvk annotations', () => {
		let xReferences = 0;
		let xGvk = 0;
		let kindApiVersion = 0;
		let rootXRef = 0;

		for (const res of manifest) {
			const openApi = loadOpenApi(res.name);
			if (!openApi) continue;
			for (const hit of extractSchemaReferences(openApi)) {
				if (hit.pattern === 'x-references') xReferences++;
				if (hit.pattern === 'root-x-references') rootXRef++;
				if (hit.pattern === 'x-kubernetes-gvk') xGvk++;
				if (hit.pattern === 'kind-apiVersion-enum') kindApiVersion++;
			}
		}

		expect({ xReferences, xGvk, kindApiVersion, rootXRef }).toEqual({
			xReferences: 0,
			xGvk: 0,
			kindApiVersion: 0,
			rootXRef: 0
		});
	});

	it('extracts kinds from standard EDA reference descriptions', () => {
		expect(extractKindsFromDescription('Reference to a Policy CR that will be used to export routes.')).toEqual([
			'Policy'
		]);
		expect(extractKindsFromDescription('Reference to the Router instance to interconnect.')).toEqual(['Router']);
		expect(
			extractKindsFromDescription(
				'Reference to a RoutedInterface or IrbInterface resource whose IP will be used as a source IP for the BGP session.'
			)
		).toEqual(['RoutedInterface', 'IrbInterface']);
	});

	it('parses either/or and multi-kind reference chains', () => {
		expect(
			extractKindsFromDescription('Reference to either a DefaultInterface or SystemInterface resource.')
		).toEqual(['DefaultInterface', 'SystemInterface']);
		expect(
			extractKindsFromDescription('Reference to a RoutedInterface or IrbInterface or SystemInterface.')
		).toEqual(['RoutedInterface', 'IrbInterface', 'SystemInterface']);
	});

	it('normalizes IRBInterface alias to IrbInterface', () => {
		expect(
			extractKindsFromDescription('Reference to an IRBInterface resource for the local address.')
		).toContain('IrbInterface');
	});

	it('maps routing policy set fields including communitySet', () => {
		expect(kindFromRoutingPolicySetField('communitySet')).toBe('CommunitySet');
		expect(kindFromRoutingPolicySetField('prefixSet')).toBe('PrefixSet');
		const edges = extractExplicitRefEdges({
			name: 'communitySet',
			path: 'spec.statements[].match.bgp.communitySet',
			description: 'Match conditions for BGP communities.'
		});
		expect(edges.map((e) => e.kind)).toEqual(['CommunitySet']);
		expect(edges[0]?.edgeClass).toBe('hardRef');
	});

	it('resolves meta interface-kind selectors from context', () => {
		expect(isDescriptionMetaReference('Reference to the Kind of interface')).toBe(false);
		expect(
			shouldSkipDescriptionInference(
				'interfaceKind',
				'spec.ospf.interfaceKind',
				'Reference to the Kind of interface to enable OSPF on.'
			)
		).toBe(false);
		expect(extractKindsFromDescription('Reference to the Kind of interface')).toEqual([]);
		const edges = extractExplicitRefEdges(
			{
				name: 'interfaceKind',
				path: 'spec.ospf.interfaceKind',
				description: 'Reference to the Kind of interface to enable OSPF on.'
			},
			{ sourceKind: 'OSPFInterface' }
		);
		expect(edges.map((e) => e.kind)).toEqual(
			expect.arrayContaining(['RoutedInterface', 'IrbInterface', 'OSPFInterface'])
		);
		expect(edges.every((e) => e.relation === 'bindsTo')).toBe(true);
	});

	it('resolves RoutedInterface and IrbInterface for BGP local address descriptions', () => {
		expect(resolveKindTarget('RoutedInterface', 'protocols.eda.nokia.com', kindIndex, catalog)).toBeTruthy();
		expect(resolveKindTarget('IrbInterface', 'protocols.eda.nokia.com', kindIndex, catalog)).toBeTruthy();
		const routed = resolveKindTargetWithContext('RoutedInterface', 'protocols.eda.nokia.com', kindIndex, catalog, {
			fieldPath: 'spec.localAddress'
		});
		expect(routed.targetId).toBeTruthy();
		expect(catalog.get(routed.targetId ?? '')?.kind).toBe('RoutedInterface');
	});

	it('maps allocation pool descriptions to IndexAllocationPool', () => {
		expect(extractKindsFromDescription('Reference to tunnel index allocation pool.')).toContain(
			'IndexAllocationPool'
		);
		expect(extractKindsFromDescription('Reference to an EVI pool to use for allocations.')).toContain(
			'IndexAllocationPool'
		);
		expect(extractKindsFromDescription('Reference to a pool to use for Route Distinguisher allocation.')).toContain(
			'IndexAllocationPool'
		);
	});

	it('resolves Router and Interface as real catalog kinds (not blocked)', () => {
		expect(resolveKindTarget('Router', 'services.eda.nokia.com', kindIndex, catalog)).toBe(ROUTER_ID);
		expect(resolveKindTarget('Interface', 'interfaces.eda.nokia.com', kindIndex, catalog)).toBe(
			'interfaces.interfaces.eda.nokia.com'
		);
	});

	it('RouterInterconnect strict deps include Router, Policy, and pools', () => {
		const openApi = loadOpenApi(ROUTER_INTERCONNECT_ID);
		const links = applyIntentTierFilter(
			mergeGraphLinks(
				inferSchemaLinks(
					ROUTER_INTERCONNECT_ID,
					'services.eda.nokia.com',
					openApi,
					undefined,
					kindIndex,
					catalog,
					gvkIndex,
					{ enableDescriptionPass: false }
				)
			),
			false
		);

		const targets = new Map(links.map((l) => [l.target, l.rel]));
		expect(targets.get('policys.routingpolicies.eda.nokia.com')).toBe('appliesTo');
		expect(targets.get(ROUTER_ID)).toBe('references');
		expect(targets.get('indexallocationpools.core.eda.nokia.com')).toBe('references');
		expect(targets.size).toBe(3);
	});

	it('BGPPeer strict deps include BGPGroup and interface kinds', () => {
		const openApi = loadOpenApi(BGP_PEER_ID);
		const links = applyIntentTierFilter(
			mergeGraphLinks(
				inferSchemaLinks(
					BGP_PEER_ID,
					'protocols.eda.nokia.com',
					openApi,
					undefined,
					kindIndex,
					catalog,
					gvkIndex,
					{ enableDescriptionPass: false }
				)
			),
			false
		);

		const targetKinds = links.map((l) => catalog.get(l.target)?.kind);
		expect(targetKinds).toContain('Policy');
		expect(targetKinds).toContain('BGPGroup');
		expect(targetKinds).toContain('Keychain');
		expect(targetKinds.some((k) => k === 'RoutedInterface' || k === 'IrbInterface')).toBe(true);
	});

	it('skips label selectors without TopoNode in description', () => {
		const spec = loadSpec(ROUTER_INTERCONNECT_ID);
		const props = collectSpecProperties(spec);
		const nodeSelectors = props.find((p) => p.name === 'nodeSelectors');
		expect(nodeSelectors).toBeDefined();
		const edges = extractExplicitRefEdges(nodeSelectors!);
		expect(edges).toHaveLength(0);
	});

	it('infers operational relations from description intent wording', () => {
		expect(
			inferRelationFromDescription('Reference to a TopoNode to which this config is applied')
		).toBe('bindsTo');
		expect(inferRelationFromDescription('Reference to a Policy CR that will be used to filter routes')).toBe(
			'appliesTo'
		);
		expect(inferRelationFromDescription('Reference to the topology that this overlay is extending')).toBe(
			'extends'
		);
	});

	it('NodeConfig node-endpoint binds to TopoNode with hardRef edgeClass', () => {
		const openApi = loadOpenApi(NODE_CONFIG_ID);
		const links = inferSchemaLinks(
			NODE_CONFIG_ID,
			'core.eda.nokia.com',
			openApi,
			undefined,
			kindIndex,
			catalog,
			gvkIndex,
			{ enableDescriptionPass: false }
		);
		const topo = links.find((l) => l.target === 'toponodes.core.eda.nokia.com');
		expect(topo?.rel).toBe('bindsTo');
		expect(topo?.edgeClass).toBe('hardRef');
	});

	it('skips internal NetworkTopology template references but resolves Monitor targets', () => {
		expect(
			shouldSkipDescriptionInference(
				'template',
				'spec.nodes[].template',
				'Reference to a template to use for this TopoNode.'
			)
		).toBe(true);
		const monitorEdges = extractExplicitRefEdges(
			{
				name: 'target',
				path: 'status.target',
				description: 'Reference to the target being monitored'
			},
			{ sourceKind: 'MonitorState' }
		);
		expect(monitorEdges).toHaveLength(1);
		expect(monitorEdges[0]?.kind).toBe('TopoNode');
		expect(monitorEdges[0]?.relation).toBe('bindsTo');
	});

	it('schema annotation x-references produces tier-1 hardRef edges', () => {
		const syntheticSchema = {
			properties: {
				spec: {
					properties: {
						routerRef: {
							type: 'string',
							'x-references': 'Router'
						}
					}
				}
			}
		};
		const links = inferSchemaLinks(
			ROUTER_INTERCONNECT_ID,
			'services.eda.nokia.com',
			syntheticSchema,
			undefined,
			kindIndex,
			catalog,
			gvkIndex,
			{ enableDescriptionPass: false }
		);
		const routerEdge = links.find((l) => l.target === ROUTER_ID);
		expect(routerEdge).toBeDefined();
		expect(routerEdge?.confidenceTier).toBe(1);
		expect(routerEdge?.edgeClass).toBe('hardRef');
		expect(routerEdge?.reason).toContain('x-references');
	});

	it('VirtualNetwork strict deps include core networking kinds', () => {
		const openApi = loadOpenApi(VIRTUAL_NETWORK_ID);
		const links = applyIntentTierFilter(
			mergeGraphLinks(
				inferSchemaLinks(
					VIRTUAL_NETWORK_ID,
					'services.eda.nokia.com',
					openApi,
					undefined,
					kindIndex,
					catalog,
					gvkIndex
				)
			),
			false
		);
		const targetKinds = links.map((l) => catalog.get(l.target)?.kind);
		for (const kind of ['Router', 'Policy', 'BGPGroup', 'BridgeDomain', 'IndexAllocationPool', 'Interface']) {
			expect(targetKinds, `missing ${kind}`).toContain(kind);
		}
	});

	it('BridgeInterface strict deps include BridgeDomain and Interface', () => {
		const openApi = loadOpenApi(BRIDGE_INTERFACE_ID);
		const links = applyIntentTierFilter(
			mergeGraphLinks(
				inferSchemaLinks(
					BRIDGE_INTERFACE_ID,
					'services.eda.nokia.com',
					openApi,
					undefined,
					kindIndex,
					catalog,
					gvkIndex
				)
			),
			false
		);
		const targetKinds = links.map((l) => catalog.get(l.target)?.kind);
		expect(targetKinds).toContain('BridgeDomain');
		expect(targetKinds).toContain('Interface');
	});

	it('DefaultBGPPeer strict deps include DefaultInterface and SystemInterface', () => {
		const openApi = loadOpenApi(DEFAULT_BGP_PEER_ID);
		const links = applyIntentTierFilter(
			mergeGraphLinks(
				inferSchemaLinks(
					DEFAULT_BGP_PEER_ID,
					'protocols.eda.nokia.com',
					openApi,
					undefined,
					kindIndex,
					catalog,
					gvkIndex
				)
			),
			false
		);
		const targetKinds = links.map((l) => catalog.get(l.target)?.kind);
		expect(targetKinds).toContain('DefaultInterface');
		expect(targetKinds).toContain('SystemInterface');
	});

	it('does not infer TopoNode from RouterInterconnect nodeSelectors', () => {
		const openApi = loadOpenApi(ROUTER_INTERCONNECT_ID);
		const links = inferSchemaLinks(
			ROUTER_INTERCONNECT_ID,
			'services.eda.nokia.com',
			openApi,
			undefined,
			kindIndex,
			catalog,
			gvkIndex
		);
		expect(links.some((l) => l.target.includes('toponodes') && l.field?.includes('nodeSelectors'))).toBe(
			false
		);
	});
});
