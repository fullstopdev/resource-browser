import { linkEndpointId } from './transitiveClosure';
import type { ConfidenceTier, DependencyGraph, EdgeSource, GraphLink, GraphNode } from './types';

const EXPLICIT_EDGE_SOURCES = new Set<EdgeSource>(['catalog', 'explicit']);

/** When strict mode is on, hide tier-3 description-only inference. Default view shows tiers 1–3. */
export const DEFAULT_MAX_CONFIDENCE_TIER: ConfidenceTier = 2;

export function tierFromEdgeSource(edgeSource: EdgeSource | undefined, tier?: ConfidenceTier): ConfidenceTier {
	if (tier !== undefined) return tier;
	if (edgeSource === 'catalog') return 1;
	if (edgeSource === 'explicit' || edgeSource === 'semantic') return 2;
	return 3;
}

export function linkConfidenceTier(link: GraphLink): ConfidenceTier {
	return tierFromEdgeSource(link.edgeSource, link.confidenceTier);
}

/** All tiers by default; strict mode (showWeakInferences=false) keeps tier 1–2 only. */
export function applyIntentTierFilter(
	links: GraphLink[],
	showWeakInferences: boolean
): GraphLink[] {
	if (showWeakInferences !== false) return links;
	return links.filter((link) => linkConfidenceTier(link) <= DEFAULT_MAX_CONFIDENCE_TIER);
}

/** @deprecated Prefer applyIntentTierFilter — kept for compatibility with edgeSource-only callers. */
export function applyEdgeSourceFilter(
	links: GraphLink[],
	showInferredEdges: boolean
): GraphLink[] {
	return applyIntentTierFilter(links, showInferredEdges);
}

export type DirectionFilter = {
	showDependsOn: boolean;
	showRequiredBy: boolean;
};

/** Filter graph to focus-incident edges in the selected directions (star topology). */
export function applyDirectionFilter(
	nodes: GraphNode[],
	links: GraphLink[],
	focusId: string | null,
	filter: DirectionFilter
): { nodes: GraphNode[]; links: GraphLink[] } {
	if (!focusId || (filter.showDependsOn && filter.showRequiredBy)) {
		return { nodes, links };
	}

	const dirLinks = links.filter((link) => {
		const source = linkEndpointId(link.source);
		const target = linkEndpointId(link.target);
		if (filter.showDependsOn && source === focusId) return true;
		if (filter.showRequiredBy && target === focusId) return true;
		return false;
	});

	const nodeIds = new Set<string>([focusId]);
	for (const link of dirLinks) {
		nodeIds.add(linkEndpointId(link.source));
		nodeIds.add(linkEndpointId(link.target));
	}

	return {
		nodes: nodes.filter((n) => nodeIds.has(n.id)),
		links: dirLinks
	};
}

export function filterGraphByDirection(
	graph: DependencyGraph,
	focusId: string | null,
	filter: DirectionFilter
): DependencyGraph {
	const { nodes, links } = applyDirectionFilter(graph.nodes, graph.links, focusId, filter);
	return { ...graph, nodes, links };
}

export function filterGraphByEdgeSource(
	graph: DependencyGraph,
	showInferredEdges: boolean
): DependencyGraph {
	const links = applyEdgeSourceFilter(graph.links, showInferredEdges);
	const linkedIds = new Set<string>();
	for (const link of links) {
		linkedIds.add(linkEndpointId(link.source));
		linkedIds.add(linkEndpointId(link.target));
	}
	return {
		...graph,
		nodes: graph.nodes.filter((n) => linkedIds.has(n.id)),
		links
	};
}

/** One-hop neighbors of the focus node (direct dependencies in either direction). */
export function getDirectNeighborIds(focusId: string | null, links: GraphLink[]): Set<string> {
	if (!focusId) return new Set();
	const neighbors = new Set<string>();
	for (const link of links) {
		const source = linkEndpointId(link.source);
		const target = linkEndpointId(link.target);
		if (source === focusId) neighbors.add(target);
		if (target === focusId) neighbors.add(source);
	}
	return neighbors;
}
