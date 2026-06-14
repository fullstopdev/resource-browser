import { describe, expect, it } from 'vitest';
import {
	filterAggregateSiblingDeps,
	getDirectIntentNeighborIds,
	isRoutingPolicyAggregateMember
} from './intentFocusFilter';
import type { DependencyGraph } from './types';

const graph: DependencyGraph = {
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
			edgeClass: 'hardRef',
			edgeSource: 'explicit'
		},
		{
			id: 'p-ps',
			source: 'policys.routingpolicies.eda.nokia.com',
			target: 'prefixsets.routingpolicies.eda.nokia.com',
			rel: 'references',
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

describe('intentFocusFilter', () => {
	it('detects routing-policy aggregate members', () => {
		expect(isRoutingPolicyAggregateMember(graph.nodes[0])).toBe(true);
		expect(isRoutingPolicyAggregateMember(graph.nodes[3])).toBe(false);
	});

	it('returns direct intent neighbors', () => {
		const neighbors = getDirectIntentNeighborIds(
			'policys.routingpolicies.eda.nokia.com',
			graph.links
		);
		expect([...neighbors].sort()).toEqual([
			'aspathsets.routingpolicies.eda.nokia.com',
			'prefixsets.routingpolicies.eda.nokia.com',
			'routers.services.eda.nokia.com'
		]);
	});

	it('keeps depth-1 deps and drops transitive routing-policy siblings', () => {
		const deps = [
			{ id: 'policys.routingpolicies.eda.nokia.com', depth: 1, rel: 'references' as const },
			{ id: 'prefixsets.routingpolicies.eda.nokia.com', depth: 2, rel: 'references' as const },
			{ id: 'routers.services.eda.nokia.com', depth: 2, rel: 'references' as const }
		];

		const filtered = filterAggregateSiblingDeps(
			graph,
			'aspathsets.routingpolicies.eda.nokia.com',
			deps,
			graph.links
		);

		expect(filtered.map((d) => d.id)).toEqual([
			'policys.routingpolicies.eda.nokia.com',
			'routers.services.eda.nokia.com'
		]);
	});
});
