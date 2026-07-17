import yaml from 'js-yaml';
import { resolveSchemaNode, type JsonSchemaObject } from './schemaBrowser';

/** A single OpenAPI `example` / named `examples` entry ready for display. */
export interface OpenApiExample {
	/** Named key from an `examples` map; empty for anonymous `example`. */
	name: string;
	summary: string;
	description: string;
	/** Pretty-printed JSON or plain text for display and copy (JSON form). */
	formatted: string;
	/** Character length of `formatted` (used for default collapse). */
	size: number;
	/** Raw value when structured (enables JSON ↔ YAML conversion). */
	value?: unknown;
	/** True when the example was synthesized from the schema (not in the OpenAPI doc). */
	synthesized?: boolean;
}

/** Display format for a representation panel. */
export type RepresentationFormat = 'json' | 'yaml' | 'text';

/** Selectable media format tab derived from OpenAPI content types. */
export interface RepresentationMediaOption {
	/** Stable id for the tab (content type or synthetic). */
	id: string;
	/** Short label shown in the segmented control (JSON / YAML / csv…). */
	label: string;
	/** Original OpenAPI content type(s) this option covers. */
	contentTypes: string[];
	format: RepresentationFormat;
}

/** Collapse by default when the formatted example exceeds this size. */
export const LARGE_EXAMPLE_CHARS = 480;

/** Collapse by default when the formatted example has more than this many lines. */
export const LARGE_EXAMPLE_LINES = 16;

const MAX_SYNTH_DEPTH = 6;

function asObject(value: unknown): JsonSchemaObject | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as JsonSchemaObject)
		: null;
}

function text(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

/** Pretty-print JSON values; leave plain strings as-is (unless they are JSON text). */
export function formatExampleValue(value: unknown): string {
	if (value === undefined) return '';
	if (value === null) return 'null';
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (
			(trimmed.startsWith('{') && trimmed.endsWith('}')) ||
			(trimmed.startsWith('[') && trimmed.endsWith(']'))
		) {
			try {
				return JSON.stringify(JSON.parse(trimmed), null, 2);
			} catch {
				return value;
			}
		}
		return value;
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

/** Dump a value as YAML using the project js-yaml library. */
export function formatExampleAsYaml(value: unknown): string {
	if (value === undefined) return '';
	if (typeof value === 'string') {
		const parsed = tryParseJsonValue(value);
		if (parsed !== undefined) {
			return dumpYaml(parsed);
		}
		return value;
	}
	return dumpYaml(value);
}

function dumpYaml(value: unknown): string {
	try {
		return yaml
			.dump(value, {
				indent: 2,
				lineWidth: -1,
				noRefs: true,
				sortKeys: false
			})
			.replace(/\n$/, '');
	} catch {
		return String(value);
	}
}

function tryParseJsonValue(textValue: string): unknown | undefined {
	const trimmed = textValue.trim();
	if (!trimmed) return undefined;
	if (
		!(
			(trimmed.startsWith('{') && trimmed.endsWith('}')) ||
			(trimmed.startsWith('[') && trimmed.endsWith(']')) ||
			trimmed === 'null' ||
			trimmed === 'true' ||
			trimmed === 'false' ||
			/^-?\d+(\.\d+)?$/.test(trimmed)
		)
	) {
		return undefined;
	}
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
}

/** Resolve the raw value for an example (prefer stored value, else parse formatted JSON). */
export function getExampleRawValue(example: OpenApiExample): unknown {
	if (example.value !== undefined) return example.value;
	const parsed = tryParseJsonValue(example.formatted);
	if (parsed !== undefined) return parsed;
	return example.formatted;
}

/** Format an example for a representation format tab. */
export function formatExampleForRepresentation(
	example: OpenApiExample,
	format: RepresentationFormat
): string {
	if (format === 'yaml') {
		return formatExampleAsYaml(getExampleRawValue(example));
	}
	if (format === 'json') {
		const raw = getExampleRawValue(example);
		if (typeof raw === 'string' && tryParseJsonValue(raw) === undefined) {
			return raw;
		}
		return formatExampleValue(raw);
	}
	return example.formatted;
}

export function isLargeExample(example: Pick<OpenApiExample, 'formatted' | 'size'>): boolean {
	if (example.size > LARGE_EXAMPLE_CHARS) return true;
	return example.formatted.split('\n').length > LARGE_EXAMPLE_LINES;
}

function pushExample(
	out: OpenApiExample[],
	name: string,
	value: unknown,
	summary = '',
	description = '',
	synthesized = false
): void {
	if (value === undefined) return;
	const formatted = formatExampleValue(value);
	if (!formatted && value !== null && value !== false && value !== 0) return;
	out.push({
		name,
		summary: text(summary),
		description: text(description),
		formatted,
		size: formatted.length,
		value,
		synthesized
	});
}

function pushExamplesMap(out: OpenApiExample[], map: JsonSchemaObject): void {
	for (const [name, raw] of Object.entries(map)) {
		const entry = asObject(raw);
		if (entry && 'value' in entry) {
			pushExample(out, name, entry.value, text(entry.summary), text(entry.description));
		} else if (raw !== undefined) {
			pushExample(out, name, raw);
		}
	}
}

/**
 * Extract OpenAPI 3 `example` / `examples` (and `x-example` / `x-examples`) from a
 * media type object, parameter object, or any node that may carry those fields.
 *
 * When the source has a nested `schema` and no media-level examples, falls back to
 * `schema.example` / JSON Schema `schema.examples`.
 */
export function extractOpenApiExamples(
	source: JsonSchemaObject | null | undefined
): OpenApiExample[] {
	if (!source) return [];

	const out: OpenApiExample[] = [];

	if ('example' in source && source.example !== undefined) {
		pushExample(out, '', source.example);
	}

	const examples = asObject(source.examples);
	if (examples) {
		pushExamplesMap(out, examples);
	}

	if ('x-example' in source && source['x-example'] !== undefined) {
		pushExample(out, 'x-example', source['x-example']);
	}

	const xExamples = asObject(source['x-examples']);
	if (xExamples) {
		pushExamplesMap(out, xExamples);
	}

	if (out.length === 0) {
		const schema = asObject(source.schema);
		if (schema) {
			if (schema.example !== undefined) {
				pushExample(out, '', schema.example);
			}
			if (Array.isArray(schema.examples)) {
				for (let i = 0; i < schema.examples.length; i++) {
					pushExample(out, `examples[${i}]`, schema.examples[i]);
				}
			}
		}
	}

	return out;
}

/** Deduplicate examples by formatted body (keeps first occurrence). */
export function mergeOpenApiExamples(
	existing: OpenApiExample[],
	incoming: OpenApiExample[]
): OpenApiExample[] {
	if (incoming.length === 0) return existing;
	if (existing.length === 0) return [...incoming];
	const seen = new Set(existing.map((e) => e.formatted));
	const merged = [...existing];
	for (const example of incoming) {
		if (seen.has(example.formatted)) continue;
		seen.add(example.formatted);
		merged.push(example);
	}
	return merged;
}

function placeholderForType(type: unknown): unknown {
	switch (type) {
		case 'string':
			return 'string';
		case 'integer':
			return 0;
		case 'number':
			return 0;
		case 'boolean':
			return false;
		case 'null':
			return null;
		case 'array':
			return [];
		case 'object':
			return {};
		default:
			return null;
	}
}

/**
 * Build a minimal example value by walking an OpenAPI/JSON Schema.
 * Prefers `example` / `default` / first `enum` value, then type placeholders.
 */
export function synthesizeExampleFromSchema(
	spec: Record<string, unknown>,
	schema: JsonSchemaObject | undefined | null,
	seen: Set<string> = new Set(),
	depth = 0
): unknown {
	if (!schema || depth > MAX_SYNTH_DEPTH) return {};

	if (schema.example !== undefined) return schema.example;
	if (schema.default !== undefined) return schema.default;
	if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
	if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];

	if (typeof schema.$ref === 'string') {
		const ref = schema.$ref;
		if (seen.has(ref)) return {};
		const nextSeen = new Set(seen);
		nextSeen.add(ref);
		const resolved = resolveSchemaNode(spec, schema, new Set(seen));
		return synthesizeExampleFromSchema(spec, resolved, nextSeen, depth);
	}

	const resolved = resolveSchemaNode(spec, schema, new Set(seen));
	if (resolved !== schema && depth < MAX_SYNTH_DEPTH) {
		if (resolved.example !== undefined) return resolved.example;
		if (resolved.default !== undefined) return resolved.default;
		if (Array.isArray(resolved.enum) && resolved.enum.length > 0) return resolved.enum[0];
	}

	if (Array.isArray(resolved.oneOf) && resolved.oneOf.length > 0) {
		const first = asObject(resolved.oneOf[0]);
		if (first) return synthesizeExampleFromSchema(spec, first, seen, depth + 1);
	}
	if (Array.isArray(resolved.anyOf) && resolved.anyOf.length > 0) {
		const first = asObject(resolved.anyOf[0]);
		if (first) return synthesizeExampleFromSchema(spec, first, seen, depth + 1);
	}

	const type = resolved.type;

	if (type === 'array' || resolved.items) {
		const items = asObject(resolved.items) ?? {};
		const itemExample = synthesizeExampleFromSchema(spec, items, seen, depth + 1);
		return [itemExample];
	}

	if (type === 'object' || resolved.properties || resolved.additionalProperties) {
		const properties = asObject(resolved.properties);
		const out: Record<string, unknown> = {};
		if (properties) {
			const required = new Set(
				Array.isArray(resolved.required)
					? resolved.required.filter((r): r is string => typeof r === 'string')
					: []
			);
			const entries = Object.entries(properties);
			const ordered = [
				...entries.filter(([name]) => required.has(name)),
				...entries.filter(([name]) => !required.has(name))
			];
			for (const [name, propValue] of ordered) {
				const prop = asObject(propValue) ?? {};
				out[name] = synthesizeExampleFromSchema(spec, prop, seen, depth + 1);
			}
		}
		return out;
	}

	if (Array.isArray(type)) {
		const primary = type.find((t) => t !== 'null') ?? type[0];
		return placeholderForType(primary);
	}

	return placeholderForType(type);
}

/**
 * Return explicit OpenAPI examples, or a single synthesized example from the schema
 * when the spec omits examples (common for EDA QueryResponse GETs).
 */
export function resolveRepresentationExamples(
	spec: Record<string, unknown>,
	examples: OpenApiExample[],
	schema: JsonSchemaObject | undefined,
	options?: { hasEmptySchema?: boolean }
): OpenApiExample[] {
	if (examples.length > 0) return examples;
	if (options?.hasEmptySchema) return [];
	if (!schema || Object.keys(schema).length === 0) return [];

	const value = synthesizeExampleFromSchema(spec, schema);
	const formatted = formatExampleValue(value);
	if (!formatted && value !== null && value !== false && value !== 0) return [];

	return [
		{
			name: '',
			summary: 'Example',
			description: 'Synthesized from schema (no example in OpenAPI)',
			formatted,
			size: formatted.length,
			value,
			synthesized: true
		}
	];
}

function normalizeMediaType(contentType: string): string {
	return contentType.split(';')[0]?.trim().toLowerCase() ?? contentType.toLowerCase();
}

/** Map an OpenAPI media type to a representation format. */
export function mediaTypeToFormat(contentType: string): RepresentationFormat {
	const ct = normalizeMediaType(contentType);
	if (
		ct === 'application/json' ||
		ct.endsWith('+json') ||
		ct === 'text/json'
	) {
		return 'json';
	}
	if (
		ct === 'application/yaml' ||
		ct === 'application/x-yaml' ||
		ct === 'text/yaml' ||
		ct === 'text/x-yaml' ||
		ct.endsWith('+yaml')
	) {
		return 'yaml';
	}
	if (ct === 'application/json+yaml' || ct === 'application/yaml+json') {
		return 'json';
	}
	return 'text';
}

function formatTabLabel(format: RepresentationFormat, contentType: string): string {
	if (format === 'json') return 'JSON';
	if (format === 'yaml') return 'YAML';
	const short = normalizeMediaType(contentType);
	if (short.startsWith('text/')) return short.slice(5) || short;
	const slash = short.lastIndexOf('/');
	return slash >= 0 ? short.slice(slash + 1) : short;
}

/**
 * Build selectable JSON / YAML / other tabs from a media content group's content types.
 * Does not merge into a single non-interactive label — each format is a tab.
 * `application/json+yaml` expands to both JSON and YAML.
 */
export function buildRepresentationMediaOptions(
	contentTypes: string[]
): RepresentationMediaOption[] {
	const options: RepresentationMediaOption[] = [];
	const seen = new Set<string>();

	for (const contentType of contentTypes) {
		const ct = normalizeMediaType(contentType);
		if (ct === 'application/json+yaml' || ct === 'application/yaml+json') {
			for (const [id, label, format] of [
				['json', 'JSON', 'json'],
				['yaml', 'YAML', 'yaml']
			] as const) {
				if (seen.has(id)) continue;
				seen.add(id);
				options.push({
					id,
					label,
					contentTypes: [contentType],
					format
				});
			}
			continue;
		}

		const format = mediaTypeToFormat(contentType);
		const id =
			format === 'json' ? 'json' : format === 'yaml' ? 'yaml' : `text:${ct}`;
		if (seen.has(id)) {
			const existing = options.find((o) => o.id === id);
			if (existing && !existing.contentTypes.includes(contentType)) {
				existing.contentTypes.push(contentType);
			}
			continue;
		}
		seen.add(id);
		options.push({
			id,
			label: formatTabLabel(format, contentType),
			contentTypes: [contentType],
			format
		});
	}

	const rank = (id: string) => (id === 'json' ? 0 : id === 'yaml' ? 1 : 2);
	return options.sort((a, b) => rank(a.id) - rank(b.id) || a.label.localeCompare(b.label));
}
