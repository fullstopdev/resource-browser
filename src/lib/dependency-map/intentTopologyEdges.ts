import { MarkerType, type Edge } from '@xyflow/svelte';
import type { ThemeMode } from '$lib/theme';
import { getGraphPalette, MAP_REL_ORDER } from './graphColors';
	import { NODE_HEIGHT, FOCUS_NODE_HEIGHT, type LayoutEdge, type LayoutNode } from './intentTopologyLayout';
import type { LinkRelation } from './types';

export type IntentTopologyEdgeData = {
	rel?: LinkRelation;
	color: string;
	highlighted?: boolean;
	pathHighlighted?: boolean;
	dimmed?: boolean;
};

const MARKER_SIZE = 13;

/** Relations present in layout edges, ordered for legend display. */
export function relationsInEdges(layoutEdges: LayoutEdge[]): LinkRelation[] {
	const seen = new Set<LinkRelation>();
	for (const edge of layoutEdges) {
		if (edge.rel) seen.add(edge.rel);
	}
	return MAP_REL_ORDER.filter((rel) => seen.has(rel));
}

/** Relations present in rendered flow edges, ordered for legend display. */
export function relationsInFlowEdges(flowEdges: Edge[]): LinkRelation[] {
	const seen = new Set<LinkRelation>();
	for (const edge of flowEdges) {
		const rel = (edge.data as IntentTopologyEdgeData | undefined)?.rel;
		if (rel) seen.add(rel);
	}
	return MAP_REL_ORDER.filter((rel) => seen.has(rel));
}

export function toFlowEdges(layoutEdges: LayoutEdge[], themeMode: ThemeMode): Edge[] {
	const palette = getGraphPalette(themeMode);

	return layoutEdges.map((edge) => {
		const rel = edge.rel;
		const color = rel ? (palette.rel[rel] ?? palette.link) : palette.link;
		const animated = rel === 'orchestrates' || rel === 'observes';

		return {
			id: edge.id,
			source: edge.source,
			target: edge.target,
			sourceHandle: edge.sourceHandle,
			targetHandle: edge.targetHandle,
			type: 'intentTopology',
			animated,
			selectable: false,
			zIndex: 1,
			data: { rel, color } satisfies IntentTopologyEdgeData,
			markerEnd: {
				type: MarkerType.ArrowClosed,
				color,
				width: MARKER_SIZE,
				height: MARKER_SIZE
			}
		};
	});
}

/** Align focus-node handles with peer Y positions so fan-in/out paths stay horizontal. */
export function attachFocusEdgePorts(
	nodes: LayoutNode[],
	edges: LayoutEdge[]
): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
	const focus = nodes.find((n) => n.data.isFocus);
	if (!focus) return { nodes, edges };

	const nodeById = new Map(nodes.map((n) => [n.id, n]));
	const focusNode = focus;
	const focusHeight = focusNode.height ?? FOCUS_NODE_HEIGHT;

	function portTop(peerId: string): number {
		const peer = nodeById.get(peerId);
		if (!peer) return focusHeight / 2;
		const peerHeight = peer.height ?? NODE_HEIGHT;
		const centerY = peer.position.y + peerHeight / 2 - focusNode.position.y;
		return Math.max(10, Math.min(focusHeight - 10, centerY));
	}

	const incomingPorts = edges
		.filter((e) => e.target === focus.id)
		.map((e) => ({ id: e.source, topPx: portTop(e.source) }));

	const outgoingPorts = edges
		.filter((e) => e.source === focus.id)
		.map((e) => ({ id: e.target, topPx: portTop(e.target) }));

	const nextNodes = nodes.map((n) =>
		n.id === focus.id
			? {
					...n,
					data: {
						...n.data,
						incomingPorts,
						outgoingPorts
					}
				}
			: n
	);

	const nextEdges = edges.map((e) => {
		if (e.target === focus.id) {
			return { ...e, targetHandle: `in-${e.source}` };
		}
		if (e.source === focus.id) {
			return { ...e, sourceHandle: `out-${e.target}` };
		}
		return e;
	});

	return { nodes: nextNodes, edges: nextEdges };
}
