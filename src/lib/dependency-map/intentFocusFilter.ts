import { linkEndpointId } from './transitiveClosure';
import type { TransitiveDepEntry } from './transitiveClosure';
import type { DependencyGraph, GraphLink, GraphNode } from './types';

/** Routing-policy sub-CRDs that share an API group but are not always intent deps of each other. */
const ROUTING_POLICY_MEMBER_KINDS = new Set([
	'ASPathSet',
	'CommunitySet',
	'PrefixSet',
	'TagSet',
	'ASPathSetDeployment',
	'CommunitySetDeployment',
	'PrefixSetDeployment',
	'TagSetDeployment',
	'Policy',
	'PolicyDeployment'
]);

export function getDirectIntentNeighborIds(focusId: string, links: GraphLink[]): Set<string> {
	const neighbors = new Set<string>();
	for (const link of links) {
		const source = linkEndpointId(link.source as string);
		const target = linkEndpointId(link.target as string);
		if (source === focusId) neighbors.add(target);
		if (target === focusId) neighbors.add(source);
	}
	return neighbors;
}

export function isRoutingPolicyAggregateMember(node: GraphNode | undefined): boolean {
	if (!node) return false;
	return node.group === 'routingpolicies.eda.nokia.com' && ROUTING_POLICY_MEMBER_KINDS.has(node.kind);
}

/** Config *Set CRDs (not *SetDeployment) in routingpolicies.eda.nokia.com. */
export function isRoutingPolicySetKind(kind: string): boolean {
	return (
		ROUTING_POLICY_MEMBER_KINDS.has(kind) &&
		kind.endsWith('Set') &&
		!kind.endsWith('Deployment')
	);
}

/**
 * When drilling into a routing-policy child, hide sibling set/deployment CRDs that only
 * appear through multi-hop paths (e.g. extended mode via a shared Policy hub).
 * Direct depth-1 intent edges are always kept.
 */
export function filterAggregateSiblingDeps(
	graph: DependencyGraph,
	focusId: string,
	deps: TransitiveDepEntry[],
	links: GraphLink[]
): TransitiveDepEntry[] {
	const focusNode = graph.nodes.find((n) => n.id === focusId);
	if (!isRoutingPolicyAggregateMember(focusNode)) return deps;

	const directNeighbors = getDirectIntentNeighborIds(focusId, links);

	return deps.filter((dep) => {
		if (dep.depth === 1) return true;
		const candidate = graph.nodes.find((n) => n.id === dep.id);
		if (!isRoutingPolicyAggregateMember(candidate)) return true;
		return directNeighbors.has(dep.id);
	});
}
