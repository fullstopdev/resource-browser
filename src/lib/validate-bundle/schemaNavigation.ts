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

export type ResolvedSchemaPath = {
	schema: unknown;
	/** Schema path actually resolved (may differ from the YAML path when aliased). */
	path: string[];
};

function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;
	const row = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let prev = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			const next = Math.min(row[j]! + 1, prev + 1, row[j - 1]! + cost);
			row[j - 1] = prev;
			prev = next;
		}
		row[b.length] = prev;
	}
	return row[b.length]!;
}

export function findPluralSingularMatch(
	key: string,
	props: Set<string>,
	parentKey?: string
): string | null {
	const candidates: string[] = [];
	if (props.has(`${key}s`)) candidates.push(`${key}s`);
	if (key.endsWith('s') && props.has(key.slice(0, -1))) candidates.push(key.slice(0, -1));
	if (candidates.length !== 1) return null;

	const match = candidates[0]!;
	const fabricRule = parentKey ? FABRIC_PROTOCOL_PARENT_KEYS[parentKey] : undefined;
	if (fabricRule && match === fabricRule.wrong) {
		return null;
	}
	return match;
}

/** Fabric CRD: underlayProtocol uses plural `protocols`; overlayProtocol uses singular `protocol`. */
const FABRIC_PROTOCOL_PARENT_KEYS: Record<string, { wrong: string; correct: string }> = {
	underlayProtocol: { wrong: 'protocol', correct: 'protocols' },
	overlayProtocol: { wrong: 'protocols', correct: 'protocol' }
};

function violatesFabricProtocolRule(suggestedKey: string, parentKey?: string): boolean {
	const rule = parentKey ? FABRIC_PROTOCOL_PARENT_KEYS[parentKey] : undefined;
	return !!rule && suggestedKey === rule.wrong;
}

/**
 * Returns the schema key when `unknownKey` is the wrong pluralization for that parent.
 */
export function findFabricProtocolKeyMatch(
	unknownKey: string,
	parentKey: string | undefined,
	props: Set<string>
): string | null {
	if (!parentKey) return null;
	const rule = FABRIC_PROTOCOL_PARENT_KEYS[parentKey];
	if (!rule || unknownKey !== rule.wrong || !props.has(rule.correct)) return null;
	return rule.correct;
}

export function fabricProtocolParentHint(parentKey: string | undefined): string | undefined {
	if (parentKey === 'underlayProtocol') {
		return 'spec.underlayProtocol requires the plural key "protocols" (array). Do not use singular "protocol" here.';
	}
	if (parentKey === 'overlayProtocol') {
		return 'spec.overlayProtocol requires the singular key "protocol" (string enum). Do not use plural "protocols" here.';
	}
	return undefined;
}

/** Resolve schema at a YAML path, falling back to similar schema property names when the exact key is missing. */
export function resolveSchemaAtPath(
	specSchema: unknown,
	path: string[]
): ResolvedSchemaPath | null {
	const exact = schemaAtYamlPath(specSchema, path);
	if (exact) return { schema: exact, path };

	if (path.length === 0) return null;

	const parentPath = path.slice(0, -1);
	const segment = path[path.length - 1]!;
	const parentSchema = schemaAtYamlPath(specSchema, parentPath);
	const props = parentSchema ? collectSchemaProperties(parentSchema) : null;
	if (props) {
		const similar = findSimilarSchemaProperty(
			segment,
			props,
			parentPath[parentPath.length - 1]
		);
		if (similar) {
			const aliasPath = [...parentPath, similar];
			const schema = schemaAtYamlPath(specSchema, aliasPath);
			if (schema) return { schema, path: aliasPath };
		}
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

/** Normalize common IPv4/IPv6 property casing variants for comparison. */
export function normalizeSchemaPropertyName(name: string): string {
	return name.replace(/IPV(\d)/gi, 'IPv$1');
}

/**
 * Normalize a property name for fuzzy matching (BFD IntMs/Interval suffixes, required/desired prefixes).
 */
export function normalizePropertyStem(name: string): string {
	let s = normalizeSchemaPropertyName(name);
	s = s.replace(/^(required|desired)(?=[A-Z])/, '');
	s = s.replace(/(IntMs|Interval|Ms)$/i, '');
	return s.toLowerCase();
}

function levenshteinThreshold(a: string, b: string): number {
	return Math.max(2, Math.floor(Math.min(a.length, b.length) * 0.2));
}

/**
 * Resolve a YAML key to the canonical schema property name for completions and navigation.
 * Accepts case-insensitive and IPv4/IPv6 normalization — not used for validation strictness.
 */
export function resolveSchemaPropertyKey(key: string, props: Set<string>): string | null {
	if (props.has(key)) return key;

	const lower = key.toLowerCase();
	const normalizedLower = normalizeSchemaPropertyName(key).toLowerCase();

	for (const prop of props) {
		if (prop.toLowerCase() === lower) return prop;
		if (normalizeSchemaPropertyName(prop).toLowerCase() === normalizedLower) return prop;
	}

	return null;
}

/**
 * Find a schema property that matches a misspelled YAML key (case, IPv4/IPv6 casing, pluralization, or typo).
 * Returns the canonical property name from the schema, or null when the key is exact or has no close match.
 */
export function findSimilarSchemaProperty(
	unknownKey: string,
	props: Set<string>,
	parentKey?: string,
	parentData?: Record<string, unknown>
): string | null {
	if (props.has(unknownKey)) return null;

	const lower = unknownKey.toLowerCase();
	const normalizedLower = normalizeSchemaPropertyName(unknownKey).toLowerCase();
	let normalizedMatch: string | null = null;

	for (const prop of props) {
		if (prop.toLowerCase() === lower) {
			return prop;
		}
		const propNormalized = normalizeSchemaPropertyName(prop).toLowerCase();
		if (propNormalized === normalizedLower) {
			normalizedMatch = prop;
		}
	}

	if (normalizedMatch) return normalizedMatch;

	const fabricProtocol = findFabricProtocolKeyMatch(
		unknownKey,
		parentKey ?? undefined,
		props
	);
	if (fabricProtocol) return fabricProtocol;

	const plural = findPluralSingularMatch(unknownKey, props, parentKey);
	if (plural) return plural;

	const unknownStem = normalizePropertyStem(unknownKey);
	if (unknownStem.length >= 8) {
		let stemMatch: string | null = null;
		for (const prop of props) {
			if (normalizePropertyStem(prop) !== unknownStem) continue;
			if (stemMatch && stemMatch !== prop) {
				stemMatch = null;
				break;
			}
			stemMatch = prop;
		}
		if (stemMatch && !violatesFabricProtocolRule(stemMatch, parentKey)) {
			return stemMatch;
		}
	}

	let best: { prop: string; dist: number } | null = null;
	for (const prop of props) {
		if (violatesFabricProtocolRule(prop, parentKey)) continue;
		if (Math.min(unknownKey.length, prop.length) < 4) continue;
		const dist = levenshtein(unknownKey.toLowerCase(), prop.toLowerCase());
		const threshold = levenshteinThreshold(unknownKey, prop);
		if (dist > 0 && dist <= threshold) {
			if (!best || dist < best.dist) {
				best = { prop, dist };
			} else if (dist === best.dist) {
				best = null;
			}
		}
	}
	if (best) {
		if (
			parentData &&
			parentData[best.prop] !== undefined &&
			parentData[best.prop] !== null
		) {
			return null;
		}
		return best.prop;
	}

	return null;
}

/**
 * Find a unique nested schema path for a property name relocated from spec root.
 * Returns dot path under spec (e.g. "encapOptions.vxlan.tunnelIndexPool") or null.
 */
export function findNestedSchemaPropertyPath(
	specSchema: unknown,
	keyName: string
): string | null {
	const matches: string[] = [];

	const walk = (node: unknown, prefix: string[]) => {
		const props = collectSchemaProperties(node);
		if (!props) return;
		for (const key of props) {
			const child = getChildPropertySchema(node, key);
			if (key === keyName && prefix.length > 0) {
				matches.push([...prefix, key].join('.'));
			}
			if (child) walk(child, [...prefix, key]);
		}
	};

	walk(specSchema, []);
	if (matches.length === 1) return matches[0]!;
	return null;
}
