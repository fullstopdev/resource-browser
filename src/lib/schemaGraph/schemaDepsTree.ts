import type { UnifiedApiGraph, UnifiedGraphEdge } from './unifiedApiGraph';
import { schemaNameFromNodeId } from './unifiedApiGraph';

/** Hierarchical $ref tree for Schema Graph (markmap-style outline). */
export type SchemaDepsTreeNode = {
	schemaName: string;
	viaProperty: string;
	isBackEdge: boolean;
	isRecursive: boolean;
	children: SchemaDepsTreeNode[];
};

export type SchemaDepsTree = {
	root: string;
	nodeCount: number;
	edgeCount: number;
	tree: SchemaDepsTreeNode | null;
};

function sortedOutgoingRefs(edges: UnifiedGraphEdge[]): Map<string, UnifiedGraphEdge[]> {
	const outgoing = new Map<string, UnifiedGraphEdge[]>();
	for (const e of edges) {
		if (e.kind !== 'schema-ref') continue;
		const list = outgoing.get(e.source) ?? [];
		list.push(e);
		outgoing.set(e.source, list);
	}
	for (const [src, list] of outgoing.entries()) {
		list.sort(
			(a, b) =>
				(a.viaProperty ?? '').localeCompare(b.viaProperty ?? '') ||
				a.target.localeCompare(b.target)
		);
		outgoing.set(src, list);
	}
	return outgoing;
}

/**
 * Build a deterministic forward $ref tree from `rootSchemaName`.
 * Back-edges are kept as leaf markers (no further expansion) so cycles stay accurate.
 */
export function buildSchemaDepsTree(
	graph: UnifiedApiGraph,
	rootSchemaName: string,
	showAllSchemas = false
): SchemaDepsTree {
	const rootId = `schema:${rootSchemaName}`;
	const rootNode = graph.nodes.find((n) => n.id === rootId);
	if (!rootNode) {
		return { root: rootSchemaName, nodeCount: 0, edgeCount: 0, tree: null };
	}

	const schemaRefEdges = graph.edges.filter((e) => e.kind === 'schema-ref');
	const outgoing = sortedOutgoingRefs(
		showAllSchemas
			? schemaRefEdges
			: (() => {
					// Limit to forward-reachable subgraph for accurate local trees.
					const visible = new Set<string>([rootId]);
					const queue = [rootId];
					const filtered: UnifiedGraphEdge[] = [];
					const outAll = sortedOutgoingRefs(schemaRefEdges);
					while (queue.length > 0) {
						const source = queue.shift()!;
						for (const edge of outAll.get(source) ?? []) {
							filtered.push(edge);
							if (edge.isBackEdge) continue;
							if (visible.has(edge.target)) continue;
							visible.add(edge.target);
							queue.push(edge.target);
						}
					}
					return filtered;
				})()
	);

	const nodeMeta = new Map(
		graph.nodes
			.filter((n) => n.kind === 'schema')
			.map((n) => [n.id, n] as const)
	);

	let nodeCount = 0;
	let edgeCount = 0;

	function walk(schemaId: string, chain: Set<string>): SchemaDepsTreeNode {
		const name = schemaNameFromNodeId(schemaId) ?? schemaId;
		const meta = nodeMeta.get(schemaId);
		nodeCount += 1;
		const children: SchemaDepsTreeNode[] = [];

		for (const edge of outgoing.get(schemaId) ?? []) {
			edgeCount += 1;
			const targetName = schemaNameFromNodeId(edge.target) ?? edge.target;
			const targetMeta = nodeMeta.get(edge.target);
			if (edge.isBackEdge || chain.has(edge.target)) {
				children.push({
					schemaName: targetName,
					viaProperty: edge.viaProperty ?? '',
					isBackEdge: true,
					isRecursive: true,
					children: []
				});
				continue;
			}
			const nextChain = new Set(chain);
			nextChain.add(schemaId);
			const child = walk(edge.target, nextChain);
			children.push({
				...child,
				viaProperty: edge.viaProperty ?? '',
				isBackEdge: false,
				isRecursive: targetMeta?.isRecursive ?? child.isRecursive
			});
		}

		return {
			schemaName: name,
			viaProperty: '',
			isBackEdge: false,
			isRecursive: meta?.isRecursive ?? false,
			children
		};
	}

	const tree = walk(rootId, new Set());

	// show-all: append orphan schemas (no path from root) as sibling roots under a synthetic note
	if (showAllSchemas) {
		const seen = new Set<string>();
		const collect = (n: SchemaDepsTreeNode) => {
			seen.add(n.schemaName);
			for (const c of n.children) collect(c);
		};
		collect(tree);
		const orphans = graph.nodes
			.filter((n) => n.kind === 'schema')
			.map((n) => n.schemaName ?? schemaNameFromNodeId(n.id) ?? '')
			.filter((name) => name && !seen.has(name))
			.sort((a, b) => a.localeCompare(b));
		for (const name of orphans) {
			const orphanId = `schema:${name}`;
			if (!nodeMeta.has(orphanId)) continue;
			tree.children.push(walk(orphanId, new Set()));
		}
	}

	return { root: rootSchemaName, nodeCount, edgeCount, tree };
}

/** Flatten tree depth-first for search / keyboard nav. */
export function flattenSchemaDepsTree(
	tree: SchemaDepsTreeNode | null
): Array<{ schemaName: string; depth: number; viaProperty: string; isBackEdge: boolean }> {
	const out: Array<{
		schemaName: string;
		depth: number;
		viaProperty: string;
		isBackEdge: boolean;
	}> = [];
	function visit(node: SchemaDepsTreeNode, depth: number) {
		out.push({
			schemaName: node.schemaName,
			depth,
			viaProperty: node.viaProperty,
			isBackEdge: node.isBackEdge
		});
		for (const child of node.children) visit(child, depth + 1);
	}
	if (tree) visit(tree, 0);
	return out;
}
