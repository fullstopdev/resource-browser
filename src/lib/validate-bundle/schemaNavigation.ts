import { resolveObjectSchema } from '$lib/schema/requiredFields';

export function collectSchemaProperties(schema: unknown): Set<string> | null {
	if (!schema || typeof schema !== 'object') return null;
	const s = schema as Record<string, unknown>;
	const resolved = resolveObjectSchema(schema);
	if (resolved && Object.keys(resolved.properties).length > 0) {
		return new Set(Object.keys(resolved.properties));
	}
	if (s.properties && typeof s.properties === 'object') {
		return new Set(Object.keys(s.properties as Record<string, unknown>));
	}
	return null;
}

export function getItemsSchema(schema: unknown): unknown {
	if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return null;
	const node = schema as Record<string, unknown>;
	if (node.items) return node.items;
	return resolveObjectSchema(schema);
}

export function getChildPropertySchema(schema: unknown, key: string): unknown {
	if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return null;
	const resolved = resolveObjectSchema(schema);
	if (resolved?.properties[key]) return resolved.properties[key];
	const node = schema as Record<string, unknown>;
	if (node.properties && typeof node.properties === 'object') {
		return (node.properties as Record<string, unknown>)[key] ?? null;
	}
	return null;
}

export function getRequiredKeys(schema: unknown): string[] {
	const resolved = resolveObjectSchema(schema);
	return resolved?.required ?? [];
}

/** Resolve a path like ['leafs','asnPool'] within a spec schema subtree. */
export function schemaAtYamlPath(specSchema: unknown, path: string[]): unknown {
	let current: unknown = specSchema;
	for (const segment of path) {
		if (!segment || segment === 'spec') continue;
		current = getChildPropertySchema(current, segment);
		if (!current) return null;
	}
	return current;
}

/** Known YAML key variants → canonical schema property names, scoped by parent path segment. */
const SCHEMA_FIELD_ALIASES: Record<string, Record<string, string>> = {
	underlayProtocol: { protocol: 'protocols' }
};

export type ResolvedSchemaPath = {
	schema: unknown;
	/** Schema path actually resolved (may differ from the YAML path when aliased). */
	path: string[];
};

/** Resolve schema at a YAML path, falling back to known field aliases when the exact key is missing. */
export function resolveSchemaAtPath(
	specSchema: unknown,
	path: string[]
): ResolvedSchemaPath | null {
	const exact = schemaAtYamlPath(specSchema, path);
	if (exact) return { schema: exact, path };

	if (path.length === 0) return null;

	const parentPath = path.slice(0, -1);
	const segment = path[path.length - 1]!;
	const parentSegment = parentPath[parentPath.length - 1];

	const alias = parentSegment ? SCHEMA_FIELD_ALIASES[parentSegment]?.[segment] : undefined;
	if (alias) {
		const aliasPath = [...parentPath, alias];
		const schema = schemaAtYamlPath(specSchema, aliasPath);
		if (schema) return { schema, path: aliasPath };
	}

	return null;
}

/** Parent schema node for key completions (path to containing object). */
export function schemaParentAtPath(specSchema: unknown, path: string[]): unknown {
	if (path.length === 0) return specSchema;
	return schemaAtYamlPath(specSchema, path.slice(0, -1));
}

export type SchemaLeafMeta = {
	type?: string;
	enumValues?: string[];
	defaultValue?: unknown;
	description?: string;
	referencedKinds: string[];
	required: boolean;
};

const REF_FIELD_KINDS: Array<{ pattern: RegExp; kinds: string[] }> = [
	{ pattern: /^asnPool$/i, kinds: ['IndexAllocationPool'] },
	{ pattern: /^(poolIPv4|poolIPv6|systemPoolIPv4|systemPoolIPv6)$/i, kinds: ['IPAllocationPool'] },
	{ pattern: /^nodeProfile$/i, kinds: ['NodeProfile'] },
	{ pattern: /^keychain$/i, kinds: ['Keychain'] },
	{ pattern: /^(exportPolicy|importPolicy|exportPolicies|importPolicies)$/i, kinds: ['Policy'] },
	{ pattern: /^fabricSelectors$/i, kinds: ['Fabric'] },
	{ pattern: /^overlay$/i, kinds: ['Topology'] },
	{ pattern: /NodeSelectors?$/i, kinds: ['TopoNode'] }
];

const DESCRIPTION_REF = /Reference to (?:an?|the)\s+([A-Za-z][\w]*)/i;

function collectXReferences(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === 'string');
	}
	return [];
}

function kindsFromDescription(description: string | undefined): string[] {
	if (!description) return [];
	const match = DESCRIPTION_REF.exec(description);
	if (!match?.[1]) return [];
	const raw = match[1];
	if (/IndexAllocationPool/i.test(raw)) return ['IndexAllocationPool'];
	if (/IPAllocationPool/i.test(raw)) return ['IPAllocationPool'];
	if (/Policy/i.test(raw)) return ['Policy'];
	if (/TopoNode/i.test(raw)) return ['TopoNode'];
	if (/Fabric/i.test(raw)) return ['Fabric'];
	if (/Topology/i.test(raw)) return ['Topology'];
	if (/NodeProfile/i.test(raw)) return ['NodeProfile'];
	return [raw];
}

function kindsFromFieldName(fieldName: string | undefined): string[] {
	if (!fieldName) return [];
	for (const rule of REF_FIELD_KINDS) {
		if (rule.pattern.test(fieldName)) return rule.kinds;
	}
	return [];
}

export function schemaLeafMeta(
	node: unknown,
	fieldName?: string,
	parentSchema?: unknown
): SchemaLeafMeta {
	const empty: SchemaLeafMeta = {
		referencedKinds: [],
		required: false
	};
	if (!node || typeof node !== 'object') return empty;

	const record = node as Record<string, unknown>;
	const resolved = resolveObjectSchema(node);
	const type =
		typeof record.type === 'string'
			? record.type
			: Array.isArray(record.type)
				? String(record.type[0])
				: undefined;

	const enumValues = Array.isArray(record.enum)
		? record.enum.filter((v): v is string => typeof v === 'string')
		: undefined;

	const referencedKinds = new Set<string>();
	for (const kind of collectXReferences(record['x-references'])) referencedKinds.add(kind);
	for (const kind of kindsFromDescription(
		typeof record.description === 'string' ? record.description : undefined
	)) {
		referencedKinds.add(kind);
	}
	for (const kind of kindsFromFieldName(fieldName)) referencedKinds.add(kind);

	const required =
		fieldName && parentSchema
			? getRequiredKeys(parentSchema).includes(fieldName)
			: false;

	return {
		type,
		enumValues,
		defaultValue: record.default,
		description: typeof record.description === 'string' ? record.description : undefined,
		referencedKinds: [...referencedKinds],
		required
	};
}

export function truncateDetail(text: string | undefined, max = 72): string | undefined {
	if (!text) return undefined;
	const oneLine = text.replace(/\s+/g, ' ').trim();
	return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}
