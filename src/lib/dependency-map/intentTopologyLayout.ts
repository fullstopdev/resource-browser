import { filterAggregateSiblingDeps } from './intentFocusFilter';
import { linkConfidenceTier } from './graphFilters';
import { getGraphPalette, REL_ORDER } from './graphColors';
import { getRelationLabel, MAP_ROLE_LABELS } from './relationLabels';
import { buildTransitiveDepList } from './transitiveClosure';
import {
	isMapTopologyAppliesToLink,
	isMapTopologyDependsOnLink,
	isMapTopologyRequiredByLink,
	isTopologyLayoutLink
} from './markmapMarkdown';
import type { ThemeMode } from '$lib/theme';
import type { TransitiveDepEntry } from './transitiveClosure';
import type {
	ConfidenceTier,
	DependencyGraph,
	EdgeSource,
	GraphLink,
	GraphNode,
	LinkRelation,
	NodeType
} from './types';

/** Matches IntentTopologyNode card width (18rem @ 16px). */
export const NODE_WIDTH = 288;
/** Matches IntentTopologyNode card height (4.5rem @ 16px): chip + kind + 2-line FQDN. */
export const NODE_HEIGHT = 72;
/** Focus node uses the same card height as peers for port alignment. */
export const FOCUS_NODE_HEIGHT = NODE_HEIGHT;
/** Minimum vertical gap between node bounding boxes in the same column. */
export const ROW_GAP = 16;
/** Vertical stride per node slot: card height + gap. */
export const ROW_STEP = NODE_HEIGHT + ROW_GAP;
/** Extra vertical space between API-group lanes within a column. */
export const GROUP_GAP = 28;
/** Horizontal gap between column bounding boxes (edge routing lane). */
export const COLUMN_GAP = 64;
export const COLUMN_WIDTH = NODE_WIDTH + COLUMN_GAP;

/** @deprecated Use ROW_STEP — kept for tests migrating off legacy spacing. */
export const ROW_HEIGHT = ROW_STEP;

export const INTENT_LAYERS = ['prerequisite', 'focus', 'dependent'] as const;

export type IntentTopologyRole = (typeof INTENT_LAYERS)[number];

export type IntentTopologyNodeData = {
	nodeId: string;
	kind: string;
	displayName: string;
	resourceId: string;
	group: string;
	shortGroup: string;
	type: NodeType;
	field?: string;
	reason?: string;
	depth: number;
	rel?: LinkRelation;
	role: IntentTopologyRole;
	roleLabel: string;
	isFocus: boolean;
	edgeSource?: EdgeSource;
	confidenceTier?: ConfidenceTier;
	relColor: string;
	statusColor: string;
	graphNode?: GraphNode;
	/** Per-peer target handles on focus node (left side). */
	incomingPorts?: Array<{ id: string; topPx: number }>;
	/** Per-peer source handles on focus node (right side). */
	outgoingPorts?: Array<{ id: string; topPx: number }>;
	/** True when this node appears on the drill-down breadcrumb trail. */
	pathInBreadcrumb?: boolean;
};

export type LayoutNode = {
	id: string;
	type: string;
	position: { x: number; y: number };
	width?: number;
	height?: number;
	draggable: boolean;
	selected?: boolean;
	data: IntentTopologyNodeData;
};

export type LayoutEdge = {
	id: string;
	source: string;
	target: string;
	label: string;
	rel?: LinkRelation;
	count: number;
	sourceHandle?: string;
	targetHandle?: string;
};

export type IntentTopologyLayoutOptions = {
	depSearch?: string;
	typeFilter?: 'all' | NodeType;
	showDependsOn?: boolean;
	showRequiredBy?: boolean;
	themeMode?: ThemeMode;
	/** Breadcrumb trail — inject off-screen ancestors so path edges can render. */
	pathNodeIds?: string[];
};

export type IntentTopologyLayout = {
	nodes: LayoutNode[];
	edges: LayoutEdge[];
	isEmpty: boolean;
	columnLabels: string[];
};

function shortGroup(group: string): string {
	return group.replace(/\.eda\.nokia\.com$/, '').replace(/\.nokia\.com$/, '');
}

function nodeFor(graph: DependencyGraph, id: string): GraphNode | undefined {
	return graph.nodes.find((n) => n.id === id);
}

function nodeLabel(graph: DependencyGraph, id: string): string {
	const node = nodeFor(graph, id);
	return node?.kind ?? node?.shortName ?? id.split('.')[0];
}

function linkEndpoint(link: GraphLink, end: 'source' | 'target'): string {
	const value = link[end];
	return typeof value === 'string' ? value : value;
}

function matchesSearch(
	graph: DependencyGraph,
	dep: TransitiveDepEntry,
	query: string
): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	const node = nodeFor(graph, dep.id);
	const haystack = `${nodeLabel(graph, dep.id)} ${node?.group ?? ''} ${dep.field ?? ''} ${dep.reason ?? ''}`.toLowerCase();
	return haystack.includes(q);
}

function matchesTypeFilter(
	graph: DependencyGraph,
	nodeId: string,
	typeFilter: 'all' | NodeType
): boolean {
	if (typeFilter === 'all') return true;
	return nodeFor(graph, nodeId)?.type === typeFilter;
}

function relSortIndex(rel?: LinkRelation): number {
	if (!rel) return REL_ORDER.length;
	const idx = REL_ORDER.indexOf(rel);
	return idx === -1 ? REL_ORDER.length : idx;
}

function sortDeps(
	graph: DependencyGraph,
	deps: TransitiveDepEntry[]
): TransitiveDepEntry[] {
	return [...deps].sort((a, b) => {
		const relCmp = relSortIndex(a.rel) - relSortIndex(b.rel);
		if (relCmp !== 0) return relCmp;
		return nodeLabel(graph, a.id).localeCompare(nodeLabel(graph, b.id));
	});
}

/** Horizontal offset for breadcrumb-only nodes parked off-screen (path edges still render). */
export const PATH_BREADCRUMB_OFFSCREEN_X = -COLUMN_WIDTH;

function roleForDep(direction: 'outgoing' | 'incoming'): IntentTopologyRole {
	return direction === 'outgoing' ? 'prerequisite' : 'dependent';
}

/**
 * appliesTo semantics: source = consumer, target = provider/policy.
 * Column follows meaning, not raw edge direction when focus is on either end.
 */
export function appliesToEndpoints(
	graph: DependencyGraph,
	link: GraphLink
): { consumer: string; provider: string } {
	const source = linkEndpoint(link, 'source');
	const target = linkEndpoint(link, 'target');
	const sourceNode = nodeFor(graph, source);
	const targetNode = nodeFor(graph, target);
	const sourceIsPolicy =
		sourceNode?.kind === 'Policy' || sourceNode?.group?.includes('routingpolicies') === true;
	const targetIsPolicy =
		targetNode?.kind === 'Policy' || targetNode?.group?.includes('routingpolicies') === true;
	if (sourceIsPolicy && !targetIsPolicy) return { consumer: target, provider: source };
	if (targetIsPolicy && !sourceIsPolicy) return { consumer: source, provider: target };
	return { consumer: source, provider: target };
}

export function roleForAppliesToNeighbor(
	focusNodeId: string,
	link: GraphLink,
	neighborId: string,
	graph?: DependencyGraph
): IntentTopologyRole | null {
	if (link.rel !== 'appliesTo') return null;
	const { consumer, provider } = graph
		? appliesToEndpoints(graph, link)
		: {
				consumer: linkEndpoint(link, 'source'),
				provider: linkEndpoint(link, 'target')
			};
	if (consumer === focusNodeId && provider === neighborId) return 'prerequisite';
	if (provider === focusNodeId && consumer === neighborId) return 'dependent';
	return null;
}

function canonicalLayoutLinks(graph: DependencyGraph, links: GraphLink[]): GraphLink[] {
	return links.map((link) => {
		if (!isMapTopologyAppliesToLink(link)) return link;
		const { consumer, provider } = appliesToEndpoints(graph, link);
		if (linkEndpoint(link, 'source') === consumer && linkEndpoint(link, 'target') === provider) {
			return link;
		}
		return { ...link, source: consumer, target: provider };
	});
}

function dependsOnLinksForFocus(graph: DependencyGraph, focusNodeId: string): GraphLink[] {
	const filtered = graph.links.filter((link) => {
		if (!isTopologyLayoutLink(link)) return false;
		if (isMapTopologyAppliesToLink(link)) {
			return appliesToEndpoints(graph, link).consumer === focusNodeId;
		}
		return isMapTopologyDependsOnLink(link);
	});
	return canonicalLayoutLinks(graph, filtered);
}

function requiredByLinksForFocus(graph: DependencyGraph, focusNodeId: string): GraphLink[] {
	const filtered = graph.links.filter((link) => {
		if (!isTopologyLayoutLink(link)) return false;
		if (isMapTopologyAppliesToLink(link)) {
			return appliesToEndpoints(graph, link).provider === focusNodeId;
		}
		return isMapTopologyRequiredByLink(link) && !isMapTopologyAppliesToLink(link);
	});
	return canonicalLayoutLinks(graph, filtered);
}

/** Column index: 0 = dependents/consumers (left), 1 = focus (center when consumers exist), 2 = prerequisites (right). */
export function focusColumnIndex(hasDependents: boolean): number {
	return hasDependents ? 1 : 0;
}

export function prerequisiteColumnIndex(hasDependents: boolean): number {
	return hasDependents ? 2 : 1;
}

export function dependentColumnIndex(): number {
	return 0;
}

function columnFor(role: IntentTopologyRole, hasDependents: boolean): number {
	if (role === 'dependent') return dependentColumnIndex();
	if (role === 'prerequisite') return prerequisiteColumnIndex(hasDependents);
	return focusColumnIndex(hasDependents);
}

function relColor(rel: LinkRelation | undefined, themeMode: ThemeMode): string {
	const palette = getGraphPalette(themeMode);
	if (!rel) return palette.link;
	return palette.rel[rel] ?? palette.link;
}

function relLabel(rel?: LinkRelation, count = 1): string {
	const base = getRelationLabel(rel);
	return count > 1 ? `${base} (${count})` : base;
}

function roleLabel(role: IntentTopologyRole): string {
	if (role === 'focus') return MAP_ROLE_LABELS.focus;
	if (role === 'prerequisite') return MAP_ROLE_LABELS.prerequisite;
	return MAP_ROLE_LABELS.dependent;
}

function statusColor(
	tier: ConfidenceTier | undefined,
	source: EdgeSource | undefined
): string {
	if (tier === 1 || source === 'catalog' || source === 'explicit') return '#22c55e';
	return '#3b82f6';
}

function metadataForEntry(
	graph: DependencyGraph,
	focusNodeId: string,
	entry: TransitiveDepEntry,
	role: IntentTopologyRole
): { edgeSource?: EdgeSource; confidenceTier?: ConfidenceTier } {
	const links = graph.links.filter(isTopologyLayoutLink);
	const link = links.find((l) => {
		const source = linkEndpoint(l, 'source');
		const target = linkEndpoint(l, 'target');
		const appliesToRole = roleForAppliesToNeighbor(focusNodeId, l, entry.id, graph);
		if (appliesToRole) return appliesToRole === role;
		if (role === 'prerequisite') {
			return source === focusNodeId && target === entry.id;
		}
		if (role === 'dependent') {
			return source === entry.id && target === focusNodeId;
		}
		return false;
	});
	if (!link) return {};
	return {
		edgeSource: link.edgeSource,
		confidenceTier: link.confidenceTier ?? linkConfidenceTier(link)
	};
}

function sortColumnByConnectivity(
	graph: DependencyGraph,
	items: ColumnItem[],
	prevColumnOrder: string[],
	displayPairs: Array<{ source: string; target: string }>
): ColumnItem[] {
	if (items.length <= 1) return items;

	const prevIndex = new Map(prevColumnOrder.map((id, index) => [id, index]));

	function barycenter(item: ColumnItem): number {
		const id = item.entry.id;
		const scores: number[] = [];

		for (const edge of displayPairs) {
			if (edge.target === id && prevIndex.has(edge.source)) {
				scores.push(prevIndex.get(edge.source)!);
			}
			if (edge.source === id && prevIndex.has(edge.target)) {
				scores.push(prevIndex.get(edge.target)!);
			}
		}

		if (scores.length === 0) {
			if (item.role === 'dependent') return -0.5;
			if (item.role === 'prerequisite') return 0.5;
			return 0;
		}

		return scores.reduce((sum, score) => sum + score, 0) / scores.length;
	}

	return [...items].sort((a, b) => {
		const bc = barycenter(a) - barycenter(b);
		if (bc !== 0) return bc;

		const groupA = nodeFor(graph, a.entry.id)?.group ?? '';
		const groupB = nodeFor(graph, b.entry.id)?.group ?? '';
		const groupCmp = groupA.localeCompare(groupB);
		if (groupCmp !== 0) return groupCmp;

		return nodeLabel(graph, a.entry.id).localeCompare(nodeLabel(graph, b.entry.id));
	});
}

type ColumnItem = { entry: TransitiveDepEntry; role: IntentTopologyRole };

function groupColumnItems(
	graph: DependencyGraph,
	items: ColumnItem[]
): Array<{ group: string; items: ColumnItem[] }> {
	const byGroup = new Map<string, ColumnItem[]>();

	for (const item of items) {
		const group = nodeFor(graph, item.entry.id)?.group ?? '';
		const bucket = byGroup.get(group) ?? [];
		bucket.push(item);
		byGroup.set(group, bucket);
	}

	return [...byGroup.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([group, groupItems]) => ({
			group,
			items: groupItems.sort((a, b) => {
				const relCmp = relSortIndex(a.entry.rel) - relSortIndex(b.entry.rel);
				if (relCmp !== 0) return relCmp;
				return nodeLabel(graph, a.entry.id).localeCompare(nodeLabel(graph, b.entry.id));
			})
		}));
}

function columnStackHeight(_graph: DependencyGraph, items: ColumnItem[]): number {
	if (items.length === 0) return NODE_HEIGHT;
	const groups = groupColumnItems(_graph, items);
	let height = 0;

	for (let i = 0; i < groups.length; i++) {
		height += groups[i]!.items.length * ROW_STEP;
		if (i < groups.length - 1) height += GROUP_GAP;
	}

	return height;
}

export type LayoutBBox = { x: number; y: number; width: number; height: number };

export function layoutNodeBBox(node: LayoutNode): LayoutBBox {
	return {
		x: node.position.x,
		y: node.position.y,
		width: node.width ?? NODE_WIDTH,
		height: node.height ?? NODE_HEIGHT
	};
}

export function layoutBoxesOverlap(a: LayoutBBox, b: LayoutBBox, minGap = 0): boolean {
	return !(
		a.x + a.width + minGap <= b.x ||
		b.x + b.width + minGap <= a.x ||
		a.y + a.height + minGap <= b.y ||
		b.y + b.height + minGap <= a.y
	);
}

/** Returns pairs of node ids whose bounding boxes overlap (optionally requiring minGap clearance). */
export function findLayoutOverlaps(
	nodes: LayoutNode[],
	minGap = 0
): Array<[string, string]> {
	const pairs: Array<[string, string]> = [];
	for (let i = 0; i < nodes.length; i++) {
		const boxA = layoutNodeBBox(nodes[i]!);
		for (let j = i + 1; j < nodes.length; j++) {
			const boxB = layoutNodeBBox(nodes[j]!);
			if (layoutBoxesOverlap(boxA, boxB, minGap)) {
				pairs.push([nodes[i]!.id, nodes[j]!.id]);
			}
		}
	}
	return pairs;
}

export function assertNoLayoutOverlaps(nodes: LayoutNode[], minGap = 0): void {
	const overlaps = findLayoutOverlaps(nodes, minGap);
	if (overlaps.length > 0) {
		const detail = overlaps.map(([a, b]) => `${a} ↔ ${b}`).join(', ');
		throw new Error(`Layout overlap detected (${overlaps.length}): ${detail}`);
	}
}

function buildFlowNode(
	graph: DependencyGraph,
	entry: TransitiveDepEntry | null,
	focusNodeId: string,
	role: IntentTopologyRole,
	position: { x: number; y: number },
	themeMode: ThemeMode
): LayoutNode {
	const id = entry?.id ?? focusNodeId;
	const graphNode = nodeFor(graph, id);
	const isFocus = id === focusNodeId;
	const meta = entry ? metadataForEntry(graph, focusNodeId, entry, role) : {};
	const rel = entry?.rel;
	const tier = meta.confidenceTier;
	const source = meta.edgeSource;

	return {
		id,
		type: 'intentTopology',
		position,
		draggable: true,
		width: NODE_WIDTH,
		height: isFocus ? FOCUS_NODE_HEIGHT : NODE_HEIGHT,
		data: {
			nodeId: id,
			kind: graphNode?.kind ?? id.split('.')[0],
			displayName: graphNode?.shortName ?? graphNode?.kind ?? id.split('.')[0],
			resourceId: id,
			group: graphNode?.group ?? '',
			shortGroup: shortGroup(graphNode?.group ?? ''),
			type: graphNode?.type ?? 'other',
			field: entry?.field,
			reason: entry?.reason,
			depth: entry?.depth ?? 0,
			rel,
			role,
			roleLabel: roleLabel(role),
			isFocus,
			edgeSource: source,
			confidenceTier: tier,
			relColor: relColor(rel, themeMode),
			statusColor: statusColor(tier, source),
			graphNode
		}
	};
}

type CollapsedEdge = {
	source: string;
	target: string;
	rel?: LinkRelation;
	count: number;
	linkId: string;
};

function collapseEdgeCandidates(
	links: GraphLink[],
	visibleIds: Set<string>
): CollapsedEdge[] {
	const groups = new Map<string, GraphLink[]>();

	for (const link of links) {
		if (!isTopologyLayoutLink(link)) continue;
		const source = linkEndpoint(link, 'source');
		const target = linkEndpoint(link, 'target');
		if (!visibleIds.has(source) || !visibleIds.has(target) || source === target) continue;
		const key = `${source}|${target}`;
		const bucket = groups.get(key) ?? [];
		bucket.push(link);
		groups.set(key, bucket);
	}

	return [...groups.entries()].map(([key, group]) => {
		const representative = group.reduce((best, link) => {
			const bestRel = relSortIndex(best.rel);
			const linkRel = relSortIndex(link.rel);
			if (linkRel !== bestRel) return linkRel < bestRel ? link : best;
			const bestTier = best.confidenceTier ?? linkConfidenceTier(best);
			const linkTier = link.confidenceTier ?? linkConfidenceTier(link);
			return linkTier < bestTier ? link : best;
		});
		const [source, target] = key.split('|');
		return {
			source: source!,
			target: target!,
			rel: representative.rel,
			count: group.length,
			linkId: representative.id
		};
	});
}

function relForPathPair(
	layoutLinks: GraphLink[],
	from: string,
	to: string
): LinkRelation | undefined {
	const link = layoutLinks.find((l) => {
		const source = linkEndpoint(l, 'source');
		const target = linkEndpoint(l, 'target');
		return (source === from && target === to) || (source === to && target === from);
	});
	return link?.rel;
}

function injectPathBreadcrumbNodes(
	graph: DependencyGraph,
	focusNodeId: string,
	pathNodeIds: string[],
	roleByNode: Map<string, IntentTopologyRole>,
	columnBuckets: Map<number, ColumnItem[]>,
	layoutLinks: GraphLink[],
	hasDependents: boolean,
	pathOnlyIds: Set<string>
): boolean {
	const focusIdx = pathNodeIds.indexOf(focusNodeId);
	if (focusIdx < 0) return hasDependents;

	let nextHasDependents = hasDependents;

	for (let i = 0; i < pathNodeIds.length; i++) {
		const pathId = pathNodeIds[i];
		if (pathId === focusNodeId || roleByNode.has(pathId) || !nodeFor(graph, pathId)) continue;

		const neighborId =
			i < focusIdx ? pathNodeIds[i + 1] : i > focusIdx ? pathNodeIds[i - 1] : undefined;
		const pathLink = neighborId
			? layoutLinks.find((l) => {
					const source = linkEndpoint(l, 'source');
					const target = linkEndpoint(l, 'target');
					return (
						(source === pathId && target === neighborId) ||
						(source === neighborId && target === pathId)
					);
				})
			: undefined;

		let role: IntentTopologyRole;
		if (pathLink?.rel === 'appliesTo') {
			role = roleForAppliesToNeighbor(focusNodeId, pathLink, pathId, graph) ?? 'prerequisite';
		} else {
			role = i < focusIdx ? 'prerequisite' : 'dependent';
		}
		if (role === 'dependent') nextHasDependents = true;

		pathOnlyIds.add(pathId);
		roleByNode.set(pathId, role);
		const col = columnFor(role, nextHasDependents);
		const bucket = columnBuckets.get(col) ?? [];
		if (bucket.some((item) => item.entry.id === pathId)) continue;

		bucket.push({
			entry: {
				id: pathId,
				depth: Math.abs(i - focusIdx),
				rel: neighborId ? relForPathPair(layoutLinks, pathId, neighborId) : undefined
			},
			role
		});
		columnBuckets.set(col, bucket);
	}

	return nextHasDependents;
}

export function buildIntentTopologyLayout(
	graph: DependencyGraph,
	focusNodeId: string,
	options: IntentTopologyLayoutOptions = {}
): IntentTopologyLayout {
	const {
		depSearch = '',
		typeFilter = 'all',
		showDependsOn = true,
		showRequiredBy = true,
		themeMode = 'light',
		pathNodeIds = []
	} = options;

	const dependsOnLinks = dependsOnLinksForFocus(graph, focusNodeId);
	const requiredByLinks = requiredByLinksForFocus(graph, focusNodeId);
	const dependsOnRaw = showDependsOn
		? buildTransitiveDepList(focusNodeId, dependsOnLinks, 'outgoing', 'direct')
		: [];
	const requiredByRaw = showRequiredBy
		? buildTransitiveDepList(focusNodeId, requiredByLinks, 'incoming', 'direct')
		: [];

	const dependsOn = sortDeps(
		graph,
		filterAggregateSiblingDeps(
			graph,
			focusNodeId,
			dependsOnRaw.filter(
				(d) => matchesSearch(graph, d, depSearch) && matchesTypeFilter(graph, d.id, typeFilter)
			),
			dependsOnLinks
		)
	);
	const requiredBy = sortDeps(
		graph,
		filterAggregateSiblingDeps(
			graph,
			focusNodeId,
			requiredByRaw.filter(
				(d) => matchesSearch(graph, d, depSearch) && matchesTypeFilter(graph, d.id, typeFilter)
			),
			requiredByLinks
		)
	);

	if (dependsOn.length === 0 && requiredBy.length === 0) {
		return { nodes: [], edges: [], isEmpty: true, columnLabels: [] };
	}

	const roleByNode = new Map<string, IntentTopologyRole>();
	const pathOnlyIds = new Set<string>();

	function assignDep(dep: TransitiveDepEntry, direction: 'outgoing' | 'incoming') {
		roleByNode.set(dep.id, roleForDep(direction));
	}

	for (const dep of dependsOn) assignDep(dep, 'outgoing');
	for (const dep of requiredBy) assignDep(dep, 'incoming');

	let hasDependents = requiredBy.length > 0;
	const columnBuckets = new Map<number, ColumnItem[]>();

	for (const dep of [...dependsOn, ...requiredBy]) {
		const role = roleByNode.get(dep.id)!;
		const col = columnFor(role, hasDependents);
		const bucket = columnBuckets.get(col) ?? [];
		if (!bucket.some((item) => item.entry.id === dep.id)) {
			bucket.push({ entry: dep, role });
		}
		columnBuckets.set(col, bucket);
	}

	const layoutLinks = canonicalLayoutLinks(graph, [...dependsOnLinks]);
	for (const link of requiredByLinks) {
		if (!layoutLinks.some((l) => l.id === link.id)) layoutLinks.push(link);
	}

	if (pathNodeIds.length >= 2) {
		hasDependents = injectPathBreadcrumbNodes(
			graph,
			focusNodeId,
			pathNodeIds,
			roleByNode,
			columnBuckets,
			layoutLinks,
			hasDependents,
			pathOnlyIds
		);
	}

	const visibleIds = new Set<string>([focusNodeId]);
	for (const items of columnBuckets.values()) {
		for (const item of items) visibleIds.add(item.entry.id);
	}

	const collapsed = collapseEdgeCandidates(layoutLinks, visibleIds);
	const edges: LayoutEdge[] = [];
	const edgePairKeys = new Set<string>();

	function undirectedEdgeKey(a: string, b: string): string {
		return a < b ? `${a}|${b}` : `${b}|${a}`;
	}

	function addLayoutEdge(
		source: string,
		target: string,
		rel?: LinkRelation,
		linkId?: string,
		count = 1
	) {
		if (!visibleIds.has(source) || !visibleIds.has(target) || source === target) return;
		const pairKey = undirectedEdgeKey(source, target);
		if (edgePairKeys.has(pairKey)) return;
		edgePairKeys.add(pairKey);

		edges.push({
			id: linkId ?? `e-${source}-${target}-${rel ?? 'rel'}`,
			source,
			target,
			rel,
			count,
			label: relLabel(rel, count)
		});
	}

	function pairEdge(collapsed: CollapsedEdge[], a: string, b: string): CollapsedEdge | undefined {
		return collapsed.find(
			(edge) => (edge.source === a && edge.target === b) || (edge.source === b && edge.target === a)
		);
	}

	for (const dep of dependsOn) {
		const collapsedEdge = pairEdge(collapsed, focusNodeId, dep.id);
		addLayoutEdge(
			focusNodeId,
			dep.id,
			collapsedEdge?.rel ?? dep.rel,
			collapsedEdge?.linkId ?? `e-dep-${dep.id}`,
			collapsedEdge?.count ?? 1
		);
	}

	for (const dep of requiredBy) {
		const collapsedEdge = pairEdge(collapsed, focusNodeId, dep.id);
		addLayoutEdge(
			dep.id,
			focusNodeId,
			collapsedEdge?.rel ?? dep.rel,
			collapsedEdge?.linkId ?? `e-req-${dep.id}`,
			collapsedEdge?.count ?? 1
		);
	}

	if (pathNodeIds.length >= 2) {
		for (let i = 0; i < pathNodeIds.length - 1; i++) {
			const from = pathNodeIds[i];
			const to = pathNodeIds[i + 1];
			const collapsedEdge = pairEdge(collapsed, from, to);
			addLayoutEdge(
				from,
				to,
				collapsedEdge?.rel ?? relForPathPair(layoutLinks, from, to),
				collapsedEdge?.linkId ?? `e-path-${from}-${to}`,
				collapsedEdge?.count ?? 1
			);
		}
	}

	const displayPairs = edges.map((edge) => ({ source: edge.source, target: edge.target }));
	const sortedCols = [...columnBuckets.keys()].sort((a, b) => a - b);
	let prevColumnOrder = [focusNodeId];

	for (const col of sortedCols) {
		const ordered = sortColumnByConnectivity(
			graph,
			columnBuckets.get(col) ?? [],
			prevColumnOrder,
			displayPairs
		);
		columnBuckets.set(col, ordered);
		prevColumnOrder = ordered.map((item) => item.entry.id);
	}

	const maxColHeight = [...columnBuckets.values()].reduce(
		(max, items) => Math.max(max, columnStackHeight(graph, items)),
		NODE_HEIGHT
	);
	const focusCol = focusColumnIndex(hasDependents);
	const focusX = focusCol * COLUMN_WIDTH;
	const focusY = (maxColHeight - NODE_HEIGHT) / 2;
	const focusCenterY = focusY + NODE_HEIGHT / 2;
	const focusPathIdx = pathNodeIds.indexOf(focusNodeId);

	const nodes: LayoutNode[] = [];
	nodes.push(
		buildFlowNode(graph, null, focusNodeId, 'focus', { x: focusX, y: focusY }, themeMode)
	);

	for (const col of sortedCols) {
		const items = columnBuckets.get(col) ?? [];
		const groups = groupColumnItems(graph, items);
		const totalHeight = columnStackHeight(graph, items);
		let yCursor = focusCenterY - totalHeight / 2;

		for (let gi = 0; gi < groups.length; gi++) {
			const group = groups[gi]!;
			for (const item of group.items) {
				const pathIdx = pathNodeIds.indexOf(item.entry.id);
				const offscreenX =
					pathOnlyIds.has(item.entry.id) && focusPathIdx >= 0 && pathIdx >= 0 && pathIdx < focusPathIdx
						? PATH_BREADCRUMB_OFFSCREEN_X * (focusPathIdx - pathIdx)
						: col * COLUMN_WIDTH;
				nodes.push(
					buildFlowNode(graph, item.entry, focusNodeId, item.role, {
						x: offscreenX,
						y: yCursor
					}, themeMode)
				);
				yCursor += ROW_STEP;
			}
			if (gi < groups.length - 1) yCursor += GROUP_GAP;
		}
	}

	const columnLabels: string[] = [];

	return { nodes, edges, isEmpty: false, columnLabels };
}
