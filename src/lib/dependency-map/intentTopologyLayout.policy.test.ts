import { describe, expect, it } from 'vitest';
import { assertNoLayoutOverlaps, buildIntentTopologyLayout, COLUMN_WIDTH, findLayoutOverlaps } from './intentTopologyLayout';
import { isMapTopologyLink, isTopologyLayoutLink } from './markmapMarkdown';
import type { DependencyGraph } from './types';
import releaseGraph from '../../../static/resources/26.4.2/dependency-graph.json';

const policyGraph: DependencyGraph = {
	releaseFolder: 'resources/26.4.2',
	generatedAt: '2026-01-01',
	nodes: [
		{
			id: 'policys.routingpolicies.eda.nokia.com',
			kind: 'Policy',
			group: 'routingpolicies.eda.nokia.com',
			type: 'config',
			version: 'v1',
			shortName: 'policys'
		},
		{
			id: 'aspathsets.routingpolicies.eda.nokia.com',
			kind: 'ASPathSet',
			group: 'routingpolicies.eda.nokia.com',
			type: 'config',
			version: 'v1',
			shortName: 'aspathsets'
		},
		{
			id: 'prefixsets.routingpolicies.eda.nokia.com',
			kind: 'PrefixSet',
			group: 'routingpolicies.eda.nokia.com',
			type: 'config',
			version: 'v1',
			shortName: 'prefixsets'
		},
		{
			id: 'tagsets.routingpolicies.eda.nokia.com',
			kind: 'TagSet',
			group: 'routingpolicies.eda.nokia.com',
			type: 'config',
			version: 'v1',
			shortName: 'tagsets'
		},
		{
			id: 'routers.services.eda.nokia.com',
			kind: 'Router',
			group: 'services.eda.nokia.com',
			type: 'config',
			version: 'v1',
			shortName: 'routers'
		}
	],
	links: [
		{
			id: 'p-as',
			source: 'policys.routingpolicies.eda.nokia.com',
			target: 'aspathsets.routingpolicies.eda.nokia.com',
			rel: 'references',
			field: 'spec.statements[].match.bgp.asPathMatch.asPathSet',
			edgeClass: 'hardRef',
			edgeSource: 'explicit'
		},
		{
			id: 'p-ps',
			source: 'policys.routingpolicies.eda.nokia.com',
			target: 'prefixsets.routingpolicies.eda.nokia.com',
			rel: 'references',
			field: 'spec.statements[].match.prefixSet',
			edgeClass: 'hardRef',
			edgeSource: 'explicit'
		},
		{
			id: 'p-ts',
			source: 'policys.routingpolicies.eda.nokia.com',
			target: 'tagsets.routingpolicies.eda.nokia.com',
			rel: 'references',
			field: 'spec.statements[].match.tags.tagSet',
			edgeClass: 'hardRef',
			edgeSource: 'explicit'
		},
		{
			id: 'r-p',
			source: 'routers.services.eda.nokia.com',
			target: 'policys.routingpolicies.eda.nokia.com',
			rel: 'appliesTo',
			edgeClass: 'intentDependency',
			edgeSource: 'semantic'
		}
	]
};

const policyFocus = 'policys.routingpolicies.eda.nokia.com';

describe('Policy intent topology layout', () => {
	it('places appliesTo consumers left, focus center, referenced sets right', () => {
		const layout = buildIntentTopologyLayout(policyGraph, policyFocus);

		const kinds = layout.nodes.map((n) => n.data.kind).sort();
		expect(kinds).toEqual(['ASPathSet', 'Policy', 'PrefixSet', 'Router', 'TagSet']);
		expect(kinds).not.toContain('CommunitySet');

		const focus = layout.nodes.find((n) => n.id === policyFocus)!;
		expect(focus.position.x).toBe(COLUMN_WIDTH);

		const asPath = layout.nodes.find((n) => n.data.kind === 'ASPathSet')!;
		expect(asPath.data.role).toBe('prerequisite');
		expect(asPath.position.x).toBe(COLUMN_WIDTH * 2);
		expect(asPath.position.x).toBeGreaterThan(focus.position.x);

		const router = layout.nodes.find((n) => n.data.kind === 'Router')!;
		expect(router.data.role).toBe('dependent');
		expect(router.position.x).toBe(0);
		expect(router.position.x).toBeLessThan(focus.position.x);

		const prereqEdge = layout.edges.find((e) => e.source === policyFocus && e.target.includes('aspathsets'));
		expect(prereqEdge?.rel).toBe('references');

		const consumerEdge = layout.edges.find((e) => e.target === policyFocus && e.source.includes('routers'));
		expect(consumerEdge?.rel).toBe('appliesTo');
	});

	it('refocusing BGPPeer shows Policy prerequisite on the right', () => {
		const bgpPeerGraph: DependencyGraph = {
			...policyGraph,
			nodes: [
				...policyGraph.nodes,
				{
					id: 'bgppeers.protocols.eda.nokia.com',
					kind: 'BGPPeer',
					group: 'protocols.eda.nokia.com',
					type: 'config',
					version: 'v1',
					shortName: 'bgppeers'
				}
			],
			links: [
				...policyGraph.links,
				{
					id: 'bp-p',
					source: 'bgppeers.protocols.eda.nokia.com',
					target: 'policys.routingpolicies.eda.nokia.com',
					rel: 'appliesTo',
					field: 'spec.exportPolicies',
					edgeClass: 'hardRef',
					edgeSource: 'explicit'
				}
			]
		};

		const layout = buildIntentTopologyLayout(
			bgpPeerGraph,
			'bgppeers.protocols.eda.nokia.com'
		);

		const policy = layout.nodes.find((n) => n.data.kind === 'Policy')!;
		expect(policy).toBeDefined();
		expect(policy.data.role).toBe('prerequisite');
		expect(policy.position.x).toBeGreaterThan(
			layout.nodes.find((n) => n.data.isFocus)!.position.x
		);

		const usesEdge = layout.edges.find(
			(e) =>
				e.source === 'bgppeers.protocols.eda.nokia.com' &&
				e.target === 'policys.routingpolicies.eda.nokia.com'
		);
		expect(usesEdge?.rel).toBe('appliesTo');
	});

	it('places reversed appliesTo provider on the right when focus is consumer', () => {
		const reversedGraph: DependencyGraph = {
			...policyGraph,
			nodes: [
				...policyGraph.nodes,
				{
					id: 'bgppeers.protocols.eda.nokia.com',
					kind: 'BGPPeer',
					group: 'protocols.eda.nokia.com',
					type: 'config',
					version: 'v1',
					shortName: 'bgppeers'
				}
			],
			links: [
				...policyGraph.links,
				{
					id: 'p-bp',
					source: 'policys.routingpolicies.eda.nokia.com',
					target: 'bgppeers.protocols.eda.nokia.com',
					rel: 'appliesTo',
					field: 'spec.exportPolicies',
					edgeClass: 'hardRef',
					edgeSource: 'explicit'
				}
			]
		};

		const layout = buildIntentTopologyLayout(
			reversedGraph,
			'bgppeers.protocols.eda.nokia.com'
		);

		const policy = layout.nodes.find((n) => n.data.kind === 'Policy')!;
		expect(policy.data.role).toBe('prerequisite');
		expect(policy.position.x).toBeGreaterThan(
			layout.nodes.find((n) => n.data.isFocus)!.position.x
		);
	});

	it('refocusing ASPathSet shows Policy consumer on the left', () => {
		const layout = buildIntentTopologyLayout(
			policyGraph,
			'aspathsets.routingpolicies.eda.nokia.com'
		);

		expect(layout.nodes.map((n) => n.data.kind)).not.toContain('PrefixSet');
		expect(layout.nodes.map((n) => n.data.kind)).toContain('Policy');

		const policy = layout.nodes.find((n) => n.data.kind === 'Policy')!;
		expect(policy.data.role).toBe('dependent');
		expect(policy.position.x).toBeLessThan(
			layout.nodes.find((n) => n.data.isFocus)!.position.x
		);
	});

	it('has no overlapping nodes for policy focus', () => {
		const layout = buildIntentTopologyLayout(policyGraph, policyFocus);
		assertNoLayoutOverlaps(layout.nodes);
	});
});

describe('Dense release-graph layouts', () => {
	const graph = releaseGraph as DependencyGraph;

	it('interfaces.interfaces.eda.nokia.com has no overlapping nodes', () => {
		const layout = buildIntentTopologyLayout(graph, 'interfaces.interfaces.eda.nokia.com');
		expect(layout.isEmpty).toBe(false);
		expect(findLayoutOverlaps(layout.nodes)).toEqual([]);
		assertNoLayoutOverlaps(layout.nodes);

		const focus = layout.nodes.find((n) => n.data.isFocus)!;
		const prereqs = layout.nodes.filter((n) => n.data.role === 'prerequisite');
		const deps = layout.nodes.filter((n) => n.data.role === 'dependent');
		expect(deps.every((n) => n.position.x < focus.position.x)).toBe(true);
		expect(prereqs.every((n) => n.position.x > focus.position.x)).toBe(true);
	});

	it('policys.routingpolicies.eda.nokia.com has no overlapping nodes', () => {
		const layout = buildIntentTopologyLayout(graph, policyFocus);
		expect(layout.isEmpty).toBe(false);
		expect(findLayoutOverlaps(layout.nodes)).toEqual([]);
		assertNoLayoutOverlaps(layout.nodes);

		const focus = layout.nodes.find((n) => n.data.isFocus)!;
		const prereqs = layout.nodes.filter((n) => n.data.role === 'prerequisite');
		const deps = layout.nodes.filter((n) => n.data.role === 'dependent');
		expect(prereqs.length).toBe(3);
		expect(deps.length).toBe(17);
		expect(deps.every((n) => n.position.x < focus.position.x)).toBe(true);
		expect(prereqs.every((n) => n.position.x > focus.position.x)).toBe(true);
	});

	it('policys keeps required-by consumers when graph includes topology layout links', () => {
		const layoutLinks = {
			...graph,
			links: graph.links.filter(isTopologyLayoutLink)
		};
		const layout = buildIntentTopologyLayout(layoutLinks, policyFocus);
		expect(layout.nodes.filter((n) => n.data.role === 'dependent').length).toBeGreaterThan(3);
	});

	it('policys drops required-by when graph links are pre-filtered to isMapTopologyLink only', () => {
		const filtered = {
			...graph,
			links: graph.links.filter(isMapTopologyLink)
		};
		const layout = buildIntentTopologyLayout(filtered, policyFocus);
		expect(layout.nodes.filter((n) => n.data.role === 'dependent').length).toBe(0);
	});

	it('bgppeers.protocols.eda.nokia.com shows Policy prerequisite on release graph', () => {
		const layout = buildIntentTopologyLayout(graph, 'bgppeers.protocols.eda.nokia.com');
		const policy = layout.nodes.find((n) => n.data.kind === 'Policy');
		expect(policy).toBeDefined();
		expect(policy!.data.role).toBe('prerequisite');

		const focus = layout.nodes.find((n) => n.data.isFocus)!;
		expect(policy!.position.x).toBeGreaterThan(focus.position.x);

		const usesEdge = layout.edges.find(
			(e) =>
				e.source === 'bgppeers.protocols.eda.nokia.com' &&
				e.target === policyFocus
		);
		expect(usesEdge?.rel).toBe('appliesTo');
	});

	it('policys on release graph includes Router and Fabric consumers with full link set', () => {
		const layout = buildIntentTopologyLayout(graph, policyFocus);
		const depKinds = layout.nodes.filter((n) => n.data.role === 'dependent').map((n) => n.data.kind);
		expect(depKinds).toContain('Router');
		expect(depKinds).toContain('Fabric');
		expect(depKinds).toContain('VirtualNetwork');
		expect(depKinds).toContain('BGPGroup');
	});
});
