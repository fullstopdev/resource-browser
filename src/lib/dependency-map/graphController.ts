import {
	drag,
	forceCenter,
	forceCollide,
	forceLink,
	forceManyBody,
	forceSimulation,
	select,
	zoom,
	zoomIdentity,
	type Simulation,
	type SimulationLinkDatum,
	type SimulationNodeDatum,
	type ZoomBehavior
} from 'd3';
import { escapeHtml } from '$lib/comparison/highlight';
import { getGraphPalette, nodeFill, nodeFillLight, REL_LABELS } from './graphColors';
import { getDirectNeighborIds, linkConfidenceTier } from './graphFilters';
import type { GraphLink, GraphNode, LinkRelation } from './types';
import { getHighlightSets, type ChainMode } from './transitiveClosure';

type SimNode = GraphNode &
	SimulationNodeDatum & {
		upstreamDepth?: number | null;
		downstreamDepth?: number | null;
	};
type SimLink = Omit<GraphLink, 'source' | 'target'> &
	SimulationLinkDatum<SimNode> & {
		source: SimNode | string;
		target: SimNode | string;
	};

const FOCUS_RADIUS = 30;
const NODE_RADIUS = 16;
const STATE_RADIUS = 13;
const RING_GAP = 168;
const INNER_RING = 148;
const NODE_SEPARATION = 72;
const LABEL_MAX_CHARS = 18;
const DENSE_LABEL_THRESHOLD = 10;
const CANVAS_MIN_HEIGHT = 400;
/** Viewport padding when fitting zoom/pan to visible graph content. */
const FIT_PADDING = 40;
const CONTENT_PADDING_X = 110;
const CONTENT_PADDING_TOP = 120;
const CONTENT_PADDING_BOTTOM = 100;
/** Gap from node bottom edge to label pill top (local coords). */
const LABEL_OFFSET = 12;

export type GraphControllerOptions = {
	container: HTMLDivElement;
	svg: SVGSVGElement;
	tooltip: HTMLDivElement;
	getFilteredNodes: () => GraphNode[];
	getFilteredLinks: () => GraphLink[];
	radialLayout: boolean;
	theme: 'light' | 'dark';
	onSelect: (id: string | null) => void;
	onRefocus?: (id: string) => void;
	getSelectedId: () => string | null;
	getChainMode: () => ChainMode;
	getCenterNodeId?: () => string | null;
	getShowAllLabels?: () => boolean;
	onLayoutReady?: () => void;
};

export type GraphController = {
	rebuild: () => void;
	updateTheme: (theme: 'light' | 'dark') => void;
	updateHighlight: () => void;
	focusNode: (id: string) => void;
	fitToScreen: (animate?: boolean) => void;
	showFullExtent: () => void;
	reflowLayout: () => void;
	zoomIn: () => void;
	zoomOut: () => void;
	setRadial: (radial: boolean) => void;
	destroy: () => void;
};

function truncateLabel(text: string, max = LABEL_MAX_CHARS): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max - 1).trim()}…`;
}

function linkTooltipHtml(link: SimLink): string {
	const relLabel = REL_LABELS[link.rel] ?? link.rel;
	const paths =
		link.fieldPaths && link.fieldPaths.length > 0
			? link.fieldPaths
			: link.field
				? [link.field]
				: [];
	const refCount = link.refCount ?? (paths.length > 1 ? paths.length : 0);

	let html = `<strong>${escapeHtml(relLabel)}</strong>`;
	if (refCount > 1) {
		html += `<br/><span style="opacity:0.8">${refCount} references</span>`;
	}
	if (link.relations && link.relations.length > 1) {
		const relNames = link.relations.map((rel) => REL_LABELS[rel] ?? rel).join(', ');
		html += `<br/><span style="opacity:0.75">${escapeHtml(relNames)}</span>`;
	}
	if (paths.length > 0) {
		const shown = paths.slice(0, 6);
		html += `<br/><span style="opacity:0.7;font-size:0.9em">${shown.map((path) => escapeHtml(path)).join('<br/>')}</span>`;
		if (paths.length > shown.length) {
			html += `<br/><span style="opacity:0.65;font-size:0.85em">+${paths.length - shown.length} more</span>`;
		}
	}
	return html;
}

function endpointId(endpoint: SimNode | string): string {
	return typeof endpoint === 'object' ? endpoint.id : endpoint;
}

function buildAdjacency(links: SimLink[]) {
	const incoming = new Map<string, string[]>();
	const outgoing = new Map<string, string[]>();
	for (const link of links) {
		const s = endpointId(link.source);
		const t = endpointId(link.target);
		(outgoing.get(s) ?? outgoing.set(s, []).get(s)!).push(t);
		(incoming.get(t) ?? incoming.set(t, []).get(t)!).push(s);
	}
	return { incoming, outgoing };
}

function bfsDepth(startId: string, adjacency: Map<string, string[]>): Map<string, number> {
	const depths = new Map<string, number>();
	const queue = [startId];
	depths.set(startId, 0);
	while (queue.length > 0) {
		const current = queue.shift()!;
		const depth = depths.get(current)!;
		for (const next of adjacency.get(current) ?? []) {
			if (depths.has(next)) continue;
			depths.set(next, depth + 1);
			queue.push(next);
		}
	}
	depths.delete(startId);
	return depths;
}

function separationForCount(count: number): number {
	if (count > 48) return 108;
	if (count > 36) return 96;
	if (count > 24) return 86;
	if (count > 16) return 78;
	return NODE_SEPARATION;
}

function ringGapForCount(nodeCount: number): number {
	if (nodeCount > 40) return RING_GAP + 36;
	if (nodeCount > 24) return RING_GAP + 20;
	return RING_GAP;
}

function placeArc(
	ids: string[],
	cx: number,
	cy: number,
	radius: number,
	startAngle: number,
	endAngle: number,
	positions: Map<string, { x: number; y: number }>
) {
	if (ids.length === 0) return;
	const separation = separationForCount(ids.length);
	const safeRadius = Math.max(radius, separation * 1.1);
	const minAngle = 2 * Math.asin(Math.min(1, separation / (2 * safeRadius)));
	const neededSpan = minAngle * Math.max(ids.length - 1, 1);
	let arcStart = startAngle;
	let arcEnd = endAngle;
	const baseSpan = arcEnd - arcStart;
	if (neededSpan > baseSpan) {
		const mid = (startAngle + endAngle) / 2;
		arcStart = mid - neededSpan / 2;
		arcEnd = mid + neededSpan / 2;
	}
	const span = arcEnd - arcStart;
	ids.forEach((id, i) => {
		const t = ids.length === 1 ? 0.5 : (i + 1) / (ids.length + 1);
		const angle = arcStart + span * t;
		positions.set(id, {
			x: cx + safeRadius * Math.cos(angle),
			y: cy + safeRadius * Math.sin(angle)
		});
	});
}

function maxRingDepth(
	upstreamByRing: Map<number, string[]>,
	downstreamByRing: Map<number, string[]>,
	bridgeByRing: Map<number, string[]>
): number {
	const depths = [
		...upstreamByRing.keys(),
		...downstreamByRing.keys(),
		...bridgeByRing.keys()
	];
	return depths.length > 0 ? Math.max(...depths) : 1;
}

function computeRadialPositions(
	nodes: SimNode[],
	links: SimLink[],
	centerId: string | null,
	width: number,
	height: number
): Map<string, { x: number; y: number }> {
	const cx = width / 2;
	const cy = height / 2;
	const positions = new Map<string, { x: number; y: number }>();

	if (!centerId || nodes.length === 0) {
		const radius = Math.max(INNER_RING, Math.min(width, height) * 0.38);
		placeArc(
			nodes.map((n) => n.id),
			cx,
			cy,
			radius,
			-Math.PI * 0.85,
			Math.PI * 0.85,
			positions
		);
		return positions;
	}

	positions.set(centerId, { x: cx, y: cy });
	const neighborCount = nodes.length - 1;
	const innerRing = Math.max(INNER_RING, 112 + neighborCount * 3.6);
	assignFocusDepths(nodes, links, centerId);

	const upstreamByRing = new Map<number, string[]>();
	const downstreamByRing = new Map<number, string[]>();
	const bridgeByRing = new Map<number, string[]>();
	const orphan: string[] = [];

	for (const node of nodes) {
		if (node.id === centerId) continue;
		const ud = node.upstreamDepth ?? undefined;
		const dd = node.downstreamDepth ?? undefined;

		if (ud !== undefined && dd !== undefined) {
			const depth = Math.max(ud, dd);
			bridgeByRing.set(depth, [...(bridgeByRing.get(depth) ?? []), node.id]);
		} else if (ud !== undefined) {
			upstreamByRing.set(ud, [...(upstreamByRing.get(ud) ?? []), node.id]);
		} else if (dd !== undefined) {
			downstreamByRing.set(dd, [...(downstreamByRing.get(dd) ?? []), node.id]);
		} else {
			orphan.push(node.id);
		}
	}

	const ringGap = ringGapForCount(nodes.length);

	for (const [depth, ids] of upstreamByRing) {
		const radius = innerRing + (depth - 1) * ringGap;
		placeArc(ids, cx, cy, radius, Math.PI * 0.55, Math.PI * 1.45, positions);
	}

	for (const [depth, ids] of downstreamByRing) {
		const radius = innerRing + (depth - 1) * ringGap;
		placeArc(ids, cx, cy, radius, -Math.PI * 0.45, Math.PI * 0.45, positions);
	}

	for (const [depth, ids] of bridgeByRing) {
		const radius = innerRing + (depth - 1) * ringGap + ringGap * 0.4;
		const top = ids.filter((_, i) => i % 2 === 0);
		const bottom = ids.filter((_, i) => i % 2 === 1);
		placeArc(top, cx, cy, radius, -Math.PI * 0.22, Math.PI * 0.22, positions);
		placeArc(bottom, cx, cy, radius, Math.PI * 0.78, Math.PI * 1.22, positions);
	}

	if (orphan.length > 0) {
		const maxDepth = maxRingDepth(upstreamByRing, downstreamByRing, bridgeByRing);
		const radius = innerRing + maxDepth * ringGap + ringGap * 0.65;
		placeArc(orphan, cx, cy, radius, -Math.PI * 0.9, Math.PI * 0.9, positions);
	}

	return positions;
}

function nodeRadius(d: SimNode, centerId: string | null): number {
	if (centerId && d.id === centerId) return FOCUS_RADIUS;
	return d.type === 'state' ? STATE_RADIUS : NODE_RADIUS;
}

type Point = { x: number; y: number };

function nodeCenter(node: SimNode): Point {
	return { x: node.x ?? 0, y: node.y ?? 0 };
}

function computeLinkAttachments(
	nodes: SimNode[],
	links: SimLink[],
	centerId: string | null
): Map<string, { start: Point; end: Point }> {
	const nodeById = new Map(nodes.map((n) => [n.id, n]));
	const byNode = new Map<string, Array<{ linkId: string; peerId: string; isSource: boolean }>>();

	for (const link of links) {
		const sId = endpointId(link.source);
		const tId = endpointId(link.target);
		const sList = byNode.get(sId) ?? [];
		sList.push({ linkId: link.id, peerId: tId, isSource: true });
		byNode.set(sId, sList);
		const tList = byNode.get(tId) ?? [];
		tList.push({ linkId: link.id, peerId: sId, isSource: false });
		byNode.set(tId, tList);
	}

	const attachments = new Map<string, { start: Point; end: Point }>();
	const portByNodeLink = new Map<string, Point>();

	for (const [nodeId, incidents] of byNode) {
		const node = nodeById.get(nodeId);
		if (!node) continue;
		const { x: cx, y: cy } = nodeCenter(node);
		const r = nodeRadius(node, centerId) + 4;
		const withAngles = incidents
			.map((inc) => {
				const peer = nodeById.get(inc.peerId);
				const px = peer?.x ?? cx;
				const py = peer?.y ?? cy;
				return { ...inc, angle: Math.atan2(py - cy, px - cx) };
			})
			.sort((a, b) => a.angle - b.angle);

		const spread = Math.min(Math.PI / 2.4, Math.max(0.16, withAngles.length * 0.13));
		withAngles.forEach((inc, i) => {
			const t = withAngles.length === 1 ? 0.5 : i / (withAngles.length - 1);
			const offset = (t - 0.5) * spread;
			const angle = inc.angle + offset;
			portByNodeLink.set(
				`${nodeId}|${inc.linkId}`,
				{ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
			);
		});
	}

	for (const link of links) {
		const sId = endpointId(link.source);
		const tId = endpointId(link.target);
		const start = portByNodeLink.get(`${sId}|${link.id}`);
		const end = portByNodeLink.get(`${tId}|${link.id}`);
		if (start && end) attachments.set(link.id, { start, end });
	}

	return attachments;
}

function linkPathBetween(start: Point, end: Point): string {
	return `M${start.x},${start.y} L${end.x},${end.y}`;
}

/** Label anchor in node-local coordinates (node group is translated to node.x/y). */
function labelPlacement(
	node: SimNode,
	centerId: string | null
): { labelX: number; labelY: number } {
	const r = nodeRadius(node, centerId);
	return { labelX: 0, labelY: r + LABEL_OFFSET };
}

function minHopDepthFromFocus(d: SimNode, centerId: string | null): number {
	if (!centerId || d.id === centerId) return 0;
	const hops: number[] = [];
	if (d.upstreamDepth != null) hops.push(d.upstreamDepth);
	if (d.downstreamDepth != null) hops.push(d.downstreamDepth);
	return hops.length > 0 ? Math.min(...hops) : Number.POSITIVE_INFINITY;
}

function isDirectNeighborOfFocus(d: SimNode, centerId: string | null): boolean {
	return minHopDepthFromFocus(d, centerId) === 1;
}

function assignFocusDepths(nodes: SimNode[], links: SimLink[], centerId: string | null) {
	if (!centerId) {
		for (const node of nodes) {
			node.upstreamDepth = null;
			node.downstreamDepth = null;
		}
		return;
	}
	const { incoming, outgoing } = buildAdjacency(links);
	const upDepth = bfsDepth(centerId, incoming);
	const downDepth = bfsDepth(centerId, outgoing);
	for (const node of nodes) {
		if (node.id === centerId) {
			node.upstreamDepth = null;
			node.downstreamDepth = null;
			continue;
		}
		node.upstreamDepth = upDepth.get(node.id) ?? null;
		node.downstreamDepth = downDepth.get(node.id) ?? null;
	}
}

function countRels(nodeId: string, links: SimLink[]) {
	let inCount = 0;
	let outCount = 0;
	for (const link of links) {
		const s = endpointId(link.source);
		const t = endpointId(link.target);
		if (t === nodeId) inCount++;
		if (s === nodeId) outCount++;
	}
	return { inCount, outCount };
}

export function createGraphController(options: GraphControllerOptions): GraphController {
	let {
		container,
		svg,
		tooltip,
		onSelect,
		onRefocus,
		getSelectedId,
		getChainMode,
		getFilteredNodes,
		getFilteredLinks,
		getCenterNodeId
	} = options;
	let radialLayout = options.radialLayout;
	let theme = options.theme;

	let width = 800;
	let height = 600;
	let viewportWidth = 800;
	let viewportHeight = 600;
	let palette = getGraphPalette(theme);
	let simulation: Simulation<SimNode, SimLink> | null = null;
	let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let gRoot: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let linkSel: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let nodeSel: any = null;
	let simNodes: SimNode[] = [];
	let simLinks: SimLink[] = [];
	let hoveredLinkId: string | null = null;
	let hoveredNodeId: string | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let denseLabels = false;
	let directNeighborIds = new Set<string>();
	let linkAttachments = new Map<string, { start: Point; end: Point }>();
	let layoutGeneration = 0;

	function notifyLayoutReady(expectedGeneration?: number) {
		if (expectedGeneration !== undefined && expectedGeneration !== layoutGeneration) return;
		options.onLayoutReady?.();
	}

	function relColor(rel: LinkRelation): string {
		return palette.rel[rel] ?? palette.link;
	}

	function linkDirectionColor(d: SimLink, centerId: string | null): string {
		if (!centerId) return relColor(d.rel);
		const s = endpointId(d.source);
		const t = endpointId(d.target);
		if (s === centerId) return palette.linkOut;
		if (t === centerId) return palette.linkIn;
		return relColor(d.rel);
	}

	function isFocusIncidentEdge(d: SimLink, centerId: string | null): boolean {
		if (!centerId) return false;
		const s = endpointId(d.source);
		const t = endpointId(d.target);
		return s === centerId || t === centerId;
	}

	function linkStrokeOpacity(d: SimLink, centerId: string | null, highlight: ReturnType<typeof getHighlightSets> | null): number {
		if (hoveredLinkId === d.id) return 1;
		const focusEdge = isFocusIncidentEdge(d, centerId);
		if (focusEdge) return 0.92;
		if (getChainMode() === 'extended' && linkConfidenceTier(d) === 3) return 0.08;
		if (!highlight) return 0.5;
		const s = endpointId(d.source);
		const t = endpointId(d.target);
		return highlight.isHighlightedEdge(s, t) ? 0.82 : 0.1;
	}

	function linkStrokeWidth(d: SimLink, highlight: ReturnType<typeof getHighlightSets> | null, centerId: string | null): number {
		if (hoveredLinkId === d.id) return 2.5;
		if (isFocusIncidentEdge(d, centerId)) return 2.15;
		if (!highlight) return 1.3;
		const s = endpointId(d.source);
		const t = endpointId(d.target);
		return highlight.isHighlightedEdge(s, t) ? 1.9 : 0.75;
	}

	function labelOpacity(d: SimNode, centerId: string | null, selectedId: string | null): number {
		if (getChainMode() === 'direct') return 1;
		if (options.getShowAllLabels?.()) return 1;
		if (hoveredNodeId === d.id) return 1;
		if (selectedId === d.id) return 1;
		if (!denseLabels) return 1;
		if (centerId && d.id === centerId) return 1;
		if (centerId && (directNeighborIds.has(d.id) || isDirectNeighborOfFocus(d, centerId))) {
			return 1;
		}
		return 0;
	}

	function expandBounds(
		minX: number,
		maxX: number,
		minY: number,
		maxY: number,
		x0: number,
		y0: number,
		x1: number,
		y1: number
	) {
		return {
			minX: Math.min(minX, x0),
			maxX: Math.max(maxX, x1),
			minY: Math.min(minY, y0),
			maxY: Math.max(maxY, y1)
		};
	}

	function getNodeBounds() {
		if (simNodes.length === 0) return null;
		const centerId = getCenterNodeId?.() ?? null;
		const selectedId = getSelectedId();
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;

		for (const n of simNodes) {
			const x = n.x ?? 0;
			const y = n.y ?? 0;
			const r = nodeRadius(n, centerId) + 6;
			({ minX, maxX, minY, maxY } = expandBounds(minX, maxX, minY, maxY, x - r, y - r, x + r, y + r));

			if (nodeSel && labelOpacity(n, centerId, selectedId) > 0) {
				const labelGroup = nodeSel
					.filter((d: SimNode) => d.id === n.id)
					.select('.dep-node-label-group')
					.node() as SVGGElement | null;
				if (labelGroup) {
					const bbox = labelGroup.getBBox();
					if (bbox.width > 0 && bbox.height > 0) {
						({ minX, maxX, minY, maxY } = expandBounds(
							minX,
							maxX,
							minY,
							maxY,
							x + bbox.x,
							y + bbox.y,
							x + bbox.x + bbox.width,
							y + bbox.y + bbox.height
						));
					}
				}
			}
		}

		if (!Number.isFinite(minX)) return null;
		return { minX, maxX, minY, maxY };
	}

	function centerGraphInCanvas(targetW: number, targetH: number) {
		const bounds = getNodeBounds();
		if (!bounds || simNodes.length === 0) return;
		const graphW = bounds.maxX - bounds.minX;
		const graphH = bounds.maxY - bounds.minY;
		const offsetX = (targetW - graphW) / 2 - bounds.minX;
		const offsetY = (targetH - graphH) / 2 - bounds.minY;
		if (Math.abs(offsetX) < 0.5 && Math.abs(offsetY) < 0.5) return;
		for (const node of simNodes) {
			node.x = (node.x ?? 0) + offsetX;
			node.y = (node.y ?? 0) + offsetY;
			if (radialLayout) {
				node.fx = node.x;
				node.fy = node.y;
			}
		}
	}

	function measureWidth() {
		const parent = container.parentElement;
		const parentWidth =
			parent?.getBoundingClientRect().width ?? container.getBoundingClientRect().width;
		const containerWidth = container.getBoundingClientRect().width;
		const measured = Math.max(parentWidth, containerWidth);
		const fallback = Math.min(window.innerWidth * 0.92, 1200);
		viewportWidth = measured > 0 ? measured : Math.max(fallback, CANVAS_MIN_HEIGHT);
		width = viewportWidth;
	}

	function measureViewportHeight() {
		const rect = container.getBoundingClientRect();
		const cssMin = Number.parseFloat(getComputedStyle(container).minHeight) || 0;
		const fallback = Math.min(window.innerHeight * 0.48, 576);
		const measured = rect.height > 0 ? rect.height : 0;
		viewportHeight = Math.max(CANVAS_MIN_HEIGHT, measured, cssMin, fallback);
		height = viewportHeight;
	}

	function updateSvgDimensions() {
		select(svg)
			.attr('width', width)
			.attr('height', height)
			.style('width', `${width}px`)
			.style('height', `${height}px`);
	}

	function measureViewport() {
		measureWidth();
		measureViewportHeight();
		container.style.width = '100%';
		container.style.height = `${viewportHeight}px`;
		container.style.minWidth = '';
		updateSvgDimensions();
	}

	function applyContentSize() {
		const bounds = getNodeBounds();
		if (!bounds) return;

		measureWidth();
		const contentW = bounds.maxX - bounds.minX + CONTENT_PADDING_X * 2;
		const contentH = bounds.maxY - bounds.minY + CONTENT_PADDING_TOP + CONTENT_PADDING_BOTTOM;
		const targetW = Math.max(viewportWidth, contentW);
		const targetH = Math.max(viewportHeight, contentH);
		centerGraphInCanvas(targetW, targetH);
		width = targetW;
		height = targetH;
		container.style.minWidth = width > viewportWidth + 2 ? `${width}px` : '';
		container.style.height = `${height}px`;
		updateSvgDimensions();
	}

	function measure() {
		measureViewport();
	}

	function reflowRadialPositions() {
		const centerId = getCenterNodeId?.() ?? null;
		const positions = computeRadialPositions(simNodes, simLinks, centerId, width, height);
		applyPositions(positions, simNodes);
		refreshLinkAttachments();
		linkSel?.attr('d', linkPath);
		nodeSel?.attr('transform', (d: SimNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);
		updateLabelPositions();
	}

	function finalizeLayoutSize() {
		measureViewport();
		if (radialLayout && simNodes.length > 0) {
			reflowRadialPositions();
		}
		applyContentSize();
	}

	function applyPositions(positions: Map<string, { x: number; y: number }>, nodes: SimNode[]) {
		for (const node of nodes) {
			const pos = positions.get(node.id);
			if (pos) {
				node.x = pos.x;
				node.y = pos.y;
				if (radialLayout) {
					node.fx = pos.x;
					node.fy = pos.y;
				}
			}
		}
	}

	function clearFixedPositions(nodes: SimNode[]) {
		for (const node of nodes) {
			node.fx = null;
			node.fy = null;
		}
	}

	function refreshLinkAttachments() {
		const centerId = getCenterNodeId?.() ?? null;
		linkAttachments = computeLinkAttachments(simNodes, simLinks, centerId);
	}

	function linkPath(d: SimLink): string {
		const att = linkAttachments.get(d.id);
		if (!att) return '';
		return linkPathBetween(att.start, att.end);
	}

	function updateLabelPositions() {
		if (!nodeSel) return;
		const centerId = getCenterNodeId?.() ?? null;
		nodeSel.select('.dep-node-label-group').each(function (this: SVGGElement, d: SimNode) {
			const g = select(this);
			const place = labelPlacement(d, centerId);
			const text = g
				.select('.dep-node-label')
				.attr('x', place.labelX)
				.attr('y', place.labelY)
				.attr('text-anchor', 'middle')
				.attr('dominant-baseline', 'hanging');
			const bbox = (text.node() as SVGTextElement | null)?.getBBox();
			if (bbox) {
				g.select('.dep-node-label-bg')
					.attr('x', bbox.x - 6)
					.attr('y', bbox.y - 3)
					.attr('width', bbox.width + 12)
					.attr('height', bbox.height + 6);
			}
		});
	}

	function updateHighlight() {
		const selectedId = getSelectedId();
		if (!linkSel || !nodeSel) return;

		const nodes = getFilteredNodes();
		const links = getFilteredLinks();
		const filteredNodeIds = new Set(nodes.map((n) => n.id));
		const highlight = selectedId
			? getHighlightSets(selectedId, links, getChainMode(), filteredNodeIds)
			: null;
		const centerId = getCenterNodeId?.() ?? null;

		linkSel
			.attr('stroke', (d: SimLink) => {
				if (hoveredLinkId === d.id) return linkDirectionColor(d, centerId);
				if (!highlight) return linkDirectionColor(d, centerId);
				const s = endpointId(d.source);
				const t = endpointId(d.target);
				return highlight.isHighlightedEdge(s, t)
					? linkDirectionColor(d, centerId)
					: palette.linkDim;
			})
			.attr('stroke-opacity', (d: SimLink) => linkStrokeOpacity(d, centerId, highlight))
			.attr('stroke-width', (d: SimLink) => linkStrokeWidth(d, highlight, centerId))
			.attr('marker-end', (d: SimLink) => {
				if (!highlight && hoveredLinkId !== d.id) return `url(#dep-arrow-${d.rel})`;
				const s = endpointId(d.source);
				const t = endpointId(d.target);
				const active = !highlight || highlight.isHighlightedEdge(s, t) || hoveredLinkId === d.id;
				return active ? `url(#dep-arrow-${d.rel})` : 'url(#dep-arrow-dim)';
			});

		nodeSel.select('.dep-node-shape').attr('opacity', (d: SimNode) => {
			if (hoveredNodeId === d.id) return 1;
			if (!highlight) return 1;
			return highlight.nodes.has(d.id) ? 1 : 0.48;
		});

		nodeSel.select('.dep-node-ring').attr('opacity', (d: SimNode) => {
			const isFocus = centerId && d.id === centerId;
			const isSelected = selectedId === d.id;
			const isHovered = hoveredNodeId === d.id;
			if (isFocus) return 0.95;
			if (isSelected) return 0.85;
			if (isHovered) return 0.7;
			return 0;
		});

		nodeSel.select('.dep-node-shape').attr('stroke-width', (d: SimNode) => {
			if (centerId && d.id === centerId) return 3;
			if (selectedId === d.id || hoveredNodeId === d.id) return 2.75;
			return 2.25;
		});

		nodeSel.select('.dep-node-label-group').attr('opacity', (d: SimNode) =>
			labelOpacity(d, centerId, selectedId)
		);

		nodeSel.attr('class', (d: SimNode) => {
			const classes = ['dep-node'];
			if (hoveredNodeId === d.id) classes.push('dep-node--hover');
			if (selectedId === d.id) classes.push('dep-node--selected');
			if (centerId && d.id === centerId) classes.push('dep-node--focus');
			return classes.join(' ');
		});
	}

	function fitToScreen(animate = true) {
		if (!zoomBehavior || simNodes.length === 0) return;
		measureViewport();
		updateLabelPositions();
		const bounds = getNodeBounds();
		if (!bounds) return;
		const { minX, minY } = bounds;
		const dx = bounds.maxX - bounds.minX || 1;
		const dy = bounds.maxY - bounds.minY || 1;
		const availableW = Math.max(viewportWidth - FIT_PADDING * 2, 1);
		const availableH = Math.max(viewportHeight - FIT_PADDING * 2, 1);
		const scale = Math.min(availableW / dx, availableH / dy);
		const tx = FIT_PADDING + (availableW - scale * dx) / 2 - scale * minX;
		const ty = FIT_PADDING + (availableH - scale * dy) / 2 - scale * minY;
		if (!Number.isFinite(scale) || !Number.isFinite(tx) || !Number.isFinite(ty)) return;
		const transform = zoomIdentity.translate(tx, ty).scale(scale);
		if (animate) {
			select(svg)
				.transition()
				.duration(550)
				.ease((t) => 1 - Math.pow(1 - t, 3))
				.call(zoomBehavior.transform, transform);
		} else {
			select(svg).call(zoomBehavior.transform, transform);
		}
	}

	function completeLayoutReveal(animateFit = false) {
		const generation = layoutGeneration;
		requestAnimationFrame(() => {
			try {
				finalizeLayoutSize();
			} catch (err) {
				console.error('[dep-map] finalizeLayoutSize failed', err);
			}
			requestAnimationFrame(() => {
				try {
					fitToScreen(animateFit);
				} catch (err) {
					console.error('[dep-map] fitToScreen failed', err);
				} finally {
					notifyLayoutReady(generation);
				}
			});
		});
	}

	function settleForceSimulation(sim: Simulation<SimNode, SimLink>) {
		const maxTicks = 320;
		let ticks = 0;
		while (sim.alpha() > sim.alphaMin() && ticks < maxTicks) {
			sim.tick();
			ticks++;
		}
	}

	function reflowForResize() {
		const generation = layoutGeneration;
		try {
			if (simNodes.length === 0) return;
			finalizeLayoutSize();
			fitToScreen(false);
		} catch (err) {
			console.error('[dep-map] reflowForResize failed', err);
		} finally {
			notifyLayoutReady(generation);
		}
	}

	function showFullExtent() {
		if (!zoomBehavior) return;
		select(svg)
			.transition()
			.duration(450)
			.ease((t) => 1 - Math.pow(1 - t, 3))
			.call(zoomBehavior.transform, zoomIdentity);
	}

	function setupResizeObserver() {
		resizeObserver?.disconnect();
		const observeTarget = container.parentElement ?? container;
		let lastObservedWidth = observeTarget.getBoundingClientRect().width;
		resizeObserver = new ResizeObserver(() => {
			const newWidth = observeTarget.getBoundingClientRect().width;
			if (Math.abs(newWidth - lastObservedWidth) > 2) {
				lastObservedWidth = newWidth;
				reflowForResize();
			}
		});
		resizeObserver.observe(observeTarget);
	}

	function focusNode(id: string) {
		const node = simNodes.find((n) => n.id === id);
		if (!node || !zoomBehavior || typeof node.x !== 'number' || typeof node.y !== 'number') return;
		const scale = 1.35;
		const tx = viewportWidth / 2 - node.x * scale;
		const ty = viewportHeight / 2 - node.y * scale;
		select(svg)
			.transition()
			.duration(450)
			.ease((t) => 1 - Math.pow(1 - t, 3))
			.call(zoomBehavior.transform, zoomIdentity.translate(tx, ty).scale(scale));
	}

	function zoomBy(factor: number) {
		if (!zoomBehavior) return;
		select(svg)
			.transition()
			.duration(280)
			.call(zoomBehavior.scaleBy, factor);
	}

	function ensureDefs(root: ReturnType<typeof select>) {
		let defs = root.select('defs');
		if (defs.empty()) defs = root.append('defs');

		defs.selectAll('marker').remove();

		const rels: LinkRelation[] = [
			'orchestrates',
			'observes',
			'deploys',
			'references',
			'member',
			'memberOf',
			'bindsTo',
			'appliesTo',
			'extends'
		];

		for (const rel of rels) {
			defs
				.append('marker')
				.attr('id', `dep-arrow-${rel}`)
				.attr('viewBox', '0 -4 8 8')
				.attr('refX', 6)
				.attr('refY', 0)
				.attr('markerWidth', 5)
				.attr('markerHeight', 5)
				.attr('orient', 'auto')
				.append('path')
				.attr('d', 'M0,-4L8,0L0,4')
				.attr('fill', relColor(rel));
		}

		defs
			.append('marker')
			.attr('id', 'dep-arrow-dim')
			.attr('viewBox', '0 -4 8 8')
			.attr('refX', 6)
			.attr('refY', 0)
			.attr('markerWidth', 4)
			.attr('markerHeight', 4)
			.attr('orient', 'auto')
			.append('path')
			.attr('d', 'M0,-4L8,0L0,4')
			.attr('fill', palette.linkDim);

		defs.selectAll('#dep-node-shadow').remove();
		const shadow = defs.append('filter').attr('id', 'dep-node-shadow').attr('x', '-40%').attr('y', '-40%').attr('width', '180%').attr('height', '180%');
		shadow
			.append('feDropShadow')
			.attr('dx', 0)
			.attr('dy', 1.5)
			.attr('stdDeviation', 2.5)
			.attr('flood-color', theme === 'dark' ? '#020617' : '#0f172a')
			.attr('flood-opacity', theme === 'dark' ? 0.42 : 0.16);

		const gradients = defs.selectAll('#dep-node-gradients').data([0]);
		const gradRoot = gradients.enter().append('g').attr('id', 'dep-node-gradients').merge(gradients);

		gradRoot.selectAll('linearGradient').remove();

		for (const type of ['config', 'state', 'other'] as const) {
			const grad = gradRoot
				.append('linearGradient')
				.attr('id', `dep-node-grad-${type}`)
				.attr('x1', '0%')
				.attr('y1', '0%')
				.attr('x2', '0%')
				.attr('y2', '100%');
			grad.append('stop').attr('offset', '0%').attr('stop-color', nodeFillLight(type, palette));
			grad.append('stop').attr('offset', '100%').attr('stop-color', nodeFill(type, palette));
		}
	}

	function showTooltip(event: MouseEvent, html: string) {
		tooltip.style.opacity = '1';
		tooltip.innerHTML = html;
		tooltip.style.left = `${event.pageX + 14}px`;
		tooltip.style.top = `${event.pageY + 14}px`;
	}

	function hideTooltip() {
		tooltip.style.opacity = '0';
	}

	function rebuild() {
		layoutGeneration++;
		const generation = layoutGeneration;
		simulation?.stop();

		try {
			measure();

			const filteredNodes = getFilteredNodes();
			const filteredLinks = getFilteredLinks();
			const centerId = getCenterNodeId?.() ?? null;

			simNodes = filteredNodes.map((n) => ({ ...n }));
			denseLabels = simNodes.length > DENSE_LABEL_THRESHOLD;
			directNeighborIds = getDirectNeighborIds(centerId, filteredLinks);
			const nodeById = new Map(simNodes.map((n) => [n.id, n]));
			simLinks = filteredLinks
				.map((l) => ({
					...l,
					source: nodeById.get(typeof l.source === 'object' ? l.source.id : l.source)!,
					target: nodeById.get(typeof l.target === 'object' ? l.target.id : l.target)!
				}))
				.filter((l) => l.source && l.target);

			assignFocusDepths(simNodes, simLinks, centerId);

			if (simNodes.length === 0) {
				const root = select(svg);
				if (!gRoot) {
					root.selectAll('*').remove();
					root.attr('class', 'dep-map-svg dep-map-svg-inner');
				} else {
					gRoot.selectAll('*').remove();
				}
				notifyLayoutReady(generation);
				return;
			}

		const root = select(svg);
		if (!gRoot) {
			root.selectAll('*').remove();
			root.attr('class', 'dep-map-svg dep-map-svg-inner');

			const gridPattern = root
				.append('defs')
				.append('pattern')
				.attr('id', 'dep-grid-pattern')
				.attr('width', 24)
				.attr('height', 24)
				.attr('patternUnits', 'userSpaceOnUse');
			gridPattern.append('circle').attr('cx', 1.5).attr('cy', 1.5).attr('r', 0.9).attr('class', 'dep-grid-dot');

			root.append('rect').attr('class', 'dep-map-bg').attr('width', '100%').attr('height', '100%');
			root
				.append('rect')
				.attr('class', 'dep-map-grid')
				.attr('width', '100%')
				.attr('height', '100%')
				.attr('fill', 'url(#dep-grid-pattern)')
				.attr('pointer-events', 'none');

			zoomBehavior = zoom<SVGSVGElement, unknown>()
				.scaleExtent([0.12, 4])
				.on('zoom', (event) => {
					gRoot?.attr('transform', event.transform);
				});
			root.call(zoomBehavior).on('dblclick.zoom', null);
			gRoot = root.append('g').attr('class', 'dep-map-graph-root');
		} else {
			gRoot.selectAll('*').remove();
		}

		ensureDefs(root);
		root.select('.dep-grid-dot').attr('fill', palette.gridDot);
		root.select('.dep-map-bg').attr('fill', palette.background);

		linkSel = gRoot
			.append('g')
			.attr('class', 'dep-links')
			.selectAll('path')
			.data(simLinks, (d: SimLink) => d.id)
			.join('path')
			.attr('fill', 'none')
			.attr('stroke-linecap', 'round')
			.attr('stroke', (d: SimLink) => linkDirectionColor(d, centerId))
			.attr('stroke-opacity', (d: SimLink) => linkStrokeOpacity(d, centerId, null))
			.attr('stroke-width', (d: SimLink) => linkStrokeWidth(d, null, centerId))
			.attr('marker-end', (d: SimLink) => `url(#dep-arrow-${d.rel})`)
			.on('mouseenter', (event: MouseEvent, d: SimLink) => {
				hoveredLinkId = d.id;
				updateHighlight();
				showTooltip(event, linkTooltipHtml(d));
			})
			.on('mousemove', (event: MouseEvent) => {
				tooltip.style.left = `${event.pageX + 14}px`;
				tooltip.style.top = `${event.pageY + 14}px`;
			})
			.on('mouseleave', () => {
				hoveredLinkId = null;
				updateHighlight();
				hideTooltip();
			})

		const dragBehavior = drag<SVGGElement, SimNode>()
			.on('start', (event, d) => {
				if (!event.active) simulation?.alphaTarget(0.2).restart();
				d.fx = d.x;
				d.fy = d.y;
			})
			.on('drag', (event, d) => {
				d.fx = event.x;
				d.fy = event.y;
			})
			.on('end', (event, d) => {
				if (!event.active) simulation?.alphaTarget(0);
				if (!radialLayout) {
					d.fx = null;
					d.fy = null;
				}
			});

		nodeSel = gRoot
			.append('g')
			.attr('class', 'dep-nodes')
			.selectAll('g')
			.data(simNodes, (d: SimNode) => d.id)
			.join('g')
			.attr('class', 'dep-node')
			.attr('cursor', 'pointer')
			.on('click', (event: MouseEvent, d: SimNode) => {
				event.stopPropagation();
				const centerId = getCenterNodeId?.() ?? null;
				if (centerId && d.id !== centerId) {
					onRefocus?.(d.id);
					return;
				}
				onSelect(d.id);
				updateHighlight();
			})
			.on('mouseenter', (event: MouseEvent, d: SimNode) => {
				hoveredNodeId = d.id;
				updateHighlight();
				const { inCount, outCount } = countRels(d.id, simLinks);
				showTooltip(
					event,
					`<strong>${escapeHtml(d.kind || d.shortName)}</strong>` +
						`<br/><span style="opacity:0.75">${escapeHtml(d.group)}</span>` +
						`<br/><span style="opacity:0.75">${escapeHtml(d.type)} · ${inCount} in · ${outCount} out</span>`
				);
			})
			.on('mousemove', (event: MouseEvent) => {
				tooltip.style.left = `${event.pageX + 14}px`;
				tooltip.style.top = `${event.pageY + 14}px`;
			})
			.on('mouseleave', () => {
				hoveredNodeId = null;
				updateHighlight();
				hideTooltip();
			})
			.call(dragBehavior);

		nodeSel
			.insert('circle', ':first-child')
			.attr('class', 'dep-node-hit')
			.attr('r', (d: SimNode) => nodeRadius(d, centerId) + 14)
			.attr('fill', 'transparent')
			.attr('stroke', 'none')
			.style('pointer-events', 'all');

		nodeSel
			.append('circle')
			.attr('class', 'dep-node-ring')
			.attr('r', (d: SimNode) => nodeRadius(d, centerId) + 8)
			.attr('fill', 'none')
			.attr('stroke', palette.focusRing)
			.attr('stroke-width', 2.5)
			.attr('opacity', (d: SimNode) => (centerId && d.id === centerId ? 0.95 : 0));

		nodeSel
			.append('circle')
			.attr('class', 'dep-node-shape')
			.attr('r', (d: SimNode) => nodeRadius(d, centerId))
			.attr('fill', (d: SimNode) =>
				`url(#dep-node-grad-${d.type === 'config' || d.type === 'state' ? d.type : 'other'})`
			)
			.attr('stroke', palette.nodeStroke)
			.attr('stroke-width', (d: SimNode) => {
				if (centerId && d.id === centerId) return 2.75;
				return 2;
			})
			.attr('filter', 'url(#dep-node-shadow)')
			.style('pointer-events', 'none');

		const labelGroups = nodeSel.append('g').attr('class', 'dep-node-label-group').attr('pointer-events', 'none');

		labelGroups.each(function (this: SVGGElement, d: SimNode) {
			const g = select(this);
			const place = labelPlacement(d, centerId);
			const label = truncateLabel(d.kind || d.shortName);
			const text = g
				.append('text')
				.attr('class', 'dep-node-label')
				.attr('x', place.labelX)
				.attr('y', place.labelY)
				.attr('text-anchor', 'middle')
				.attr('dominant-baseline', 'hanging')
				.attr('font-size', centerId && d.id === centerId ? '13px' : '11.5px')
				.attr('font-weight', centerId && d.id === centerId ? 700 : 600)
				.attr('font-family', 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif')
				.attr('fill', palette.nodeLabel)
				.text(label);

			const bbox = (text.node() as SVGTextElement).getBBox();
			g.insert('rect', 'text')
				.attr('class', 'dep-node-label-bg')
				.attr('x', bbox.x - 6)
				.attr('y', bbox.y - 3)
				.attr('width', bbox.width + 12)
				.attr('height', bbox.height + 6)
				.attr('rx', 5)
				.attr('fill', palette.nodeLabelBg)
				.attr('stroke', palette.panelBorder)
				.attr('stroke-width', 0.75);
		});

		const positions = computeRadialPositions(simNodes, simLinks, centerId, width, height);
		applyPositions(positions, simNodes);
		refreshLinkAttachments();

		if (radialLayout) {
			simulation = null;
			linkSel.attr('d', linkPath);
			nodeSel.attr('transform', (d: SimNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);
			updateLabelPositions();
			updateHighlight();
			completeLayoutReveal(false);
		} else {
			clearFixedPositions(simNodes);
			const nodeCount = simNodes.length;
			const linkDistance = Math.min(240, 130 + nodeCount * 2.2);
			const chargeStrength = -480 - Math.min(nodeCount, 40) * 8;
			const collisionPad = 40 + Math.min(nodeCount, 32);
			simulation = forceSimulation(simNodes)
				.force(
					'link',
					forceLink<SimNode, SimLink>(simLinks)
						.id((d) => d.id)
						.distance(linkDistance)
						.strength(0.2)
				)
				.force('charge', forceManyBody().strength(chargeStrength))
				.force('center', forceCenter(width / 2, height / 2))
				.force(
					'collision',
					forceCollide<SimNode>().radius((d) => nodeRadius(d, centerId) + collisionPad)
				)
				.alphaDecay(0.042)
				.velocityDecay(0.58);

			settleForceSimulation(simulation);
			refreshLinkAttachments();
			linkSel.attr('d', linkPath);
			nodeSel.attr('transform', (d: SimNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);
			updateLabelPositions();
			updateHighlight();

			simulation.on('tick', () => {
				refreshLinkAttachments();
				linkSel?.attr('d', linkPath);
				nodeSel?.attr('transform', (d: SimNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);
				updateLabelPositions();
			});

			completeLayoutReveal(false);
		}

			setupResizeObserver();
		} catch (err) {
			console.error('[dep-map] rebuild failed', err);
			notifyLayoutReady(generation);
		}
	}

	return {
		rebuild,
		updateTheme(nextTheme: 'light' | 'dark') {
			theme = nextTheme;
			palette = getGraphPalette(theme);
			const root = select(svg);
			root.select('.dep-grid-dot').attr('fill', palette.gridDot);
			root.select('.dep-map-bg').attr('fill', palette.background);
			ensureDefs(root);
			nodeSel?.select('.dep-node-shape').attr('stroke', palette.nodeStroke);
			nodeSel?.select('.dep-node-ring').attr('stroke', palette.focusRing);
			nodeSel?.select('.dep-node-label').attr('fill', palette.nodeLabel);
			nodeSel?.select('.dep-node-label-bg').attr('fill', palette.nodeLabelBg).attr('stroke', palette.panelBorder);
			updateHighlight();
		},
		updateHighlight,
		focusNode,
		fitToScreen,
		showFullExtent,
		reflowLayout: reflowForResize,
		zoomIn: () => zoomBy(1.28),
		zoomOut: () => zoomBy(1 / 1.28),
		setRadial(radial: boolean) {
			radialLayout = radial;
			rebuild();
		},
		destroy() {
			resizeObserver?.disconnect();
			resizeObserver = null;
			simulation?.stop();
		}
	};
}
