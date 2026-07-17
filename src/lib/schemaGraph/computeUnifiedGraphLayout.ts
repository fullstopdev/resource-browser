import { classifySchemaName } from '$lib/openapi/schemaPresentation';
import type { UnifiedApiGraph, UnifiedGraphEdge, UnifiedGraphNode } from './unifiedApiGraph';
import { schemaNameFromNodeId } from './unifiedApiGraph';

export type GraphViewMode = 'schema-deps' | 'api-map';

export type UnifiedGraphLayoutNode = {
	id: string;
	kind: UnifiedGraphNode['kind'];
	label: string;
	schemaName?: string;
	isRecursive?: boolean;
	method?: string;
	path?: string;
	operationId?: string;
	tags?: string[];
	level: number;
	indexInLevel: number;
};

export type UnifiedGraphLayoutEdge = {
	id: string;
	source: string;
	target: string;
	kind: UnifiedGraphEdge['kind'];
	viaProperty?: string;
	statusCode?: string;
	isBackEdge?: boolean;
	label: string;
};

export type UnifiedGraphLayout = {
	mode: GraphViewMode;
	rootSchema?: string;
	nodes: UnifiedGraphLayoutNode[];
	edges: UnifiedGraphLayoutEdge[];
};

/** Horizontal stride between BFS columns (node card + routing lane). */
export const SCHEMA_DEPS_X_SPACING = 560;
/** Vertical stride between sibling nodes in a column. */
export const SCHEMA_DEPS_Y_SPACING = 128;
/** Horizontal gap for API map bipartite path→schema layout. */
export const API_MAP_X_SPACING = 680;
/** Vertical stride for API map operation/schema cards. */
export const API_MAP_Y_SPACING = 118;
/** Fixed schema card width — sized for typical OpenAPI schema names without ellipsis. */
export const SCHEMA_NODE_WIDTH_PX = 280;
/** Path/operation cards in API map (slightly wider for method + path). */
export const PATH_NODE_WIDTH_PX = 320;

const BARYCENTER_ITERATIONS = 4;

/**
 * Count pairwise crossings between two adjacent layers given a forward edge list
 * and the ordered node ids in each layer. Used for tests and layout quality checks.
 */
export function countLayerCrossings(
	leftOrder: string[],
	rightOrder: string[],
	edges: Array<{ source: string; target: string }>
): number {
	const leftIndex = new Map(leftOrder.map((id, i) => [id, i]));
	const rightIndex = new Map(rightOrder.map((id, i) => [id, i]));
	const pairs: Array<[number, number]> = [];
	for (const e of edges) {
		const li = leftIndex.get(e.source);
		const ri = rightIndex.get(e.target);
		if (li === undefined || ri === undefined) continue;
		pairs.push([li, ri]);
	}
	let crossings = 0;
	for (let i = 0; i < pairs.length; i++) {
		for (let j = i + 1; j < pairs.length; j++) {
			const [aL, aR] = pairs[i]!;
			const [bL, bR] = pairs[j]!;
			if ((aL - bL) * (aR - bR) < 0) crossings += 1;
		}
	}
	return crossings;
}

function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Layered barycenter heuristic (Sugiyama-style): alternate forward/backward passes
 * so siblings align under their parents and edge crossings drop. Deterministic via
 * localeCompare tie-breaks.
 */
export function orderLevelsByBarycenter(
	levels: Map<number, string[]>,
	forwardEdges: Array<{ source: string; target: string }>,
	iterations = BARYCENTER_ITERATIONS
): Map<number, string[]> {
	const levelKeys = [...levels.keys()].sort((a, b) => a - b);
	if (levelKeys.length === 0) return new Map();

	const order = new Map<number, string[]>();
	for (const level of levelKeys) {
		order.set(level, [...(levels.get(level) ?? [])].sort((a, b) => a.localeCompare(b)));
	}

	const maxLevel = levelKeys[levelKeys.length - 1]!;

	for (let iter = 0; iter < iterations; iter++) {
		// Forward: place each node near the mean of its parents in the previous column.
		for (let level = 1; level <= maxLevel; level++) {
			const prev = order.get(level - 1) ?? [];
			const prevIndex = new Map(prev.map((id, i) => [id, i]));
			const bucket = order.get(level) ?? [];
			const scored = bucket.map((id) => {
				const parents: number[] = [];
				for (const e of forwardEdges) {
					if (e.target !== id) continue;
					const pi = prevIndex.get(e.source);
					if (pi !== undefined) parents.push(pi);
				}
				return {
					id,
					bc: parents.length > 0 ? mean(parents) : (prev.length - 1) / 2
				};
			});
			scored.sort((a, b) => a.bc - b.bc || a.id.localeCompare(b.id));
			order.set(
				level,
				scored.map((s) => s.id)
			);
		}

		// Backward: nudge earlier columns toward the mean of their children.
		for (let level = maxLevel - 1; level >= 0; level--) {
			const next = order.get(level + 1) ?? [];
			const nextIndex = new Map(next.map((id, i) => [id, i]));
			const bucket = order.get(level) ?? [];
			const scored = bucket.map((id) => {
				const children: number[] = [];
				for (const e of forwardEdges) {
					if (e.source !== id) continue;
					const ci = nextIndex.get(e.target);
					if (ci !== undefined) children.push(ci);
				}
				return {
					id,
					bc: children.length > 0 ? mean(children) : (next.length - 1) / 2
				};
			});
			scored.sort((a, b) => a.bc - b.bc || a.id.localeCompare(b.id));
			order.set(
				level,
				scored.map((s) => s.id)
			);
		}
	}

	return order;
}

/** Estimate card width so the longest schema name fits without ellipsis. */
export function estimateSchemaNodeWidthPx(labels: string[]): number {
	const CHAR_PX = 8.4;
	const PAD_PX = 52;
	const MIN = 260;
	const MAX = 340;
	let longest = 0;
	for (const label of labels) {
		if (label.length > longest) longest = label.length;
	}
	return Math.min(MAX, Math.max(MIN, Math.ceil(longest * CHAR_PX) + PAD_PX));
}

function sortedOutgoing(edges: UnifiedGraphEdge[]): Map<string, UnifiedGraphEdge[]> {
	const outgoing = new Map<string, UnifiedGraphEdge[]>();
	for (const e of edges) {
		const list = outgoing.get(e.source) ?? [];
		list.push(e);
		outgoing.set(e.source, list);
	}
	for (const [src, list] of outgoing.entries()) {
		list.sort(
			(a, b) =>
				a.target.localeCompare(b.target) ||
				a.kind.localeCompare(b.kind) ||
				(a.viaProperty ?? '').localeCompare(b.viaProperty ?? '')
		);
		outgoing.set(src, list);
	}
	return outgoing;
}

function edgeLabel(edge: UnifiedGraphEdge): string {
	if (edge.kind === 'schema-ref') return edge.viaProperty || 'ref';
	if (edge.kind === 'request-body') {
		if (!edge.viaProperty || edge.viaProperty === 'requestBody') return 'request';
		// Skip media-type noise (application/json)
		if (edge.viaProperty.includes('/')) return 'request';
		return `request · ${edge.viaProperty}`;
	}
	if (edge.kind === 'response') {
		const code = edge.statusCode || 'response';
		const via = edge.viaProperty?.trim() || '';
		// status "default" + viaProperty fallback "default" produced "default · default"
		if (!via || via === code || via.includes('/')) {
			return code === 'default' ? 'default' : code;
		}
		return `${code} · ${via}`;
	}
	if (edge.kind === 'parameter') return edge.viaProperty ? `param · ${edge.viaProperty}` : 'parameter';
	return '';
}

function toLayoutEdge(edge: UnifiedGraphEdge): UnifiedGraphLayoutEdge {
	return {
		id: edge.id,
		source: edge.source,
		target: edge.target,
		kind: edge.kind,
		viaProperty: edge.viaProperty,
		statusCode: edge.statusCode,
		isBackEdge: edge.isBackEdge,
		label: edgeLabel(edge)
	};
}

function nodeById(graph: UnifiedApiGraph): Map<string, UnifiedGraphNode> {
	return new Map(graph.nodes.map((n) => [n.id, n]));
}

function computeSchemaSubtree(
	graph: UnifiedApiGraph,
	rootSchemaName: string,
	showAllSchemas: boolean
): { visibleNodeIds: Set<string>; visibleEdges: UnifiedGraphEdge[] } {
	const rootId = `schema:${rootSchemaName}`;
	const schemaRefEdges = graph.edges.filter((e) => e.kind === 'schema-ref');

	if (showAllSchemas) {
		const visibleNodeIds = new Set(
			graph.nodes.filter((n) => n.kind === 'schema').map((n) => n.id)
		);
		return { visibleNodeIds, visibleEdges: schemaRefEdges };
	}

	const outgoing = sortedOutgoing(schemaRefEdges);
	const visibleNodeIds = new Set<string>([rootId]);
	const visibleEdges: UnifiedGraphEdge[] = [];
	const visited = new Set<string>([rootId]);
	const queue = [rootId];

	while (queue.length > 0) {
		const source = queue.shift()!;
		for (const edge of outgoing.get(source) ?? []) {
			visibleEdges.push(edge);
			if (edge.isBackEdge) continue;
			if (visited.has(edge.target)) continue;
			visited.add(edge.target);
			visibleNodeIds.add(edge.target);
			queue.push(edge.target);
		}
	}

	return { visibleNodeIds, visibleEdges };
}

export function computeSchemaDepsLayout(
	graph: UnifiedApiGraph,
	rootSchemaName: string,
	showAllSchemas = false
): UnifiedGraphLayout {
	const nodes = nodeById(graph);
	const rootId = `schema:${rootSchemaName}`;
	if (!nodes.has(rootId)) {
		return { mode: 'schema-deps', rootSchema: rootSchemaName, nodes: [], edges: [] };
	}

	const { visibleNodeIds, visibleEdges } = computeSchemaSubtree(
		graph,
		rootSchemaName,
		showAllSchemas
	);

	const dist = new Map<string, number>();
	dist.set(rootId, 0);
	const queue = [rootId];
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

	// Show-all includes schemas outside the root BFS tree — layer those by
	// longest path from any already-leveled predecessor (or from in-degree 0).
	if (showAllSchemas) {
		const incoming = new Map<string, string[]>();
		for (const e of visibleEdges) {
			if (e.isBackEdge) continue;
			const list = incoming.get(e.target) ?? [];
			list.push(e.source);
			incoming.set(e.target, list);
		}
		let changed = true;
		let guard = 0;
		while (changed && guard++ < visibleNodeIds.size + 2) {
			changed = false;
			for (const id of visibleNodeIds) {
				const preds = (incoming.get(id) ?? []).filter((p) => dist.has(p));
				if (preds.length === 0) {
					if (!dist.has(id)) {
						dist.set(id, 0);
						changed = true;
					}
					continue;
				}
				const next = Math.max(...preds.map((p) => dist.get(p)!)) + 1;
				const cur = dist.get(id);
				if (cur === undefined || next > cur) {
					dist.set(id, next);
					changed = true;
				}
			}
		}
		for (const id of visibleNodeIds) {
			if (!dist.has(id)) dist.set(id, 0);
		}
	}

	const levels = new Map<number, string[]>();
	for (const id of visibleNodeIds) {
		const level = dist.get(id) ?? 0;
		const bucket = levels.get(level) ?? [];
		bucket.push(id);
		levels.set(level, bucket);
	}

	const forwardPairs = visibleEdges
		.filter((e) => !e.isBackEdge)
		.map((e) => ({ source: e.source, target: e.target }));
	const orderedLevels = orderLevelsByBarycenter(levels, forwardPairs);

	const layoutNodes: UnifiedGraphLayoutNode[] = [];
	for (const level of [...orderedLevels.keys()].sort((a, b) => a - b)) {
		const bucket = orderedLevels.get(level) ?? [];
		bucket.forEach((id, indexInLevel) => {
			const node = nodes.get(id)!;
			layoutNodes.push({
				id: node.id,
				kind: node.kind,
				label: node.label,
				schemaName: node.schemaName,
				isRecursive: node.isRecursive,
				method: node.method,
				path: node.path,
				operationId: node.operationId,
				tags: node.tags,
				level,
				indexInLevel
			});
		});
	}

	return {
		mode: 'schema-deps',
		rootSchema: rootSchemaName,
		nodes: layoutNodes,
		edges: visibleEdges.map(toLayoutEdge)
	};
}

export function computeApiMapLayout(
	graph: UnifiedApiGraph,
	options?: {
		tagFilter?: string;
		pathId?: string;
		schemaFocus?: string;
		/** When set, only include these usage edge kinds (request/response/parameter). */
		edgeKinds?: Array<'request-body' | 'response' | 'parameter'>;
	}
): UnifiedGraphLayout {
	const tagFilter = options?.tagFilter?.trim();
	const pathId = options?.pathId?.trim();
	const schemaFocus = options?.schemaFocus?.trim();
	// undefined = all kinds; empty array = none
	const allowedKinds =
		options?.edgeKinds === undefined ? null : new Set(options.edgeKinds);

	// Include every path for the tag (even with no usage edges) so the Operation
	// dropdown stays populated; schemaFocus must not empty the path list.
	let pathNodes = listApiMapOperations(graph, tagFilter);

	if (pathId) {
		const focused = pathNodes.filter((n) => n.id === pathId);
		if (focused.length > 0) pathNodes = focused;
	}

	const pathIds = new Set(pathNodes.map((n) => n.id));

	// Strict bipartite: path → schema usage only (no schema-ref expansion).
	const usageEdges = graph.edges.filter(
		(e) =>
			e.kind !== 'schema-ref' &&
			pathIds.has(e.source) &&
			(!allowedKinds || allowedKinds.has(e.kind as 'request-body' | 'response' | 'parameter'))
	);

	let visibleSchemaIds = new Set(usageEdges.map((e) => e.target));
	// Keep selected path nodes even when they have no request/response/parameter edges.
	let visiblePathIds = new Set(pathIds);

	if (schemaFocus && !pathId) {
		const focusId = `schema:${schemaFocus}`;
		const linkedSources = new Set(
			usageEdges.filter((e) => e.target === focusId).map((e) => e.source)
		);
		// Only narrow when at least one path in this tag uses the schema directly.
		if (linkedSources.size > 0) {
			visibleSchemaIds = new Set([focusId]);
			visiblePathIds = linkedSources;
		}
	}

	const filteredPaths = pathNodes.filter((n) => visiblePathIds.has(n.id));
	const filteredPathIndex = new Map(filteredPaths.map((n, i) => [n.id, i]));

	const visibleEdges = usageEdges.filter(
		(e) => visiblePathIds.has(e.source) && visibleSchemaIds.has(e.target)
	);

	// Barycenter Y for schemas from connected path rows → mostly-horizontal edges.
	const schemaBary = new Map<string, number>();
	const schemaDegree = new Map<string, number>();
	for (const e of visibleEdges) {
		const pi = filteredPathIndex.get(e.source);
		if (pi === undefined) continue;
		schemaBary.set(e.target, (schemaBary.get(e.target) ?? 0) + pi);
		schemaDegree.set(e.target, (schemaDegree.get(e.target) ?? 0) + 1);
	}

	const nodeLookup = nodeById(graph);
	const schemaNodes = [...visibleSchemaIds]
		.map((id) => nodeLookup.get(id))
		.filter((n): n is UnifiedGraphNode => Boolean(n))
		.map((node) => {
			const deg = schemaDegree.get(node.id) ?? 1;
			const bary = (schemaBary.get(node.id) ?? 0) / deg;
			return { node, bary };
		})
		.sort((a, b) => a.bary - b.bary || a.node.label.localeCompare(b.node.label));

	// Sequential rows after barycenter sort — keeps cards evenly spaced.
	const pathLayoutNodes: UnifiedGraphLayoutNode[] = filteredPaths.map((node, indexInLevel) => ({
		id: node.id,
		kind: node.kind,
		label: node.label,
		schemaName: node.schemaName,
		isRecursive: node.isRecursive,
		method: node.method,
		path: node.path,
		operationId: node.operationId,
		tags: node.tags,
		level: 0,
		indexInLevel
	}));

	const schemaLayoutNodes: UnifiedGraphLayoutNode[] = schemaNodes.map(({ node }, i) => ({
		id: node.id,
		kind: node.kind,
		label: node.label,
		schemaName: node.schemaName,
		isRecursive: node.isRecursive,
		method: node.method,
		path: node.path,
		operationId: node.operationId,
		tags: node.tags,
		level: 1,
		indexInLevel: i
	}));

	// Deduplicate usage edges path→schema (keep one label per pair, prefer response/request).
	const edgeByPair = new Map<string, UnifiedGraphEdge>();
	const kindRank: Record<string, number> = {
		'request-body': 0,
		response: 1,
		parameter: 2
	};
	for (const e of visibleEdges) {
		const key = `${e.source}->${e.target}`;
		const prev = edgeByPair.get(key);
		if (!prev || (kindRank[e.kind] ?? 9) < (kindRank[prev.kind] ?? 9)) {
			edgeByPair.set(key, e);
		}
	}

	return {
		mode: 'api-map',
		nodes: [...pathLayoutNodes, ...schemaLayoutNodes],
		edges: [...edgeByPair.values()].map(toLayoutEdge)
	};
}

/** Preferred Schema Graph roots for the core API (EQL / query surface). */
export const CORE_EQL_QUICK_PICK_SCHEMAS = [
	'QueryEqlParsed',
	'QueryResponse',
	'QueryWhereParsed',
	'CompletionsQuery'
] as const;

export type DefaultSchemaRootPick = {
	root: string;
	/** When the best forward subtree is tiny, enable "Show all schemas". */
	preferShowAll: boolean;
};

function listSchemaNames(graph: UnifiedApiGraph): string[] {
	const names: string[] = [];
	for (const n of graph.nodes) {
		if (n.kind !== 'schema') continue;
		const name = n.schemaName ?? schemaNameFromNodeId(n.id) ?? '';
		if (name) names.push(name);
	}
	return names;
}

/** Forward (non-back-edge) schema-$ref BFS size from a root, including the root. */
export function countForwardSchemaSubtree(graph: UnifiedApiGraph, rootSchemaName: string): number {
	const rootId = `schema:${rootSchemaName}`;
	if (!graph.nodes.some((n) => n.id === rootId)) return 0;

	const outgoing = new Map<string, string[]>();
	for (const e of graph.edges) {
		if (e.kind !== 'schema-ref' || e.isBackEdge) continue;
		const list = outgoing.get(e.source) ?? [];
		list.push(e.target);
		outgoing.set(e.source, list);
	}

	const visited = new Set<string>([rootId]);
	const queue = [rootId];
	while (queue.length > 0) {
		const source = queue.shift()!;
		for (const target of outgoing.get(source) ?? []) {
			if (visited.has(target)) continue;
			visited.add(target);
			queue.push(target);
		}
	}
	return visited.size;
}

function countOutgoingSchemaRefs(graph: UnifiedApiGraph, rootSchemaName: string): number {
	const rootId = `schema:${rootSchemaName}`;
	let count = 0;
	for (const e of graph.edges) {
		if (e.kind !== 'schema-ref' || e.isBackEdge) continue;
		if (e.source === rootId) count += 1;
	}
	return count;
}

function countPathConnections(graph: UnifiedApiGraph, rootSchemaName: string): number {
	const rootId = `schema:${rootSchemaName}`;
	let count = 0;
	for (const e of graph.edges) {
		if (e.kind === 'schema-ref') continue;
		if (e.target === rootId) count += 1;
	}
	return count;
}

/**
 * Platform DTOs (Resource / Topology / Status / Topo*) are copied into every app
 * OpenAPI document. Their $ref trees are often the largest in the file, so ranking
 * purely by forward subtree size makes every Application API default to
 * ResourceTopology — not the app's CRD schemas.
 */
function isInlinedPlatformSchema(schemaName: string): boolean {
	const base = schemaName.includes('.')
		? (schemaName.split('.').pop() ?? schemaName)
		: schemaName;
	return /^(Resource(List|History|HistoryEntry|Topology)?|Topology|K8STopologyRequest|OverlayState|Topo[A-Z]\w*|Status(Details)?|IntentTarget(s)?|UIResult)$/.test(
		base
	);
}

/**
 * Infer the dotted OpenAPI package prefix shared by an Application API's FQDN CRDs
 * (e.g. `com.nokia.eda.flowsampling.v1alpha1` from `…v1alpha1.SFlow`).
 *
 * Returns null for core / flat-DTO specs that have no FQDN CRD schemas.
 */
export function inferOwnedSchemaPrefix(schemaNames: string[]): string | null {
	const counts = new Map<string, number>();
	for (const name of schemaNames) {
		const lastDot = name.lastIndexOf('.');
		if (lastDot <= 0) continue;
		const prefix = name.slice(0, lastDot);
		if (!prefix.includes('.')) continue;
		counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
	}
	if (counts.size === 0) return null;

	let bestPrefix = '';
	let bestCount = 0;
	for (const [prefix, count] of counts) {
		if (count > bestCount || (count === bestCount && prefix.length > bestPrefix.length)) {
			bestPrefix = prefix;
			bestCount = count;
		}
	}
	return bestPrefix || null;
}

/**
 * ROOT dropdown options for Schema dependencies.
 *
 * When `showAllSchemas` is false and the spec has FQDN CRDs, only list schemas
 * owned by that API (name starts with the inferred package prefix). Platform /
 * shared DTOs inlined into every app OpenAPI (Resource, Topology, ErrorResponse,
 * AppGroup, …) are hidden until the user opts in via "Show all schemas".
 *
 * Core / flat specs (no FQDN prefix) always return the full list.
 */
export function listSchemaRootOptions(
	schemaNames: string[],
	showAllSchemas = false
): string[] {
	const sorted = [...schemaNames].sort((a, b) => a.localeCompare(b));
	if (showAllSchemas) return sorted;

	const prefix = inferOwnedSchemaPrefix(sorted);
	if (!prefix) return sorted;

	const owned = sorted.filter((name) => name.startsWith(`${prefix}.`));
	return owned.length > 0 ? owned : sorted;
}

/** Lower is better. Prefer domain CRDs over inlined platform Resource/Topology trees. */
function rootPreferenceRank(schemaName: string): number {
	const presentation = classifySchemaName(schemaName);
	if (presentation.category === 'crd') return 0;
	if (presentation.category === 'query') return 1;
	if (presentation.category === 'crd-list') return 8;
	if (presentation.isInternal || presentation.category === 'crd-internal') return 20;
	if (presentation.category === 'shared' || presentation.category === 'platform') return 12;
	if (isInlinedPlatformSchema(schemaName)) return 15;
	if (presentation.category === 'core-api') return 5;
	return 10;
}

function scoreSchemaRoot(graph: UnifiedApiGraph, name: string): {
	forward: number;
	outgoing: number;
	pathLinks: number;
	preference: number;
} {
	return {
		forward: countForwardSchemaSubtree(graph, name),
		outgoing: countOutgoingSchemaRefs(graph, name),
		pathLinks: countPathConnections(graph, name),
		preference: rootPreferenceRank(name)
	};
}

function compareRootScores(
	a: {
		name: string;
		forward: number;
		outgoing: number;
		pathLinks: number;
		preference: number;
	},
	b: {
		name: string;
		forward: number;
		outgoing: number;
		pathLinks: number;
		preference: number;
	}
): number {
	if (a.preference !== b.preference) return a.preference - b.preference;
	if (a.forward !== b.forward) return b.forward - a.forward;
	if (a.outgoing !== b.outgoing) return b.outgoing - a.outgoing;
	if (a.pathLinks !== b.pathLinks) return b.pathLinks - a.pathLinks;
	return a.name.localeCompare(b.name);
}

/**
 * Pick a useful Schema Graph root:
 * - Core: prefer QueryEqlParsed / EQL quick-picks when present
 * - App specs: prefer FQDN CRD schemas over inlined Resource/Topology platform trees
 *   (those shared DTOs often have the largest $ref fan-out and previously contaminated
 *   every Application API's default Schema dependencies view)
 * - Avoid hubs like ErrorResponse that every path references but have almost no forward children
 */
export function pickDefaultSchemaRoot(graph: UnifiedApiGraph): DefaultSchemaRootPick {
	const names = listSchemaNames(graph);
	if (names.length === 0) return { root: '', preferShowAll: false };

	const nameSet = new Set(names);
	const preferredPresent = CORE_EQL_QUICK_PICK_SCHEMAS.filter((n) => nameSet.has(n));
	if (preferredPresent.length > 0) {
		const ranked = preferredPresent
			.map((name) => ({ name, ...scoreSchemaRoot(graph, name) }))
			.sort(compareRootScores);
		const bestPreferred = ranked[0]!;
		if (bestPreferred.forward > 1) {
			return { root: bestPreferred.name, preferShowAll: false };
		}
		// Prefer QueryEqlParsed even if thin — still the right EQL entry point.
		const eql = preferredPresent.find((n) => n === 'QueryEqlParsed') ?? bestPreferred.name;
		const forward = countForwardSchemaSubtree(graph, eql);
		return { root: eql, preferShowAll: forward <= 1 && names.length > 1 };
	}

	const ranked = names
		.map((name) => ({ name, ...scoreSchemaRoot(graph, name) }))
		.sort(compareRootScores);

	const best = ranked[0]!;
	if (best.forward > 1) {
		return { root: best.name, preferShowAll: false };
	}

	// Avoid hubs with empty forward trees (ErrorResponse): try next-best with forward > 1.
	const withSubtree = ranked.find((r) => r.forward > 1);
	if (withSubtree) {
		return { root: withSubtree.name, preferShowAll: false };
	}

	return {
		root: best.name,
		preferShowAll: names.length > 1
	};
}

/** @deprecated Prefer {@link pickDefaultSchemaRoot} — in-degree hubs are poor roots. */
export function pickMostReferencedSchemaFromUnified(graph: UnifiedApiGraph): string {
	return pickDefaultSchemaRoot(graph).root;
}

/** Schemas to expose as Query & EQL quick-picks when present in this graph. */
export function listEqlQuickPickSchemas(graph: UnifiedApiGraph): string[] {
	const nameSet = new Set(listSchemaNames(graph));
	return CORE_EQL_QUICK_PICK_SCHEMAS.filter((n) => nameSet.has(n));
}

export function listApiMapTags(graph: UnifiedApiGraph): string[] {
	const tags = new Set<string>();
	for (const n of graph.nodes) {
		if (n.kind !== 'path') continue;
		for (const tag of n.tags ?? []) tags.add(tag);
	}
	return [...tags].sort((a, b) => a.localeCompare(b));
}

function sortApiMapPathNodes(a: UnifiedGraphNode, b: UnifiedGraphNode): number {
	const tagA = a.tags?.[0] ?? '';
	const tagB = b.tags?.[0] ?? '';
	const tagCmp = tagA.localeCompare(tagB);
	if (tagCmp !== 0) return tagCmp;
	const pathCmp = (a.path ?? '').localeCompare(b.path ?? '');
	if (pathCmp !== 0) return pathCmp;
	return (a.method ?? '').localeCompare(b.method ?? '');
}

/**
 * Path/operation nodes for the API map Operation dropdown.
 * Filtered by tag only — never by schemaFocus (that used to empty the list when
 * highlightSchema pointed at a nested $ref like QueryEqlParsed).
 */
export function listApiMapOperations(
	graph: UnifiedApiGraph,
	tagFilter?: string
): UnifiedGraphNode[] {
	const tag = tagFilter?.trim();
	return graph.nodes
		.filter((n) => n.kind === 'path')
		.filter((n) => !tag || (n.tags ?? []).includes(tag))
		.sort(sortApiMapPathNodes);
}

export type ApiMapSelection = {
	tagFilter: string;
	pathId: string;
};

/** Resolve an API-map path node by graph id or OpenAPI operation deep-link id. */
export function findApiMapPathNode(
	graph: UnifiedApiGraph,
	focus: string
): UnifiedGraphNode | undefined {
	const id = focus.trim();
	if (!id) return undefined;
	return graph.nodes.find(
		(n) => n.kind === 'path' && (n.id === id || n.operationId === id)
	);
}

/**
 * Default tag + first operation when entering API map or changing tag.
 * If schemaFocus is set, prefer an operation that directly uses that schema
 * (and its tag) when available — without wiping unrelated tag option lists.
 */
export function pickDefaultApiMapSelection(
	graph: UnifiedApiGraph,
	options?: { tagFilter?: string; schemaFocus?: string; currentPathId?: string }
): ApiMapSelection {
	const tags = listApiMapTags(graph);
	const schemaFocus = options?.schemaFocus?.trim();
	let tagFilter = options?.tagFilter?.trim() ?? '';

	if (schemaFocus && !tagFilter) {
		const focusId = `schema:${schemaFocus}`;
		const linked = graph.edges.filter(
			(e) => e.kind !== 'schema-ref' && e.target === focusId
		);
		if (linked.length > 0) {
			const pathById = new Map(
				graph.nodes.filter((n) => n.kind === 'path').map((n) => [n.id, n])
			);
			const preferred = linked
				.map((e) => pathById.get(e.source))
				.filter((n): n is UnifiedGraphNode => Boolean(n))
				.sort(sortApiMapPathNodes)[0];
			if (preferred) {
				tagFilter = preferred.tags?.[0] ?? '';
				return { tagFilter, pathId: preferred.id };
			}
		}
	}

	if (!tagFilter && tags.length > 0) tagFilter = tags[0]!;

	const ops = listApiMapOperations(graph, tagFilter || undefined);
	const currentPathId = options?.currentPathId?.trim() ?? '';
	if (currentPathId && ops.some((op) => op.id === currentPathId)) {
		return { tagFilter, pathId: currentPathId };
	}
	return { tagFilter, pathId: ops[0]?.id ?? '' };
}
