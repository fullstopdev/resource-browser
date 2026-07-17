import {
	buildInlineSchemaTree,
	describeSchemaType,
	refName,
	resolveSchemaNode,
	type JsonSchemaObject,
	type SchemaExplorerOptions,
	type SchemaPropertyNode
} from './schemaBrowser';

function asObject(value: unknown): JsonSchemaObject | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as JsonSchemaObject)
		: null;
}

function getComponentSchema(spec: Record<string, unknown>, name: string): JsonSchemaObject | null {
	const components = asObject(spec.components);
	const schemas = asObject(components?.schemas);
	return asObject(schemas?.[name]);
}

export interface SchemaResolver {
	resolve(schema: JsonSchemaObject, seen?: Set<string>): JsonSchemaObject;
	resolveRef(name: string): JsonSchemaObject | null;
	buildTree(schema: JsonSchemaObject): SchemaPropertyNode[];
	describe(schema: JsonSchemaObject): string;
}

/** Memoized, lazy-friendly schema resolver for operation detail panels. */
export function createSchemaResolver(
	spec: Record<string, unknown>,
	options: SchemaExplorerOptions = {}
): SchemaResolver {
	const refCache = new Map<string, JsonSchemaObject | null>();
	const treeCache = new Map<string, SchemaPropertyNode[]>();

	function resolveRef(name: string): JsonSchemaObject | null {
		if (refCache.has(name)) return refCache.get(name) ?? null;
		const schema = getComponentSchema(spec, name);
		refCache.set(name, schema);
		return schema;
	}

	function resolve(schema: JsonSchemaObject, seen = new Set<string>()): JsonSchemaObject {
		if (typeof schema.$ref === 'string') {
			const name = refName(schema.$ref);
			if (seen.has(name)) {
				return resolveSchemaNode(spec, schema, seen);
			}
			seen.add(name);
			const cached = resolveRef(name);
			if (!cached) {
				return resolveSchemaNode(spec, schema, seen);
			}
			return resolve(cached, seen);
		}
		return resolveSchemaNode(spec, schema, seen);
	}

	function treeCacheKey(schema: JsonSchemaObject): string {
		if (typeof schema.$ref === 'string') return `ref:${schema.$ref}`;
		return `inline:${schema.type ?? 'object'}:${Object.keys(schema).join(',')}`;
	}

	function buildTree(schema: JsonSchemaObject): SchemaPropertyNode[] {
		const key = treeCacheKey(schema);
		const cached = treeCache.get(key);
		if (cached) return cached;
		const tree = buildInlineSchemaTree(spec, schema, options);
		treeCache.set(key, tree);
		return tree;
	}

	return {
		resolve,
		resolveRef,
		buildTree,
		describe: describeSchemaType
	};
}
