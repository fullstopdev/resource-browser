import type { Edge, Node } from '@xyflow/svelte';
import { breadcrumbSegmentPairs, edgeConnectsPair } from './drillDown';
import type { IntentTopologyEdgeData } from './intentTopologyEdges';
import type { IntentTopologyNodeData } from './intentTopologyLayout';

export function isPathSegmentEdge(
	source: string,
	target: string,
	pathNodeIds: string[]
): boolean {
	if (pathNodeIds.length < 2) return false;
	return breadcrumbSegmentPairs(pathNodeIds).some(({ from, to }) =>
		edgeConnectsPair(source, target, from, to)
	);
}

export function applyPathHighlightToFlow(
	nodes: Node[],
	edges: Edge[],
	pathNodeIds: string[],
	selectedNodeId: string | null
): { nodes: Node[]; edges: Edge[] } {
	const hasPath = pathNodeIds.length >= 2;
	const pathSet = new Set(pathNodeIds);

	const nextEdges = edges.map((e) => {
		const data = (e.data ?? {}) as IntentTopologyEdgeData;
		const pathHighlighted = hasPath && isPathSegmentEdge(e.source, e.target, pathNodeIds);
		const connected = Boolean(
			selectedNodeId && (e.source === selectedNodeId || e.target === selectedNodeId)
		);
		const highlighted = connected && !pathHighlighted;
		const dimmed = hasPath && !pathHighlighted && !connected;

		return {
			...e,
			zIndex: pathHighlighted ? 4 : connected ? 2 : 1,
			data: { ...data, pathHighlighted, highlighted, dimmed }
		};
	});

	const nextNodes = nodes.map((n) => {
		const data = n.data as IntentTopologyNodeData;
		const pathInBreadcrumb = hasPath && pathSet.has(n.id);
		return {
			...n,
			data: { ...data, pathInBreadcrumb }
		};
	});

	return { nodes: nextNodes, edges: nextEdges };
}

export function flowHighlightsInSync(
	nodes: Node[],
	edges: Edge[],
	pathNodeIds: string[],
	selectedNodeId: string | null
): boolean {
	const hasPath = pathNodeIds.length >= 2;
	const pathSet = new Set(pathNodeIds);

	for (const n of nodes) {
		const data = n.data as IntentTopologyNodeData;
		const expectedPath = hasPath && pathSet.has(n.id);
		if (Boolean(data.pathInBreadcrumb) !== expectedPath) return false;
		if (Boolean(n.selected) !== (n.id === selectedNodeId)) return false;
	}

	for (const e of edges) {
		const data = (e.data ?? {}) as IntentTopologyEdgeData;
		const pathHighlighted = hasPath && isPathSegmentEdge(e.source, e.target, pathNodeIds);
		const connected = Boolean(
			selectedNodeId && (e.source === selectedNodeId || e.target === selectedNodeId)
		);
		const highlighted = connected && !pathHighlighted;
		const dimmed = hasPath && !pathHighlighted && !connected;

		if (Boolean(data.pathHighlighted) !== pathHighlighted) return false;
		if (Boolean(data.highlighted) !== highlighted) return false;
		if (Boolean(data.dimmed) !== dimmed) return false;
	}

	return true;
}
