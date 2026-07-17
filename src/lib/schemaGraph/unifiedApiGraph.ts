import {
	buildPathBrowserData,
	getOperationDeepLinkId,
	type HttpMethod,
	type OpenApiOperation
} from '$lib/openapi/pathBrowser';
import { refName } from '$lib/openapi/schemaBrowser';
import { buildSchemaGraph, type SchemaGraph } from './buildSchemaGraph';
import { walkSchema } from './walkSchema';

export type GraphNodeKind = 'path' | 'schema';

export type UnifiedGraphNode = {
	id: string;
	kind: GraphNodeKind;
	label: string;
	method?: HttpMethod;
	path?: string;
	operationId?: string;
	tags?: string[];
	schemaName?: string;
	isRecursive?: boolean;
};

export type UnifiedGraphEdgeKind = 'schema-ref' | 'request-body' | 'response' | 'parameter';

export type UnifiedGraphEdge = {
	id: string;
	source: string;
	target: string;
	kind: UnifiedGraphEdgeKind;
	viaProperty?: string;
	statusCode?: string;
	isBackEdge?: boolean;
};

export type UnifiedApiGraph = {
	nodes: UnifiedGraphNode[];
	edges: UnifiedGraphEdge[];
	leafPathsBySchema: Record<string, string[]>;
};

const SCHEMA_REF_PREFIX = '#/components/schemas/';

export function operationNodeId(method: string, path: string): string {
	return `operation:${method.toLowerCase()}:${path}`;
}

export function schemaNodeId(schemaName: string): string {
	return `schema:${schemaName}`;
}

export function schemaNameFromNodeId(nodeId: string): string | undefined {
	return nodeId.startsWith('schema:') ? nodeId.slice('schema:'.length) : undefined;
}

function extractComponentSchemaRefTarget(node: unknown): string | null {
	if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
	const obj = node as Record<string, unknown>;
	const keys = Object.keys(obj);
	if (keys.length !== 1 || keys[0] !== '$ref') return null;
	const ref = obj.$ref;
	if (typeof ref !== 'string') return null;
	if (ref.startsWith(SCHEMA_REF_PREFIX)) return ref.slice(SCHEMA_REF_PREFIX.length);
	const name = refName(ref);
	return name || null;
}

function stringifyWalkerPath(segments: string[]): string {
	if (segments.length === 0) return '';
	let out = segments[0] ?? '';
	for (let i = 1; i < segments.length; i++) {
		const seg = segments[i]!;
		if (seg === '[]') out += '[]';
		else out += `.${seg}`;
	}
	return out;
}

function collectSchemaRefsFromSchemaNode(
	node: unknown,
	kind: Exclude<UnifiedGraphEdgeKind, 'schema-ref'>,
	statusCode?: string
): Array<{ schemaName: string; viaProperty: string; statusCode?: string }> {
	const hits: Array<{ schemaName: string; viaProperty: string; statusCode?: string }> = [];
	const seen = new Set<string>();

	walkSchema(node, (currentPath, currentNode) => {
		const target = extractComponentSchemaRefTarget(currentNode);
		if (!target) return;
		const viaProperty = stringifyWalkerPath(currentPath);
		const key = `${target}|${viaProperty}|${statusCode ?? ''}`;
		if (seen.has(key)) return;
		seen.add(key);
		hits.push({ schemaName: target, viaProperty, statusCode });
	});

	// If walk found nothing but node is a direct $ref, still capture it.
	if (hits.length === 0) {
		const direct = extractComponentSchemaRefTarget(node);
		if (direct) {
			hits.push({ schemaName: direct, viaProperty: '', statusCode });
		}
	}

	return hits.map((h) => ({ ...h, statusCode }));
}

function collectOperationSchemaRefs(
	operation: OpenApiOperation
): Array<{ schemaName: string; kind: UnifiedGraphEdgeKind; viaProperty?: string; statusCode?: string }> {
	const refs: Array<{
		schemaName: string;
		kind: UnifiedGraphEdgeKind;
		viaProperty?: string;
		statusCode?: string;
	}> = [];
	const seen = new Set<string>();

	const add = (
		schemaName: string,
		kind: UnifiedGraphEdgeKind,
		viaProperty?: string,
		statusCode?: string
	) => {
		const key = `${kind}|${schemaName}|${viaProperty ?? ''}|${statusCode ?? ''}`;
		if (seen.has(key)) return;
		seen.add(key);
		refs.push({ schemaName, kind, viaProperty, statusCode });
	};

	for (const param of operation.parameters) {
		if (!param.schema) continue;
		for (const hit of collectSchemaRefsFromSchemaNode(param.schema, 'parameter')) {
			add(hit.schemaName, 'parameter', hit.viaProperty || param.name, undefined);
		}
	}

	if (operation.requestBody) {
		for (const media of operation.requestBody.content) {
			if (!media.schema) continue;
			for (const hit of collectSchemaRefsFromSchemaNode(media.schema, 'request-body')) {
				add(hit.schemaName, 'request-body', hit.viaProperty || 'requestBody', undefined);
			}
		}
	}

	for (const response of operation.responses) {
		for (const media of response.content) {
			if (!media.schema) continue;
			for (const hit of collectSchemaRefsFromSchemaNode(media.schema, 'response')) {
				// Prefer nested property path; never fall back to status (avoids "default"·"default")
				add(
					hit.schemaName,
					'response',
					hit.viaProperty || undefined,
					response.status
				);
			}
		}
	}

	return refs;
}

function pathNodeLabel(operation: OpenApiOperation): string {
	const method = operation.method.toUpperCase();
	const opId = operation.operationId ? ` · ${operation.operationId}` : '';
	return `${method} ${operation.path}${opId}`;
}

function buildSchemaNodesAndEdges(schemaGraph: SchemaGraph): {
	nodes: UnifiedGraphNode[];
	edges: UnifiedGraphEdge[];
} {
	const nodes: UnifiedGraphNode[] = schemaGraph.nodes.map((n) => ({
		id: schemaNodeId(n.name),
		kind: 'schema',
		label: n.name,
		schemaName: n.name,
		isRecursive: n.isRecursive
	}));

	const edges: UnifiedGraphEdge[] = schemaGraph.edges.map((e) => ({
		id: `schema-ref:${e.source}->${e.target}@${e.viaProperty}`,
		source: schemaNodeId(e.source),
		target: schemaNodeId(e.target),
		kind: 'schema-ref',
		viaProperty: e.viaProperty,
		isBackEdge: e.isBackEdge
	}));

	return { nodes, edges };
}

function buildPathNodesAndEdges(
	operations: OpenApiOperation[]
): { nodes: UnifiedGraphNode[]; edges: UnifiedGraphEdge[] } {
	const nodes: UnifiedGraphNode[] = [];
	const edges: UnifiedGraphEdge[] = [];

	for (const op of operations) {
		const id = operationNodeId(op.method, op.path);
		nodes.push({
			id,
			kind: 'path',
			label: pathNodeLabel(op),
			method: op.method,
			path: op.path,
			operationId: getOperationDeepLinkId(op),
			tags: op.tags
		});

		for (const ref of collectOperationSchemaRefs(op)) {
			edges.push({
				id: `${ref.kind}:${id}->${schemaNodeId(ref.schemaName)}@${ref.viaProperty ?? ''}@${ref.statusCode ?? ''}`,
				source: id,
				target: schemaNodeId(ref.schemaName),
				kind: ref.kind,
				viaProperty: ref.viaProperty,
				statusCode: ref.statusCode
			});
		}
	}

	return { nodes, edges };
}

function mergeNodes(...groups: UnifiedGraphNode[][]): UnifiedGraphNode[] {
	const byId = new Map<string, UnifiedGraphNode>();
	for (const group of groups) {
		for (const node of group) {
			const existing = byId.get(node.id);
			if (!existing) {
				byId.set(node.id, node);
				continue;
			}
			if (node.kind === 'schema' && existing.kind === 'schema') {
				byId.set(node.id, {
					...existing,
					isRecursive: existing.isRecursive || node.isRecursive
				});
			}
		}
	}
	return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function sortEdges(edges: UnifiedGraphEdge[]): UnifiedGraphEdge[] {
	return [...edges].sort(
		(a, b) =>
			a.source.localeCompare(b.source) ||
			a.target.localeCompare(b.target) ||
			a.kind.localeCompare(b.kind) ||
			(a.viaProperty ?? '').localeCompare(b.viaProperty ?? '') ||
			(a.statusCode ?? '').localeCompare(b.statusCode ?? '')
	);
}

/**
 * Build a unified OpenAPI graph: path/operation nodes, component schema nodes,
 * schema $ref edges, and operation→schema usage edges.
 */
export function buildUnifiedApiGraph(spec: Record<string, unknown>): UnifiedApiGraph {
	const components = spec.components as Record<string, unknown> | undefined;
	const schemas = (components?.schemas as Record<string, unknown> | undefined) ?? {};
	const schemaGraph = buildSchemaGraph(schemas);
	const { tagGroups } = buildPathBrowserData(spec);
	const operations = tagGroups.flatMap((g) => g.operations);

	const schemaPart = buildSchemaNodesAndEdges(schemaGraph);
	const pathPart = buildPathNodesAndEdges(operations);

	// Ensure path-connected schemas exist even if absent from components.schemas keys.
	const nodes = mergeNodes(schemaPart.nodes, pathPart.nodes);
	const nodeIds = new Set(nodes.map((n) => n.id));
	for (const edge of pathPart.edges) {
		if (!nodeIds.has(edge.target)) {
			const schemaName = schemaNameFromNodeId(edge.target)!;
			nodes.push({
				id: edge.target,
				kind: 'schema',
				label: schemaName,
				schemaName,
				isRecursive: false
			});
			nodeIds.add(edge.target);
		}
	}
	nodes.sort((a, b) => a.id.localeCompare(b.id));

	return {
		nodes,
		edges: sortEdges([...schemaPart.edges, ...pathPart.edges]),
		leafPathsBySchema: schemaGraph.leafPathsBySchema
	};
}
