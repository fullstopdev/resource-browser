import { walkSchema } from './walkSchema';

export type SchemaGraphNode = {
	name: string;
	isRecursive: boolean;
};

export type SchemaGraphEdge = {
	source: string;
	target: string;
	viaProperty: string;
	isBackEdge: boolean;
};

export type SchemaGraph = {
	nodes: SchemaGraphNode[];
	edges: SchemaGraphEdge[];
	/**
	 * Leaf field paths (FIELDS-clause style: `spec.foo.bar`) per schema name.
	 * Populated for all schemas discovered in `schemas`.
	 */
	leafPathsBySchema: Record<string, string[]>;
};

export const TRUNCATED_CIRCULAR_REFERENCE = '<truncated: circular reference>';

function stringifyWalkerPath(segments: string[]): string {
	if (segments.length === 0) return '';
	let out = segments[0] ?? '';
	for (let i = 1; i < segments.length; i++) {
		const seg = segments[i]!;
		// Match the legacy schemaRefs path formatting exactly:
		// - items are appended as `[]` (no dot)
		// - additionalProperties uses `*` after a dot (e.g. `path.*`)
		if (seg === '[]') out += '[]';
		else out += `.${seg}`;
	}
	return out;
}

function extractComponentSchemaRefTarget(node: unknown): string | null {
	if (!node || typeof node !== 'object') return null;
	if (Array.isArray(node)) return null;
	const obj = node as Record<string, unknown>;
	const keys = Object.keys(obj);
	if (keys.length !== 1 || keys[0] !== '$ref') return null;
	const ref = obj.$ref;
	if (typeof ref !== 'string') return null;
	const prefix = '#/components/schemas/';
	if (!ref.startsWith(prefix)) return null;
	return ref.slice(prefix.length);
}

function sortedKeys(record: Record<string, unknown>): string[] {
	return Object.keys(record).sort((a, b) => a.localeCompare(b));
}

/**
 * Enumerate leaf field paths within a schema, following:
 * - `properties` keys using dot notation
 * - `$ref` expansion into `schemas`
 * - `items` traversal without adding `[]` segments (so arrays become `spec.foo.bar`)
 *
 * Cycle guard:
 * - if a schema name repeats in the current `$ref` expansion chain, stop recursion
 *   and add a truncation leaf at the repetition point.
 */
export function enumerateLeafPaths(
	schemas: Record<string, unknown>,
	rootSchemaName: string,
	maxDepth = 12
): string[] {
	const results = new Set<string>();
	const seenSchemaStack: string[] = [rootSchemaName];
	const visited = new Set<string>();

	const root = schemas[rootSchemaName];
	if (!root) return [];

	const addLeaf = (pathSegs: string[]) => {
		if (pathSegs.length === 0) return;
		results.add(pathSegs.join('.'));
	};

	const dfs = (node: unknown, pathSegs: string[], depth: number): void => {
		if (pathSegs.length > maxDepth) return;
		if (depth > maxDepth) return;

		const refTarget = extractComponentSchemaRefTarget(node);
		if (refTarget) {
			if (seenSchemaStack.includes(refTarget)) {
				results.add([...pathSegs, TRUNCATED_CIRCULAR_REFERENCE].join('.'));
				return;
			}
			const targetSchema = schemas[refTarget];
			if (!targetSchema || typeof targetSchema !== 'object') return;
			seenSchemaStack.push(refTarget);
			dfs(targetSchema, pathSegs, depth + 1);
			seenSchemaStack.pop();
			return;
		}

		if (!node || typeof node !== 'object') {
			addLeaf(pathSegs);
			return;
		}

		const obj = node as Record<string, unknown>;

		// Try composition branches first (they preserve the current property path).
		let traversed = false;
		for (const comb of ['allOf', 'anyOf', 'oneOf'] as const) {
			const arr = obj[comb];
			if (Array.isArray(arr)) {
				traversed = true;
				for (const el of arr) {
					dfs(el, pathSegs, depth + 1);
				}
			}
		}

		// Regular object properties.
		if (obj.properties && typeof obj.properties === 'object' && !Array.isArray(obj.properties)) {
			const props = obj.properties as Record<string, unknown>;
			traversed = true;
			for (const key of Object.keys(props).sort((a, b) => a.localeCompare(b))) {
				dfs(props[key], [...pathSegs, key], depth + 1);
			}
		}

		// Array items: traverse without adding `[]` to the path.
		if (obj.items) {
			traversed = true;
			dfs(obj.items, pathSegs, depth + 1);
		}

		// Map-ish additionalProperties: keys are unknown, so keep the current path as a leaf.
		if (obj.additionalProperties && typeof obj.additionalProperties === 'object') {
			traversed = true;
			addLeaf(pathSegs);
			return;
		}

		if (!traversed) {
			addLeaf(pathSegs);
		}
	};

	// Protect against pathological structures without `$ref` cycles.
	const dfsWithProtection = (node: unknown, pathSegs: string[], depth: number): void => {
		const sig = `${seenSchemaStack.join('|')}:${pathSegs.join('.')}:${depth}`;
		if (visited.has(sig)) return;
		visited.add(sig);
		dfs(node, pathSegs, depth);
	};

	dfsWithProtection(root, [], 0);
	return [...results].sort((a, b) => a.localeCompare(b));
}

function buildSchemaEdges(schemas: Record<string, unknown>): SchemaGraphEdge[] {
	const edges: SchemaGraphEdge[] = [];

	const sourceNames = sortedKeys(schemas);
	for (const source of sourceNames) {
		const schema = schemas[source];
		if (!schema) continue;

		walkSchema(schema, (currentPath, node) => {
			const target = extractComponentSchemaRefTarget(node);
			if (!target) return;

			const viaProperty = stringifyWalkerPath(currentPath);
			edges.push({
				source,
				target,
				viaProperty,
				isBackEdge: false
			});
		});
	}

	// Deterministic edges output order.
	edges.sort((a, b) => {
		return (
			a.source.localeCompare(b.source) ||
			a.target.localeCompare(b.target) ||
			a.viaProperty.localeCompare(b.viaProperty) ||
			0
		);
	});

	return edges;
}

function buildSchemaGraphCore(schemas: Record<string, unknown>): Omit<SchemaGraph, 'leafPathsBySchema'> {
	const edges = buildSchemaEdges(schemas);
	const nodeNames = new Set<string>(sortedKeys(schemas));
	for (const e of edges) nodeNames.add(e.target);
	const names = [...nodeNames].sort((a, b) => a.localeCompare(b));

	const nodes = names.map((name) => ({ name, isRecursive: false }));
	const nodeMap = new Map<string, { name: string; isRecursive: boolean }>(nodes.map((n) => [n.name, n]));

	const outgoing = new Map<string, SchemaGraphEdge[]>();
	for (const n of names) outgoing.set(n, []);
	for (const edge of edges) {
		if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
		outgoing.get(edge.source)!.push(edge);
	}
	for (const [src, list] of outgoing.entries()) {
		list.sort((a, b) => a.target.localeCompare(b.target) || a.viaProperty.localeCompare(b.viaProperty));
		outgoing.set(src, list);
	}

	const visited = new Set<string>();
	const inStack = new Set<string>();
	const stackArr: string[] = [];

	function markCurrentStackRecursive() {
		for (const n of stackArr) {
			nodeMap.get(n)!.isRecursive = true;
		}
	}

	function dfs(source: string) {
		visited.add(source);
		inStack.add(source);
		stackArr.push(source);

		const outs = outgoing.get(source) ?? [];
		for (const edge of outs) {
			const target = edge.target;
			if (inStack.has(target)) {
				edge.isBackEdge = true;
				markCurrentStackRecursive();
				continue;
			}
			if (!visited.has(target)) {
				dfs(target);
			}
		}

		stackArr.pop();
		inStack.delete(source);
	}

	for (const name of names) {
		if (!visited.has(name)) dfs(name);
	}

	return { nodes, edges };
}

export function buildSchemaGraph(schemas: Record<string, unknown>): SchemaGraph {
	const { nodes, edges } = buildSchemaGraphCore(schemas);
	const leafPathsBySchema: Record<string, string[]> = {};
	for (const n of nodes) {
		leafPathsBySchema[n.name] = enumerateLeafPaths(schemas, n.name);
	}
	return { nodes, edges, leafPathsBySchema };
}

