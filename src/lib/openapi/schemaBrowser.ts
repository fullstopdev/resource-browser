import { fetchManifest } from '$lib/manifest';
import { findManifestEntriesByKind } from '$lib/manifest/lookup';
import type { ArraySchema, ObjectSchema, Schema } from '$lib/structure';
import {
	classifySchemaName,
	SCHEMA_CATEGORY_LABELS,
	SCHEMA_CATEGORY_ORDER,
	type SchemaCategory,
	type SchemaPresentation
} from './schemaPresentation';
import {
	extractVendorExtensions,
	parseEdaExtension,
	type EdaNokiaComExtension,
	type VendorExtensionEntry
} from './vendorExtensions';

export const CIRCULAR_REF_MARKER = '(circular reference)';

export function unresolvedRefMarker(ref: string): string {
	return `unresolved reference: ${ref}`;
}

export type JsonSchemaObject = Record<string, unknown>;

export interface SchemaPropertyRow {
	name: string;
	type: string;
	required: boolean;
	description: string;
}

export interface SchemaPropertyNode {
	name: string;
	path: string;
	type: string;
	required: boolean;
	description: string;
	constraints: string[];
	/** True when the property schema declares `readOnly: true`. */
	readOnly: boolean;
	/** True when the property schema declares `writeOnly: true`. */
	writeOnly: boolean;
	children: SchemaPropertyNode[];
	expandable: boolean;
	schemaRef?: string;
	example?: string;
	inheritedFrom?: string;
	extensions: VendorExtensionEntry[];
	edaExtension?: EdaNokiaComExtension;
}

export interface SchemaExplorerEntry {
	name: string;
	type: string;
	description: string;
	properties: SchemaPropertyNode[];
	presentation: SchemaPresentation;
	crdCatalogHref?: string;
	extensions: VendorExtensionEntry[];
	edaExtension?: EdaNokiaComExtension;
	/** Nested component schemas referenced only from other schemas (not paths). */
	nestedEntries?: SchemaExplorerEntry[];
	/** Parent schema when this entry is nested under another component schema. */
	parentName?: string;
	isNested?: boolean;
}

export interface SchemaRefGraph {
	pathRefs: Set<string>;
	referencedBy: Map<string, Set<string>>;
}

export interface SchemaExplorerGroup {
	category: SchemaCategory;
	label: string;
	entries: SchemaExplorerEntry[];
}

export interface SchemaSummary {
	name: string;
	type: string;
	description: string;
	properties: SchemaPropertyRow[];
}

export interface SchemaExplorerOptions {
	crdCatalogLinks?: Map<string, string>;
	/** When true, eagerly resolve property trees for every schema (tests / explicit opt-in). */
	eagerProperties?: boolean;
}

export interface SchemaExplorerHydrator {
	hydrate(entry: SchemaExplorerEntry): SchemaExplorerEntry;
	hydrateByName(name: string, entries: SchemaExplorerEntry[]): SchemaExplorerEntry | null;
}

function asObject(value: unknown): JsonSchemaObject | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as JsonSchemaObject)
		: null;
}

export function refName(ref: string): string {
	const hash = ref.lastIndexOf('#/');
	if (hash >= 0) return ref.slice(hash + 2).replace(/^components\/schemas\//, '');
	const slash = ref.lastIndexOf('/');
	return slash >= 0 ? ref.slice(slash + 1) : ref;
}

/** Label for a single composition / map-value branch (avoids empty noise). */
function describeSchemaBranch(schema: JsonSchemaObject): string {
	if (typeof schema.$ref === 'string') return refName(schema.$ref);

	const type = schema.type;
	if (type === 'array') {
		const items = asObject(schema.items);
		if (!items || Object.keys(items).length === 0) return 'array';
		return `array<${describeSchemaBranch(items)}>`;
	}
	if (typeof type === 'string') {
		if (typeof schema.format === 'string') return `${type} (${schema.format})`;
		return type;
	}
	if (Array.isArray(type) && type.length > 0) return type.map(String).join(' | ');

	if (schema.enum && Array.isArray(schema.enum) && schema.enum.length > 0) {
		const values = schema.enum.slice(0, 3).map(String).join(', ');
		const suffix = schema.enum.length > 3 ? ', …' : '';
		return `enum (${values}${suffix})`;
	}

	if (Object.keys(schema).length === 0) return 'any';
	return 'object';
}

/** Map-like label when `additionalProperties` is present. */
export function describeAdditionalProperties(
	additionalProperties: unknown,
	options: { hasNamedProperties?: boolean } = {}
): string {
	const hasNamed = options.hasNamedProperties === true;
	if (additionalProperties === true) {
		return hasNamed ? 'object (+map)' : 'map<string, any>';
	}
	if (additionalProperties === false) {
		return hasNamed ? 'object' : 'object (closed)';
	}
	const valueSchema = asObject(additionalProperties);
	if (!valueSchema) {
		return hasNamed ? 'object (+map)' : 'map';
	}
	const valueLabel = describeSchemaType(valueSchema);
	const mapLabel = `map<string, ${valueLabel}>`;
	return hasNamed ? `object (+${mapLabel})` : mapLabel;
}

/** Human-readable type label for a JSON Schema fragment. */
export function describeSchemaType(schema: JsonSchemaObject): string {
	if (typeof schema.$ref === 'string') return refName(schema.$ref);

	const compositions = ['oneOf', 'anyOf', 'allOf'] as const;
	for (const key of compositions) {
		const parts = schema[key];
		if (Array.isArray(parts) && parts.length > 0) {
			const labels = parts.map((part) => {
				const obj = asObject(part);
				return obj ? describeSchemaBranch(obj) : 'any';
			});
			const shown = labels.slice(0, 5);
			const suffix = labels.length > 5 ? ', …' : '';
			return `${key} (${shown.join(' | ')}${suffix})`;
		}
	}

	const properties = asObject(schema.properties);
	const hasNamedProperties = Boolean(properties && Object.keys(properties).length > 0);

	if (schema.additionalProperties !== undefined) {
		return describeAdditionalProperties(schema.additionalProperties, { hasNamedProperties });
	}

	const type = schema.type;
	if (typeof type === 'string') {
		if (type === 'array') {
			const items = asObject(schema.items);
			if (!items || Object.keys(items).length === 0) return 'array';
			return `array<${describeSchemaType(items)}>`;
		}
		if (typeof schema.format === 'string') return `${type} (${schema.format})`;
		return type;
	}

	if (Array.isArray(type)) return type.join(' | ');

	if (schema.enum && Array.isArray(schema.enum)) {
		const values = schema.enum.slice(0, 4).map(String).join(', ');
		const suffix = schema.enum.length > 4 ? ', …' : '';
		return `enum (${values}${suffix})`;
	}

	return 'object';
}

function schemaDescription(schema: JsonSchemaObject): string {
	if (typeof schema.description === 'string' && schema.description.trim()) {
		return schema.description.trim();
	}
	if (typeof schema.title === 'string' && schema.title.trim()) {
		return schema.title.trim();
	}
	return '';
}

function resolvePropertyDescription(schema: JsonSchemaObject): string {
	return schemaDescription(schema);
}

/** List component schema names from an OpenAPI document. */
export function listSchemaNames(spec: Record<string, unknown>): string[] {
	const components = asObject(spec.components);
	const schemas = asObject(components?.schemas);
	if (!schemas) return [];
	return Object.keys(schemas).sort((a, b) => a.localeCompare(b));
}

function propertyRows(schema: JsonSchemaObject): SchemaPropertyRow[] {
	const properties = asObject(schema.properties);
	if (!properties) return [];

	const required = new Set(
		Array.isArray(schema.required)
			? schema.required.filter((r): r is string => typeof r === 'string')
			: []
	);

	return Object.entries(properties)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, value]) => {
			const prop = asObject(value) ?? {};
			return {
				name,
				type: describeSchemaType(prop),
				required: required.has(name),
				description: schemaDescription(prop)
			};
		});
}

const MAX_TREE_DEPTH = 10;

function getComponentSchema(spec: Record<string, unknown>, name: string): JsonSchemaObject | null {
	const components = asObject(spec.components);
	const schemas = asObject(components?.schemas);
	return asObject(schemas?.[name]);
}

/** Collect human-readable constraint labels from a JSON Schema fragment. */
export function schemaConstraints(schema: JsonSchemaObject): string[] {
	const constraints: string[] = [];

	if (Array.isArray(schema.enum) && schema.enum.length > 0) {
		const values = schema.enum.slice(0, 6).map(String).join(', ');
		const suffix = schema.enum.length > 6 ? ', …' : '';
		constraints.push(`enum: ${values}${suffix}`);
	}
	if (schema.minimum !== undefined) constraints.push(`min: ${schema.minimum}`);
	if (schema.maximum !== undefined) constraints.push(`max: ${schema.maximum}`);
	if (schema.minLength !== undefined) constraints.push(`minLength: ${schema.minLength}`);
	if (schema.maxLength !== undefined) constraints.push(`maxLength: ${schema.maxLength}`);
	if (schema.minItems !== undefined) constraints.push(`minItems: ${schema.minItems}`);
	if (schema.maxItems !== undefined) constraints.push(`maxItems: ${schema.maxItems}`);
	if (schema.pattern !== undefined) constraints.push(`pattern: ${schema.pattern}`);
	if (typeof schema.format === 'string') constraints.push(`format: ${schema.format}`);
	if (schema.nullable === true) constraints.push('nullable');
	if (schema.readOnly === true) constraints.push('readOnly');
	if (schema.writeOnly === true) constraints.push('writeOnly');
	if (schema.default !== undefined) constraints.push(`default: ${JSON.stringify(schema.default)}`);

	return constraints;
}

function mergeAllOf(
	spec: Record<string, unknown>,
	schema: JsonSchemaObject,
	seen: Set<string>
): { merged: JsonSchemaObject; inheritedFrom: Map<string, string> } {
	const inheritedFrom = new Map<string, string>();
	const allOf = schema.allOf;
	if (!Array.isArray(allOf) || allOf.length === 0) {
		return { merged: schema, inheritedFrom };
	}

	const merged: JsonSchemaObject = { ...schema };
	delete merged.allOf;

	const mergedProperties: Record<string, unknown> = {
		...(asObject(merged.properties) ?? {})
	};
	const mergedRequired = new Set(
		Array.isArray(merged.required)
			? merged.required.filter((r): r is string => typeof r === 'string')
			: []
	);

	for (const part of allOf) {
		const partObj = asObject(part);
		if (!partObj) continue;

		let sourceName = '';
		if (typeof partObj.$ref === 'string') {
			sourceName = refName(partObj.$ref);
		}

		const resolved = resolveSchemaNode(spec, partObj, new Set(seen));
		const props = asObject(resolved.properties);
		if (props) {
			for (const [propName, propValue] of Object.entries(props)) {
				if (!(propName in mergedProperties)) {
					mergedProperties[propName] = propValue;
					if (sourceName) inheritedFrom.set(propName, sourceName);
				}
			}
		}

		if (Array.isArray(resolved.required)) {
			for (const req of resolved.required) {
				if (typeof req === 'string') mergedRequired.add(req);
			}
		}

		if (!merged.description && resolved.description) {
			merged.description = resolved.description;
		}
	}

	merged.properties = mergedProperties;
	if (mergedRequired.size > 0) {
		merged.required = [...mergedRequired];
	}

	return { merged, inheritedFrom };
}

/** Resolve $ref, allOf, and circular references for display. */
export function resolveSchemaNode(
	spec: Record<string, unknown>,
	schema: JsonSchemaObject,
	seen: Set<string>
): JsonSchemaObject {
	if (typeof schema.$ref === 'string') {
		const name = refName(schema.$ref);
		if (seen.has(name)) {
			return { type: 'object', description: CIRCULAR_REF_MARKER };
		}
		seen.add(name);
		const resolved = getComponentSchema(spec, name);
		if (!resolved) {
			return { type: 'object', description: unresolvedRefMarker(schema.$ref) };
		}
		return resolveSchemaNode(spec, resolved, seen);
	}

	const { merged } = mergeAllOf(spec, schema, seen);
	if (merged !== schema) {
		return resolveSchemaNode(spec, merged, seen);
	}

	return schema;
}

function propertySortOrder(name: string): number {
	if (name === 'spec') return 0;
	if (name === 'status') return 1;
	if (name === 'metadata') return 2;
	if (name === 'alarms' || name === 'deviations') return 3;
	return 10;
}

function sortPropertyEntries(entries: [string, unknown][]): [string, unknown][] {
	return [...entries].sort(([nameA, valueA], [nameB, valueB]) => {
		const propA = asObject(valueA);
		const propB = asObject(valueB);
		const edaA = parseEdaExtension(propA?.['x-eda-nokia-com']);
		const edaB = parseEdaExtension(propB?.['x-eda-nokia-com']);
		const prioA = edaA?.['ui-order-priority'] ?? 10_000;
		const prioB = edaB?.['ui-order-priority'] ?? 10_000;
		if (prioA !== prioB) return prioA - prioB;

		const orderDiff = propertySortOrder(nameA) - propertySortOrder(nameB);
		if (orderDiff !== 0) return orderDiff;

		const labelA = edaA?.['ui-title'] ?? nameA;
		const labelB = edaB?.['ui-title'] ?? nameB;
		return labelA.localeCompare(labelB);
	});
}

/** Display label for a schema property (EDA `ui-title` or property name). */
export function getPropertyDisplayLabel(name: string, schema: JsonSchemaObject): string {
	const eda = parseEdaExtension(schema['x-eda-nokia-com']);
	return eda?.['ui-title']?.trim() || name;
}

function buildPropertyNode(
	spec: Record<string, unknown>,
	name: string,
	schema: JsonSchemaObject,
	pathPrefix: string,
	required: boolean,
	depth: number,
	seen: Set<string>,
	schemaRootName: string,
	options: SchemaExplorerOptions,
	inheritedFrom?: string
): SchemaPropertyNode {
	const { merged, inheritedFrom: allOfInherited } = mergeAllOf(spec, schema, new Set(seen));
	const resolved = resolveSchemaNode(spec, merged, new Set(seen));
	const path = pathPrefix ? `${pathPrefix}.${name}` : name;
	const type = describeSchemaType(resolved);
	const ref = typeof schema.$ref === 'string' ? refName(schema.$ref) : undefined;
	const children: SchemaPropertyNode[] = [];

	const description = resolvePropertyDescription(resolved);

	if (depth < MAX_TREE_DEPTH) {
		if (resolved.type === 'object' || resolved.properties || resolved.additionalProperties !== undefined) {
			const properties = asObject(resolved.properties);
			if (properties) {
				const req = new Set(
					Array.isArray(resolved.required)
						? resolved.required.filter((r): r is string => typeof r === 'string')
						: []
				);
				for (const [propName, propValue] of sortPropertyEntries(Object.entries(properties))) {
					const prop = asObject(propValue) ?? {};
					children.push(
						buildPropertyNode(
							spec,
							propName,
							prop,
							path,
							req.has(propName),
							depth + 1,
							seen,
							schemaRootName,
							options,
							allOfInherited.get(propName)
						)
					);
				}
			}

			const additional = resolved.additionalProperties;
			if (additional !== undefined && additional !== false) {
				const valueSchema =
					additional === true ? ({} as JsonSchemaObject) : (asObject(additional) ?? {});
				children.push(
					buildPropertyNode(
						spec,
						'[additionalProperties]',
						valueSchema,
						path,
						false,
						depth + 1,
						seen,
						schemaRootName,
						options
					)
				);
			}
		} else if (resolved.type === 'array') {
			const items = asObject(resolved.items);
			if (items) {
				children.push(
					buildPropertyNode(
						spec,
						'[items]',
						items,
						path,
						false,
						depth + 1,
						seen,
						schemaRootName,
						options
					)
				);
			}
		}

		if (!children.length) {
			for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
				const parts = resolved[key];
				if (!Array.isArray(parts) || parts.length === 0) continue;
				parts.forEach((part, index) => {
					const branch = asObject(part) ?? {};
					children.push(
						buildPropertyNode(
							spec,
							`[${key} ${index}]`,
							branch,
							path,
							false,
							depth + 1,
							seen,
							schemaRootName,
							options
						)
					);
				});
				break;
			}
		}

		if (!children.length && typeof schema.$ref === 'string') {
			const refTarget = refName(schema.$ref);
			if (!seen.has(refTarget)) {
				const nextSeen = new Set(seen);
				nextSeen.add(refTarget);
				const refSchema = getComponentSchema(spec, refTarget);
				if (refSchema) {
					const nested = buildPropertyNode(
						spec,
						name,
						refSchema,
						pathPrefix,
						required,
						depth + 1,
						nextSeen,
						schemaRootName,
						options,
						refTarget
					);
					children.push(...nested.children);
				}
			}
		}
	}

	const example =
		typeof resolved.example === 'string'
			? resolved.example
			: resolved.example !== undefined
				? JSON.stringify(resolved.example)
				: undefined;

	const extensions = extractVendorExtensions(resolved);
	const edaExtension = parseEdaExtension(resolved['x-eda-nokia-com']);

	const constraints = schemaConstraints(resolved);

	return {
		name,
		path,
		type,
		required,
		description,
		constraints,
		readOnly: resolved.readOnly === true,
		writeOnly: resolved.writeOnly === true,
		children,
		expandable: children.length > 0,
		schemaRef: ref,
		example,
		inheritedFrom,
		extensions,
		edaExtension: edaExtension ?? undefined
	};
}

function buildPropertyTree(
	spec: Record<string, unknown>,
	schemaName: string,
	schema: JsonSchemaObject,
	options: SchemaExplorerOptions
): SchemaPropertyNode[] {
	const resolved = resolveSchemaNode(spec, schema, new Set());
	const properties = asObject(resolved.properties);
	const required = new Set(
		Array.isArray(resolved.required)
			? resolved.required.filter((r): r is string => typeof r === 'string')
			: []
	);

	const nodes: SchemaPropertyNode[] = [];

	if (properties) {
		for (const [name, value] of sortPropertyEntries(Object.entries(properties))) {
			const prop = asObject(value) ?? {};
			const initialSeen = new Set(schemaName ? [schemaName] : []);
			nodes.push(
				buildPropertyNode(
					spec,
					name,
					prop,
					schemaName,
					required.has(name),
					0,
					initialSeen,
					schemaName,
					options
				)
			);
		}
	}

	const additional = resolved.additionalProperties;
	if (additional !== undefined && additional !== false) {
		const valueSchema =
			additional === true ? ({} as JsonSchemaObject) : (asObject(additional) ?? {});
		const initialSeen = new Set(schemaName ? [schemaName] : []);
		nodes.push(
			buildPropertyNode(
				spec,
				'[additionalProperties]',
				valueSchema,
				schemaName,
				false,
				0,
				initialSeen,
				schemaName,
				options
			)
		);
	}

	if (nodes.length === 0) {
		for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
			const parts = resolved[key];
			if (!Array.isArray(parts) || parts.length === 0) continue;
			const initialSeen = new Set(schemaName ? [schemaName] : []);
			parts.forEach((part, index) => {
				const branch = asObject(part) ?? {};
				nodes.push(
					buildPropertyNode(
						spec,
						`[${key} ${index}]`,
						branch,
						schemaName,
						false,
						0,
						initialSeen,
						schemaName,
						options
					)
				);
			});
			break;
		}
	}

	if (nodes.length === 0 && resolved.type === 'array') {
		const items = asObject(resolved.items);
		if (items) {
			const initialSeen = new Set(schemaName ? [schemaName] : []);
			nodes.push(
				buildPropertyNode(
					spec,
					'[items]',
					items,
					schemaName,
					false,
					0,
					initialSeen,
					schemaName,
					options
				)
			);
		}
	}

	return nodes;
}

/** Build a property tree from an arbitrary inline schema fragment (e.g. request body). */
export function buildInlineSchemaTree(
	spec: Record<string, unknown>,
	schema: JsonSchemaObject,
	options: SchemaExplorerOptions = {}
): SchemaPropertyNode[] {
	const resolved = resolveSchemaNode(spec, schema, new Set());
	return buildPropertyTree(spec, '', resolved, options);
}

function entryDescription(schema: JsonSchemaObject): string {
	return schemaDescription(schema);
}

function collectSchemaRefsFromValue(value: unknown, refs: Set<string>): void {
	if (value === null || typeof value !== 'object') return;

	if (!Array.isArray(value)) {
		const obj = value as JsonSchemaObject;
		if (typeof obj.$ref === 'string') refs.add(refName(obj.$ref));
	}

	if (Array.isArray(value)) {
		for (const item of value) collectSchemaRefsFromValue(item, refs);
		return;
	}

	for (const nested of Object.values(value)) {
		collectSchemaRefsFromValue(nested, refs);
	}
}

/** Collect component schema names referenced anywhere under `paths`. */
export function collectPathSchemaRefs(spec: Record<string, unknown>): Set<string> {
	const refs = new Set<string>();
	collectSchemaRefsFromValue(spec.paths, refs);
	return refs;
}

/** Build inbound ref index for component schemas plus path entry points. */
export function buildSchemaRefGraph(spec: Record<string, unknown>): SchemaRefGraph {
	const pathRefs = collectPathSchemaRefs(spec);
	const referencedBy = new Map<string, Set<string>>();

	const components = asObject(spec.components);
	const schemas = asObject(components?.schemas);
	if (schemas) {
		for (const [parent, value] of Object.entries(schemas)) {
			const refs = new Set<string>();
			collectSchemaRefsFromValue(value, refs);
			for (const ref of refs) {
				const referrers = referencedBy.get(ref) ?? new Set<string>();
				referrers.add(parent);
				referencedBy.set(ref, referrers);
			}
		}
	}

	return { pathRefs, referencedBy };
}

/** True when a schema is referenced from paths or is not exclusively nested. */
export function isTopLevelSchema(name: string, graph: SchemaRefGraph): boolean {
	if (graph.pathRefs.has(name)) return true;
	const referrers = graph.referencedBy.get(name);
	return !referrers || referrers.size === 0;
}

/** Pick a stable parent for nested-only schemas with multiple referrers. */
export function resolvePrimaryParent(name: string, graph: SchemaRefGraph): string | null {
	const referrers = [...(graph.referencedBy.get(name) ?? [])].sort((a, b) => a.localeCompare(b));
	if (referrers.length === 0) return null;

	const topLevelReferrers = referrers.filter((parent) => isTopLevelSchema(parent, graph));
	if (topLevelReferrers.length > 0) return topLevelReferrers[0] ?? null;

	const visited = new Set<string>();
	const queue = [...referrers];
	while (queue.length > 0) {
		const parent = queue.shift()!;
		if (visited.has(parent)) continue;
		visited.add(parent);
		if (isTopLevelSchema(parent, graph)) return parent;
		for (const grandparent of graph.referencedBy.get(parent) ?? []) {
			if (!visited.has(grandparent)) queue.push(grandparent);
		}
	}

	return referrers[0] ?? null;
}

function buildSingleSchemaEntry(
	spec: Record<string, unknown>,
	name: string,
	schema: JsonSchemaObject,
	options: SchemaExplorerOptions,
	eagerProperties = options.eagerProperties ?? false
): SchemaExplorerEntry {
	const presentation = classifySchemaName(name);
	const extensions = extractVendorExtensions(schema);
	const edaExtension = parseEdaExtension(schema['x-eda-nokia-com']);
	return {
		name,
		type: describeSchemaType(schema),
		description: entryDescription(schema),
		properties: eagerProperties ? buildPropertyTree(spec, name, schema, options) : [],
		presentation,
		crdCatalogHref: presentation.kind && options.crdCatalogLinks?.get(presentation.kind),
		extensions,
		edaExtension: edaExtension ?? undefined
	};
}

const explorerCache = new WeakMap<object, SchemaExplorerEntry[]>();

/** Lazily hydrate a schema explorer entry with its resolved property tree. */
export function hydrateSchemaExplorerEntry(
	spec: Record<string, unknown>,
	entry: SchemaExplorerEntry,
	options: SchemaExplorerOptions = {},
	cache = new Map<string, SchemaExplorerEntry>()
): SchemaExplorerEntry {
	if (entry.properties.length > 0) return entry;
	const cached = cache.get(entry.name);
	if (cached) return cached;

	const schema = getComponentSchema(spec, entry.name);
	if (!schema) return entry;

	const hydrated: SchemaExplorerEntry = {
		...entry,
		properties: buildPropertyTree(spec, entry.name, schema, options)
	};
	cache.set(entry.name, hydrated);
	return hydrated;
}

/** Memoized hydrator for a single spec document. */
export function createSchemaExplorerHydrator(
	spec: Record<string, unknown>,
	options: SchemaExplorerOptions = {}
): SchemaExplorerHydrator {
	const cache = new Map<string, SchemaExplorerEntry>();
	return {
		hydrate(entry) {
			return hydrateSchemaExplorerEntry(spec, entry, options, cache);
		},
		hydrateByName(name, entries) {
			const entry = findSchemaExplorerEntry(entries, name);
			return entry ? hydrateSchemaExplorerEntry(spec, entry, options, cache) : null;
		}
	};
}

function attachNestedSchemaTree(
	allEntries: Map<string, SchemaExplorerEntry>,
	graph: SchemaRefGraph
): SchemaExplorerEntry[] {
	const childrenOf = new Map<string, string[]>();

	for (const name of allEntries.keys()) {
		if (isTopLevelSchema(name, graph)) continue;
		const parent = resolvePrimaryParent(name, graph);
		if (!parent || !allEntries.has(parent)) continue;
		const siblings = childrenOf.get(parent) ?? [];
		siblings.push(name);
		childrenOf.set(parent, siblings);
	}

	function attachNested(name: string): SchemaExplorerEntry {
		const entry = allEntries.get(name)!;
		const childNames = (childrenOf.get(name) ?? []).sort((a, b) => a.localeCompare(b));
		const nestedEntries = childNames.map((childName) => {
			const nested = attachNested(childName);
			return { ...nested, isNested: true, parentName: name };
		});
		return nestedEntries.length > 0 ? { ...entry, nestedEntries } : entry;
	}

	return [...allEntries.keys()]
		.filter((name) => isTopLevelSchema(name, graph))
		.sort((a, b) => a.localeCompare(b))
		.map((name) => attachNested(name));
}

/** Flatten a hierarchical explorer list (depth-first). */
export function flattenSchemaExplorer(entries: SchemaExplorerEntry[]): SchemaExplorerEntry[] {
	const flat: SchemaExplorerEntry[] = [];
	function walk(list: SchemaExplorerEntry[]) {
		for (const entry of list) {
			flat.push(entry);
			if (entry.nestedEntries?.length) walk(entry.nestedEntries);
		}
	}
	walk(entries);
	return flat;
}

/** Find a schema entry by component name anywhere in the explorer tree. */
export function findSchemaExplorerEntry(
	entries: SchemaExplorerEntry[],
	name: string
): SchemaExplorerEntry | null {
	for (const entry of entries) {
		if (entry.name === name) return entry;
		if (entry.nestedEntries?.length) {
			const nested = findSchemaExplorerEntry(entry.nestedEntries, name);
			if (nested) return nested;
		}
	}
	return null;
}

/**
 * Return the root→leaf chain for a schema in the explorer tree
 * (including the target). Empty when the name is not present.
 */
export function getSchemaExplorerPath(
	entries: SchemaExplorerEntry[],
	name: string
): SchemaExplorerEntry[] {
	function walk(
		list: SchemaExplorerEntry[],
		trail: SchemaExplorerEntry[]
	): SchemaExplorerEntry[] | null {
		for (const entry of list) {
			const next = [...trail, entry];
			if (entry.name === name) return next;
			if (entry.nestedEntries?.length) {
				const found = walk(entry.nestedEntries, next);
				if (found) return found;
			}
		}
		return null;
	}
	return walk(entries, []) ?? [];
}

/** Count nested component schemas under an entry (all descendants). */
export function countNestedSchemaEntries(entry: SchemaExplorerEntry): number {
	if (!entry.nestedEntries?.length) return 0;
	let count = entry.nestedEntries.length;
	for (const nested of entry.nestedEntries) {
		count += countNestedSchemaEntries(nested);
	}
	return count;
}

/** Build explorer entries with nested property trees for every component schema. */
export function buildSchemaExplorer(
	spec: Record<string, unknown>,
	options: SchemaExplorerOptions = {}
): SchemaExplorerEntry[] {
	const cached = explorerCache.get(spec);
	if (cached && !options.eagerProperties && !options.crdCatalogLinks?.size) return cached;

	const components = asObject(spec.components);
	const schemas = asObject(components?.schemas);
	if (!schemas) return [];

	const graph = buildSchemaRefGraph(spec);
	const allEntries = new Map<string, SchemaExplorerEntry>();
	const eagerProperties = options.eagerProperties ?? false;

	for (const [name, value] of Object.entries(schemas)) {
		const schema = asObject(value) ?? {};
		allEntries.set(name, buildSingleSchemaEntry(spec, name, schema, options, eagerProperties));
	}

	const entries = attachNestedSchemaTree(allEntries, graph);
	if (!options.eagerProperties && !options.crdCatalogLinks?.size) {
		explorerCache.set(spec, entries);
	}
	return entries;
}

/** Count property nodes that carry `x-eda-nokia-com` metadata (including nested fields). */
export function countEdaExtensionsInTree(nodes: SchemaPropertyNode[]): number {
	let count = 0;
	for (const node of nodes) {
		if (node.edaExtension) count++;
		count += countEdaExtensionsInTree(node.children);
	}
	return count;
}

/** Group schema explorer entries by presentation category. */
export function groupSchemaExplorer(entries: SchemaExplorerEntry[]): SchemaExplorerGroup[] {
	const buckets = new Map<SchemaCategory, SchemaExplorerEntry[]>();

	for (const entry of entries) {
		const category = entry.presentation.category;
		const list = buckets.get(category) ?? [];
		list.push(entry);
		buckets.set(category, list);
	}

	return SCHEMA_CATEGORY_ORDER.filter((category) => buckets.has(category)).map((category) => ({
		category,
		label: SCHEMA_CATEGORY_LABELS[category],
		entries: buckets.get(category) ?? []
	}));
}

function entryMatchesMetadata(entry: SchemaExplorerEntry, q: string): boolean {
	if (entry.name.toLowerCase().includes(q)) return true;
	if (entry.presentation.label.toLowerCase().includes(q)) return true;
	if (entry.presentation.kind?.toLowerCase().includes(q)) return true;
	if (entry.description.toLowerCase().includes(q)) return true;
	if (entry.type.toLowerCase().includes(q)) return true;
	return false;
}

/** Search schema explorer entries by name or dotted property path. */
export function filterSchemaExplorer(
	entries: SchemaExplorerEntry[],
	query: string,
	hydrator?: SchemaExplorerHydrator
): SchemaExplorerEntry[] {
	const q = query.trim().toLowerCase();
	if (!q) return entries;

	const candidates = flattenSchemaExplorer(entries);

	function nodeMatches(node: SchemaPropertyNode): boolean {
		if (node.name.toLowerCase().includes(q)) return true;
		if (node.path.toLowerCase().includes(q)) return true;
		if (node.type.toLowerCase().includes(q)) return true;
		if (node.description.toLowerCase().includes(q)) return true;
		if (node.edaExtension?.['ui-title']?.toLowerCase().includes(q)) return true;
		if (
			node.extensions.some(
				(ext) =>
					ext.key.toLowerCase().includes(q) ||
					ext.fields.some(
						(field) => field.key.toLowerCase().includes(q) || field.value.toLowerCase().includes(q)
					)
			)
		) {
			return true;
		}
		return node.children.some(nodeMatches);
	}

	function entryMatches(entry: SchemaExplorerEntry): boolean {
		if (entryMatchesMetadata(entry, q)) return true;
		if (entry.properties.length > 0) return entry.properties.some(nodeMatches);
		if (!hydrator) return false;
		return hydrator.hydrate(entry).properties.some(nodeMatches);
	}

	return candidates.filter(entryMatches);
}

/** Build display summaries for every schema in the spec. */
export function buildSchemaSummaries(spec: Record<string, unknown>): SchemaSummary[] {
	const components = asObject(spec.components);
	const schemas = asObject(components?.schemas);
	if (!schemas) return [];

	return Object.entries(schemas)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, value]) => {
			const schema = asObject(value) ?? {};
			return {
				name,
				type: describeSchemaType(schema),
				description: schemaDescription(schema),
				properties: propertyRows(schema)
			};
		});
}

const MAX_RENDER_DEPTH = 12;

type JSONType = 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array';

function inferJsonType(schema: JsonSchemaObject): JSONType {
	const type = schema.type;
	if (typeof type === 'string') return type as JSONType;
	if (Array.isArray(type)) {
		const nonNull = type.find((t) => t !== 'null');
		if (typeof nonNull === 'string') return nonNull as JSONType;
	}
	if (schema.properties) return 'object';
	if (schema.items) return 'array';
	if (schema.enum) return 'string';
	return 'object';
}

function copyScalarConstraints(source: JsonSchemaObject, target: Record<string, unknown>) {
	if (typeof source.description === 'string') target.description = source.description;
	if (source.default !== undefined) target.default = source.default;
	if (typeof source.format === 'string') target.format = source.format;
	if (Array.isArray(source.enum)) target.enum = source.enum.map(String);
	if (source.minimum !== undefined) target.minimum = source.minimum;
	if (source.maximum !== undefined) target.maximum = source.maximum;
	if (source.minItems !== undefined) target.minItems = source.minItems;
	if (source.maxItems !== undefined) target.maxItems = source.maxItems;
}

/** Resolve a component schema with refs and allOf merged (for Render/Tree). */
export function getResolvedComponentSchema(
	spec: Record<string, unknown>,
	name: string
): JsonSchemaObject | null {
	const schema = getComponentSchema(spec, name);
	if (!schema) return null;
	return resolveSchemaNode(spec, schema, new Set());
}

/** Convert a resolved JSON Schema fragment into the CRD-style tree used by Render/Tree. */
export function jsonSchemaToRenderTree(
	spec: Record<string, unknown>,
	schema: JsonSchemaObject,
	depth = 0,
	refSeen = new Set<string>()
): Schema {
	if (typeof schema.$ref === 'string') {
		const name = refName(schema.$ref);
		if (refSeen.has(name) || depth >= MAX_RENDER_DEPTH) {
			return {
				type: 'object',
				properties: {},
				description: refSeen.has(name) ? `↻ ${name}` : '…'
			};
		}
		refSeen.add(name);
		const resolved = getComponentSchema(spec, name);
		if (!resolved) {
			return { type: 'object', properties: {}, description: name };
		}
		return jsonSchemaToRenderTree(spec, resolved, depth + 1, refSeen);
	}

	const resolved = resolveSchemaNode(spec, schema, new Set(refSeen));
	const type = inferJsonType(resolved);
	const scalar: Record<string, unknown> = {};
	copyScalarConstraints(resolved, scalar);

	if (type === 'object') {
		const properties: Record<string, Schema> = {};
		const props = asObject(resolved.properties);
		if (props && depth < MAX_RENDER_DEPTH) {
			for (const [key, value] of sortPropertyEntries(Object.entries(props))) {
				properties[key] = jsonSchemaToRenderTree(
					spec,
					asObject(value) ?? {},
					depth + 1,
					new Set(refSeen)
				);
			}
		}
		const result: ObjectSchema = {
			type: 'object',
			properties,
			...(scalar as Partial<ObjectSchema>)
		};
		if (Array.isArray(resolved.required)) {
			result.required = resolved.required.filter((r): r is string => typeof r === 'string');
		}
		return result;
	}

	if (type === 'array') {
		const items = asObject(resolved.items) ?? { type: 'string' };
		return {
			type: 'array',
			items: jsonSchemaToRenderTree(spec, items, depth + 1, new Set(refSeen)),
			...(scalar as Partial<ArraySchema>)
		} as ArraySchema;
	}

	return { type, ...(scalar as Partial<Schema>) } as Schema;
}

/** Load and convert an OpenAPI component schema for Render/Tree display. */
export function openApiComponentToRenderSchema(
	spec: Record<string, unknown>,
	schemaName: string
): Schema | null {
	const schema = getComponentSchema(spec, schemaName);
	if (!schema) return null;
	return jsonSchemaToRenderTree(spec, schema);
}

export interface SpecStatusSections {
	spec: Schema | null;
	status: Schema | null;
	root: Schema | null;
}

/** Split CRD-style schemas into spec/status sections like ResourceModal. */
export function splitSpecStatusSections(schema: Schema): SpecStatusSections {
	if (schema.type !== 'object') {
		return { spec: null, status: null, root: schema };
	}

	const props = schema.properties ?? {};
	const hasSpec = 'spec' in props;
	const hasStatus = 'status' in props;

	if (hasSpec || hasStatus) {
		return {
			spec: hasSpec ? props.spec : null,
			status: hasStatus ? props.status : null,
			root: null
		};
	}

	return { spec: null, status: null, root: schema };
}

/** Collect dotted paths for properties that carry EDA UI metadata. */
export function collectEdaAnnotatedPaths(nodes: SchemaPropertyNode[]): SchemaPropertyNode[] {
	const result: SchemaPropertyNode[] = [];
	for (const node of nodes) {
		if (node.edaExtension) result.push(node);
		result.push(...collectEdaAnnotatedPaths(node.children));
	}
	return result;
}

export { classifySchemaName, type SchemaPresentation, type SchemaCategory };

/** Resolve CRD catalog hrefs for schema kinds from the static release manifest. */
export async function loadCrdCatalogLinks(
	releaseFolder: string,
	kinds: string[]
): Promise<Map<string, string>> {
	const manifest = await fetchManifest(releaseFolder);
	if (!manifest) return new Map();

	const links = new Map<string, string>();
	for (const kind of new Set(kinds.filter(Boolean))) {
		const entries = findManifestEntriesByKind(manifest, kind);
		const entry = entries[0];
		if (!entry?.versions?.length) continue;
		const version =
			entry.versions.find((v) => !v.deprecated)?.name ?? entry.versions[0]?.name ?? 'v1';
		links.set(kind, `/${entry.name}/${version}`);
	}
	return links;
}
