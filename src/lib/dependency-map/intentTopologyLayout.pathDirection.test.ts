import { describe, expect, it } from 'vitest';
import { buildIntentTopologyLayout } from './intentTopologyLayout';
import type { DependencyGraph } from './types';
import releaseGraph from '../../../static/resources/26.4.2/dependency-graph.json';

const graph = releaseGraph as DependencyGraph;
const policy = 'policys.routingpolicies.eda.nokia.com';
const cs = 'communitysets.routingpolicies.eda.nokia.com';
const deployment = 'defaultbgpgroupdeployments.protocols.eda.nokia.com';
const dbg = 'defaultbgpgroups.protocols.eda.nokia.com';

describe('path edge direction Policy ↔ CommunitySet', () => {
	it('Policy focus: edge flows Policy → CommunitySet (prerequisite on right)', () => {
		const layout = buildIntentTopologyLayout(graph, policy);
		expect(layout.edges.some((e) => e.source === policy && e.target === cs)).toBe(true);
		expect(layout.edges.some((e) => e.source === cs && e.target === policy)).toBe(false);

		const policyNode = layout.nodes.find((n) => n.id === policy)!;
		const csNode = layout.nodes.find((n) => n.id === cs)!;
		expect(csNode.data.role).toBe('prerequisite');
		expect(csNode.position.x).toBeGreaterThan(policyNode.position.x);
	});

	it('CommunitySet focus with drill path: edge flows Policy → CommunitySet', () => {
		const layout = buildIntentTopologyLayout(graph, cs, { pathNodeIds: [policy, cs] });
		expect(layout.edges.some((e) => e.source === policy && e.target === cs)).toBe(true);
		expect(layout.edges.some((e) => e.source === cs && e.target === policy)).toBe(false);

		const policyNode = layout.nodes.find((n) => n.id === policy)!;
		const csNode = layout.nodes.find((n) => n.id === cs)!;
		expect(policyNode.data.role).toBe('dependent');
		expect(policyNode.position.x).toBeLessThan(csNode.position.x);
	});

	it('multi-hop drill path keeps semantic direction for Policy → CommunitySet segment', () => {
		const path = [policy, dbg, deployment, cs];
		const layout = buildIntentTopologyLayout(graph, cs, { pathNodeIds: path });

		const policyToCs = layout.edges.filter(
			(e) => e.source === policy && e.target === cs
		);
		const csToPolicy = layout.edges.filter(
			(e) => e.source === cs && e.target === policy
		);
		expect(policyToCs.length).toBeGreaterThan(0);
		expect(csToPolicy.length).toBe(0);

		const policyNode = layout.nodes.find((n) => n.id === policy)!;
		const csNode = layout.nodes.find((n) => n.id === cs)!;
		expect(policyNode.position.x).toBeLessThan(csNode.position.x);
	});

	it('path segment Policy→DefaultBGPGroup highlights when both ends are in layout', () => {
		const layout = buildIntentTopologyLayout(graph, cs, {
			pathNodeIds: [policy, dbg, cs]
		});
		expect(layout.edges.some((e) => e.source === policy && e.target === cs)).toBe(true);
		expect(layout.edges.some((e) => e.source === dbg && e.target === policy)).toBe(true);
		expect(layout.nodes.find((n) => n.id === dbg)).toBeDefined();
		expect(layout.nodes.every((n) => n.position.x >= 0)).toBe(true);
	});

	it('3-level drill path shows CommunitySet on-screen when focus is DefaultBGPPeer', () => {
		const dbgPeer = 'defaultbgppeers.protocols.eda.nokia.com';
		const layout = buildIntentTopologyLayout(graph, dbgPeer, {
			pathNodeIds: [cs, policy, dbgPeer]
		});

		const csNode = layout.nodes.find((n) => n.id === cs);
		const policyNode = layout.nodes.find((n) => n.id === policy)!;
		const dbgNode = layout.nodes.find((n) => n.id === dbgPeer)!;

		expect(csNode).toBeDefined();
		expect(csNode!.position.x).toBeGreaterThanOrEqual(0);
		expect(csNode!.data.pathInBreadcrumb).toBe(true);
		expect(layout.nodes.every((n) => n.position.x >= 0)).toBe(true);

		expect(layout.edges.some((e) => e.source === policy && e.target === cs)).toBe(true);
		expect(layout.edges.some((e) => e.source === dbgPeer && e.target === policy)).toBe(true);

		expect(csNode!.position.x).toBeGreaterThan(policyNode.position.x);
		expect(policyNode.position.x).toBeGreaterThan(dbgNode.position.x);
	});

	it('3-level drill path shows CommunitySet on-screen when focus is DefaultBGPGroup', () => {
		const layout = buildIntentTopologyLayout(graph, dbg, {
			pathNodeIds: [cs, policy, dbg]
		});

		const csNode = layout.nodes.find((n) => n.id === cs);
		expect(csNode).toBeDefined();
		expect(csNode!.position.x).toBeGreaterThanOrEqual(0);
		expect(layout.nodes.every((n) => n.position.x >= 0)).toBe(true);
		expect(layout.edges.some((e) => e.source === policy && e.target === cs)).toBe(true);
	});

	it('invalid path with nodes after focus does not inject trailing ancestors', () => {
		const bgpPeer = 'bgppeers.protocols.eda.nokia.com';
		const layout = buildIntentTopologyLayout(graph, bgpPeer, {
			pathNodeIds: [policy, bgpPeer, cs]
		});
		expect(layout.nodes.every((n) => n.position.x >= 0)).toBe(true);
		expect(layout.nodes.find((n) => n.id === cs)).toBeUndefined();
		expect(layout.edges.some((e) => e.source === policy && e.target === cs)).toBe(false);
	});
});
