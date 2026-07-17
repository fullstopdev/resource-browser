import type { SchemaGraph, SchemaGraphEdge } from './buildSchemaGraph';
import { orderLevelsByBarycenter } from './computeUnifiedGraphLayout';

export type SchemaGraphLayoutNode = {
	id: string;
	name: string;
	isRecursive: boolean;
	level: number;
	indexInLevel: number;
};

export type SchemaGraphLayoutEdge = {
	id: string;
	source: string;
	target: string;
	viaProperty: string;
	isBackEdge: boolean;
};

export type SchemaGraphLayout = {
	root: string;
	nodes: SchemaGraphLayoutNode[];
	edges: SchemaGraphLayoutEdge[];
};

function sortedOutgoing(edges: SchemaGraphEdge[]): Map<string, SchemaGraphEdge[]> {
	const outgoing = new Map<string, SchemaGraphEdge[]>();
	for (const e of edges) {
		const list = outgoing.get(e.source) ?? [];
		list.push(e);
		outgoing.set(e.source, list);
	}
	for (const [src, list] of outgoing.entries()) {
		list.sort(
			(a, b) =>
				a.target.localeCompare(b.target) || a.viaProperty.localeCompare(b.viaProperty)
		);
		outgoing.set(src, list);
	}
	return outgoing;
}

/**
 * Build a hierarchical subtree from `root`, following forward edges and recording
 * back-edges without expanding into already-visible nodes (no duplicate recursive nodes).
 */
export function computeSchemaGraphSubtree(
	graph: SchemaGraph,
	root: string
): { visibleNodes: Set<string>; visibleEdges: SchemaGraphEdge[] } {
	const outgoing = sortedOutgoing(graph.edges);
	const visibleNodes = new Set<string>([root]);
	const visibleEdges: SchemaGraphEdge[] = [];
	const visited = new Set<string>([root]);
	const queue = [root];

	while (queue.length > 0) {
		const source = queue.shift()!;
		for (const edge of outgoing.get(source) ?? []) {
			visibleEdges.push(edge);
			if (edge.isBackEdge) continue;
			if (visited.has(edge.target)) continue;
			visited.add(edge.target);
			visibleNodes.add(edge.target);
			queue.push(edge.target);
		}
	}

	visibleEdges.sort(
		(a, b) =>
			a.source.localeCompare(b.source) ||
			a.target.localeCompare(b.target) ||
			a.viaProperty.localeCompare(b.viaProperty)
	);

	return { visibleNodes, visibleEdges };
}

export function computeSchemaGraphLayout(graph: SchemaGraph, root: string): SchemaGraphLayout {
	const nodeByName = new Map(graph.nodes.map((n) => [n.name, n]));
	if (!nodeByName.has(root)) {
		return { root, nodes: [], edges: [] };
	}

	const { visibleNodes, visibleEdges } = computeSchemaGraphSubtree(graph, root);

	const dist = new Map<string, number>();
	dist.set(root, 0);
	const queue = [root];
	const outgoing = sortedOutgoing(visibleEdges);

	while (queue.length > 0) {
		const u = queue.shift()!;
		const base = dist.get(u)!;
		for (const e of outgoing.get(u) ?? []) {
			if (e.isBackEdge) continue;
			if (dist.has(e.target)) continue;
			dist.set(e.target, base + 1);
			queue.push(e.target);
		}
	}

	const levels = new Map<number, string[]>();
	for (const name of visibleNodes) {
		const level = dist.get(name) ?? 0;
		const bucket = levels.get(level) ?? [];
		bucket.push(name);
		levels.set(level, bucket);
	}

	const forwardPairs = visibleEdges
		.filter((e) => !e.isBackEdge)
		.map((e) => ({ source: e.source, target: e.target }));
	const orderedLevels = orderLevelsByBarycenter(levels, forwardPairs);

	const layoutNodes: SchemaGraphLayoutNode[] = [];
	for (const level of [...orderedLevels.keys()].sort((a, b) => a - b)) {
		const bucket = orderedLevels.get(level) ?? [];
		bucket.forEach((name, indexInLevel) => {
			const node = nodeByName.get(name)!;
			layoutNodes.push({
				id: name,
				name,
				isRecursive: node.isRecursive,
				level,
				indexInLevel
			});
		});
	}

	const layoutEdges: SchemaGraphLayoutEdge[] = visibleEdges.map((e) => ({
		id: `e:${e.source}->${e.target}@${e.viaProperty}`,
		source: e.source,
		target: e.target,
		viaProperty: e.viaProperty,
		isBackEdge: e.isBackEdge
	}));

	return { root, nodes: layoutNodes, edges: layoutEdges };
}

/**
 * Prefer the schema with the largest forward (non-back-edge) subtree.
 * Avoids hubs like ErrorResponse that are widely referenced but have no children.
 */
export function pickMostReferencedSchema(graph: SchemaGraph): string {
	const outgoing = sortedOutgoing(graph.edges);

	function forwardSize(root: string): number {
		const visited = new Set<string>([root]);
		const queue = [root];
		while (queue.length > 0) {
			const source = queue.shift()!;
			for (const edge of outgoing.get(source) ?? []) {
				if (edge.isBackEdge) continue;
				if (visited.has(edge.target)) continue;
				visited.add(edge.target);
				queue.push(edge.target);
			}
		}
		return visited.size;
	}

	function outgoingCount(root: string): number {
		return (outgoing.get(root) ?? []).filter((e) => !e.isBackEdge).length;
	}

	let best = '';
	let bestForward = -1;
	let bestOutgoing = -1;
	for (const n of graph.nodes) {
		const forward = forwardSize(n.name);
		const out = outgoingCount(n.name);
		if (
			forward > bestForward ||
			(forward === bestForward && out > bestOutgoing) ||
			(forward === bestForward && out === bestOutgoing && n.name.localeCompare(best) < 0)
		) {
			best = n.name;
			bestForward = forward;
			bestOutgoing = out;
		}
	}
	return best;
}
