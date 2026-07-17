import {
	extractOpenApiExamples,
	mergeOpenApiExamples,
	type OpenApiExample
} from './openApiExamples';
import { describeSchemaType, refName, type JsonSchemaObject } from './schemaBrowser';
import { extractVendorExtensions, type VendorExtensionEntry } from './vendorExtensions';

export type { OpenApiExample } from './openApiExamples';
export {
	buildRepresentationMediaOptions,
	extractOpenApiExamples,
	formatExampleAsYaml,
	formatExampleForRepresentation,
	formatExampleValue,
	isLargeExample,
	mediaTypeToFormat,
	mergeOpenApiExamples,
	resolveRepresentationExamples,
	synthesizeExampleFromSchema,
	LARGE_EXAMPLE_CHARS,
	type RepresentationFormat,
	type RepresentationMediaOption
} from './openApiExamples';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface OpenApiExternalDocs {
	url: string;
	description: string;
}

export interface OpenApiParameter {
	name: string;
	in: string;
	required: boolean;
	description: string;
	type: string;
	schema?: JsonSchemaObject;
	schemaRef?: string;
	/** First/simple example string for compact table display. */
	example?: string;
	/** Full example set from `example` / `examples` / `x-examples`. */
	examples: OpenApiExample[];
	/** Compact type-column hints (`default`, `enum`, `format`) without expanding schema. */
	typeHints: string[];
	deprecated: boolean;
	extensions: VendorExtensionEntry[];
}

/** Resolved security scheme reference for display (Bearer JWT, API key, …). */
export interface OpenApiSecurityRequirement {
	schemeName: string;
	/** OpenAPI security scheme `type` (http, apiKey, oauth2, …). */
	type: string;
	/** HTTP auth scheme when type is `http` (e.g. bearer). */
	scheme?: string;
	/** Bearer token format when present (e.g. JWT). */
	bearerFormat?: string;
	scopes: string[];
	/** Compact human label, e.g. `Bearer JWT`. */
	label: string;
}

/** Per-operation auth after resolving `security` against `components.securitySchemes`. */
export interface OpenApiOperationSecurity {
	/** True when the operation declares `security: []` (explicitly public). */
	isPublic: boolean;
	/** True when the operation omits `security` and inherits the document default. */
	inherited: boolean;
	requirements: OpenApiSecurityRequirement[];
	/** Compact chip label: `Public (no auth)`, `Bearer JWT`, … */
	label: string;
}

/** Document-level security schemes + global `security` summary. */
export interface OpenApiSecuritySummary {
	schemes: OpenApiSecurityRequirement[];
	globalRequirements: OpenApiSecurityRequirement[];
	/** True when the document has no global security and no schemes. */
	isOpen: boolean;
	label: string;
}

export interface OpenApiResponseContent {
	contentType: string;
	schema?: JsonSchemaObject;
	schemaRef?: string;
	schemaType: string;
	/** True when the spec declares an empty schema object (e.g. text/csv with no structure). */
	hasEmptySchema: boolean;
	examples: OpenApiExample[];
}

/** Response (or request body) media entries merged when they share the same schema. */
export interface OpenApiMediaContentGroup {
	contentTypes: string[];
	schema?: JsonSchemaObject;
	schemaRef?: string;
	schemaType: string;
	hasEmptySchema: boolean;
	examples: OpenApiExample[];
}

export interface OpenApiResponseHeader {
	name: string;
	description: string;
	required: boolean;
	type: string;
	schema?: JsonSchemaObject;
	schemaRef?: string;
}

export interface OpenApiRequestBodyContent {
	contentType: string;
	schema?: JsonSchemaObject;
	schemaRef?: string;
	schemaType: string;
	hasEmptySchema: boolean;
	examples: OpenApiExample[];
}

export interface OpenApiResponse {
	status: string;
	description: string;
	schemaRef?: string;
	contentTypes: string[];
	content: OpenApiResponseContent[];
	headers: OpenApiResponseHeader[];
	extensions: VendorExtensionEntry[];
}

export interface OpenApiRequestBody {
	description: string;
	contentTypes: string[];
	content: OpenApiRequestBodyContent[];
	schemaRef?: string;
	required: boolean;
	extensions: VendorExtensionEntry[];
}

export interface OpenApiOperation {
	id: string;
	path: string;
	method: HttpMethod;
	summary: string;
	description: string;
	operationId: string;
	tags: string[];
	deprecated: boolean;
	externalDocs?: OpenApiExternalDocs;
	parameters: OpenApiParameter[];
	requestBody?: OpenApiRequestBody;
	responses: OpenApiResponse[];
	extensions: VendorExtensionEntry[];
	pathExtensions: VendorExtensionEntry[];
	isQueryEndpoint: boolean;
	/** Resolved auth for this operation (public, inherited Bearer JWT, …). */
	security: OpenApiOperationSecurity;
}

export interface OpenApiTagGroup {
	name: string;
	description: string;
	operations: OpenApiOperation[];
}

export interface PathBrowserData {
	tagGroups: OpenApiTagGroup[];
	totalPaths: number;
	totalOperations: number;
	defaultExpandedTags: string[];
	/** Document `info.description` for the viewer subtitle. */
	infoDescription: string;
	/** Global security schemes + default requirements. */
	securitySummary: OpenApiSecuritySummary;
}

export interface OpenApiParameterGroup {
	in: string;
	label: string;
	parameters: OpenApiParameter[];
}

const PARAMETER_LOCATION_ORDER = ['path', 'query', 'header', 'cookie'] as const;

const PARAMETER_LOCATION_LABELS: Record<string, string> = {
	path: 'Path parameters',
	query: 'Query parameters',
	header: 'Header parameters',
	cookie: 'Cookie parameters'
};

/** Fallback tag when an operation has no `tags` array. */
export const UNTAGGED_LABEL = 'Untagged';

/** Tags that should appear first in the path browser sidebar. */
const PRIORITY_TAGS = ['coreQuery'] as const;

/** Human-readable label for an OpenAPI operation tag (e.g. coreQuery → Core Query). */
export function formatOpenApiTagLabel(tag: string): string {
	if (!tag.startsWith('core') || tag.length <= 4) return tag;
	const rest = tag.slice(4);
	return `Core ${rest.replace(/([a-z])([A-Z])/g, '$1 $2')}`;
}

/** Primary tag label for an operation detail header. */
export function getOperationTagLabel(
	operation: Pick<OpenApiOperation, 'tags' | 'isQueryEndpoint'>
): string {
	const tag = operation.tags[0];
	if (tag) return formatOpenApiTagLabel(tag);
	return operation.isQueryEndpoint ? 'Query' : '';
}

/** Whether a response status represents an error (default, 4xx, 5xx). */
export function isErrorResponseStatus(status: string): boolean {
	if (status === 'default') return true;
	const code = Number(status);
	return !Number.isNaN(code) && code >= 400;
}

/** Long or multi-paragraph descriptions start collapsed in the operation header. */
export function shouldCollapseOperationDescription(description: string): boolean {
	return description.length > 180 || description.includes('\n\n');
}

/**
 * Reflow OpenAPI description text for full-width display.
 * Spec authors often hard-wrap at ~80 columns; preserving those breaks with
 * `white-space: pre-wrap` leaves the right half of a wide modal empty.
 * Blank lines stay as paragraph breaks; single newlines join with spaces.
 */
export function formatOperationDescriptionParagraphs(description: string): string[] {
	const normalized = description.replace(/\r\n/g, '\n').trim();
	if (!normalized) return [];
	return normalized
		.split(/\n\s*\n/)
		.map((para) =>
			para
				.split('\n')
				.map((line) => line.trim())
				.filter(Boolean)
				.join(' ')
				.replace(/\s+/g, ' ')
				.trim()
		)
		.filter(Boolean);
}

function mediaContentGroupKey(item: OpenApiResponseContent): string {
	if (item.hasEmptySchema) return `empty:${item.contentType}`;
	if (item.schemaRef) return `ref:${item.schemaRef}`;
	return `inline:${item.contentType}:${item.schemaType}`;
}

/**
 * Merge media content entries that share the same schema (e.g. application/json + application/yaml).
 * Empty or distinct inline schemas stay separate per content type.
 */
export function groupMediaContentBySchema(
	content: OpenApiResponseContent[]
): OpenApiMediaContentGroup[] {
	const groups = new Map<string, OpenApiMediaContentGroup>();

	for (const item of content) {
		const key = mediaContentGroupKey(item);
		const existing = groups.get(key);
		if (existing) {
			existing.contentTypes.push(item.contentType);
			existing.examples = mergeOpenApiExamples(existing.examples, item.examples);
			continue;
		}
		groups.set(key, {
			contentTypes: [item.contentType],
			schema: item.schema,
			schemaRef: item.schemaRef,
			schemaType: item.schemaType,
			hasEmptySchema: item.hasEmptySchema,
			examples: [...item.examples]
		});
	}

	return Array.from(groups.values()).map((group) => ({
		...group,
		contentTypes: [...group.contentTypes].sort((a, b) => a.localeCompare(b))
	}));
}

/** Format merged content-type badges for display (e.g. `application/json · application/yaml`). */
export function formatMediaContentTypeBadges(contentTypes: string[]): string {
	return contentTypes.join(' · ');
}

function compareTagNames(a: string, b: string): number {
	const aPriority = PRIORITY_TAGS.indexOf(a as (typeof PRIORITY_TAGS)[number]);
	const bPriority = PRIORITY_TAGS.indexOf(b as (typeof PRIORITY_TAGS)[number]);
	if (aPriority >= 0 || bPriority >= 0) {
		if (aPriority < 0) return 1;
		if (bPriority < 0) return -1;
		return aPriority - bPriority;
	}
	return a.localeCompare(b);
}

function mediaSchemaType(schema: JsonSchemaObject, contentType: string): string {
	if (Object.keys(schema).length === 0) {
		if (contentType.includes('csv') || contentType.startsWith('text/')) {
			return 'plain text';
		}
		return 'any';
	}
	return describeSchemaType(schema);
}

function parameterKey(param: Pick<OpenApiParameter, 'in' | 'name'>): string {
	return `${param.in}:${param.name}`;
}

/** Whether a query parameter is the primary EQL input on a query endpoint. */
export function isPrimaryQueryParameter(
	param: Pick<OpenApiParameter, 'in' | 'name'>,
	operation: Pick<OpenApiOperation, 'isQueryEndpoint'>
): boolean {
	return operation.isQueryEndpoint && param.in === 'query' && param.name === 'query';
}

/** Sort parameters so the primary EQL `query` param appears first within its group. */
export function sortParametersForDisplay(parameters: OpenApiParameter[]): OpenApiParameter[] {
	return [...parameters].sort((a, b) => {
		const aPrimary = a.in === 'query' && a.name === 'query';
		const bPrimary = b.in === 'query' && b.name === 'query';
		if (aPrimary !== bPrimary) return aPrimary ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
}

/** Merge path-, operation-, and optional global-level parameters; operation wins on conflict. */
export function mergeOpenApiParameters(
	pathLevel: OpenApiParameter[],
	operationLevel: OpenApiParameter[],
	globalLevel: OpenApiParameter[] = []
): OpenApiParameter[] {
	const parametersByKey = new Map<string, OpenApiParameter>();
	for (const param of globalLevel) {
		parametersByKey.set(parameterKey(param), param);
	}
	for (const param of pathLevel) {
		parametersByKey.set(parameterKey(param), param);
	}
	for (const param of operationLevel) {
		parametersByKey.set(parameterKey(param), param);
	}
	return Array.from(parametersByKey.values()).sort((a, b) => {
		const inCmp = a.in.localeCompare(b.in);
		if (inCmp !== 0) return inCmp;
		return a.name.localeCompare(b.name);
	});
}

/** Group parameters by OpenAPI `in` for sectioned rendering (path → query → header → cookie). */
export function groupParametersByLocation(parameters: OpenApiParameter[]): OpenApiParameterGroup[] {
	const byIn = new Map<string, OpenApiParameter[]>();
	for (const param of parameters) {
		const list = byIn.get(param.in) ?? [];
		list.push(param);
		byIn.set(param.in, list);
	}

	const orderedIns = [
		...PARAMETER_LOCATION_ORDER.filter((location) => byIn.has(location)),
		...[...byIn.keys()]
			.filter(
				(location) =>
					!PARAMETER_LOCATION_ORDER.includes(location as (typeof PARAMETER_LOCATION_ORDER)[number])
			)
			.sort((a, b) => a.localeCompare(b))
	];

	return orderedIns.map((location) => ({
		in: location,
		label: PARAMETER_LOCATION_LABELS[location] ?? `${location} parameters`,
		parameters: sortParametersForDisplay(byIn.get(location) ?? [])
	}));
}

/** Whether an inline schema block adds detail beyond the Type column (+ hints). */
export function shouldShowInlineParameterSchema(param: OpenApiParameter): boolean {
	if (param.schemaRef) return true;
	const schema = param.schema;
	if (!schema) return false;
	if (typeof schema.$ref === 'string') return true;
	if (schema.allOf || schema.oneOf || schema.anyOf) return true;
	if (schema.properties && typeof schema.properties === 'object') {
		return Object.keys(schema.properties as Record<string, unknown>).length > 0;
	}
	if (schema.type === 'array') return true;
	if (schema.additionalProperties !== undefined) return true;
	// Simple scalars with enum / format / default are shown as typeHints — no expand needed.
	return false;
}

/**
 * Compact type-column hints from a parameter schema (`default`, `enum`, `format`).
 * Shown next to the type without requiring the Schema expander.
 */
export function extractParameterTypeHints(schema: JsonSchemaObject | undefined): string[] {
	if (!schema) return [];
	const hints: string[] = [];

	if (typeof schema.format === 'string' && schema.format.length > 0) {
		hints.push(`format: ${schema.format}`);
	}

	if (Array.isArray(schema.enum) && schema.enum.length > 0) {
		const values = schema.enum.slice(0, 6).map(String);
		const suffix = schema.enum.length > 6 ? ', …' : '';
		hints.push(`enum: ${values.join(' | ')}${suffix}`);
	}

	if (schema.default !== undefined) {
		hints.push(`default: ${JSON.stringify(schema.default)}`);
	}

	return hints;
}

function securitySchemeLabel(
	schemeName: string,
	scheme: JsonSchemaObject | null
): Omit<OpenApiSecurityRequirement, 'scopes'> {
	if (!scheme) {
		return { schemeName, type: 'unknown', label: schemeName };
	}

	const type = text(scheme.type) || 'unknown';
	const httpScheme = text(scheme.scheme);
	const bearerFormat = text(scheme.bearerFormat);

	if (type === 'http' && httpScheme.toLowerCase() === 'bearer') {
		const label = bearerFormat ? `Bearer ${bearerFormat}` : 'Bearer';
		return {
			schemeName,
			type,
			scheme: httpScheme,
			bearerFormat: bearerFormat || undefined,
			label
		};
	}

	if (type === 'http' && httpScheme) {
		return {
			schemeName,
			type,
			scheme: httpScheme,
			bearerFormat: bearerFormat || undefined,
			label: `${httpScheme}${bearerFormat ? ` (${bearerFormat})` : ''}`
		};
	}

	if (type === 'apiKey') {
		const name = text(scheme.name) || schemeName;
		const location = text(scheme.in);
		return {
			schemeName,
			type,
			label: location ? `API key (${location}: ${name})` : `API key (${name})`
		};
	}

	if (type === 'oauth2') {
		return { schemeName, type, label: 'OAuth2' };
	}

	if (type === 'openIdConnect') {
		return { schemeName, type, label: 'OpenID Connect' };
	}

	return { schemeName, type, label: schemeName };
}

function parseSecuritySchemes(
	spec: Record<string, unknown>
): Map<string, JsonSchemaObject> {
	const components = asObject(spec.components);
	const schemes = asObject(components?.securitySchemes);
	const map = new Map<string, JsonSchemaObject>();
	if (!schemes) return map;
	for (const [name, value] of Object.entries(schemes)) {
		const scheme = asObject(value);
		if (scheme) map.set(name, scheme);
	}
	return map;
}

function resolveSecurityRequirements(
	raw: unknown,
	schemes: Map<string, JsonSchemaObject>
): OpenApiSecurityRequirement[] {
	if (!Array.isArray(raw)) return [];
	const resolved: OpenApiSecurityRequirement[] = [];

	for (const entry of raw) {
		const req = asObject(entry);
		if (!req) continue;
		for (const [schemeName, scopesValue] of Object.entries(req)) {
			const scopes = Array.isArray(scopesValue)
				? scopesValue.filter((s): s is string => typeof s === 'string')
				: [];
			const base = securitySchemeLabel(schemeName, schemes.get(schemeName) ?? null);
			resolved.push({ ...base, scopes });
		}
	}

	return resolved;
}

function formatSecurityLabel(
	requirements: OpenApiSecurityRequirement[],
	isPublic: boolean
): string {
	if (isPublic) return 'Public (no auth)';
	if (requirements.length === 0) return 'No auth required';
	const unique = [...new Set(requirements.map((r) => r.label))];
	return unique.join(' · ');
}

/** Build document-level security summary from `components.securitySchemes` + global `security`. */
export function buildSecuritySummary(spec: Record<string, unknown>): OpenApiSecuritySummary {
	const schemesMap = parseSecuritySchemes(spec);
	const schemes = Array.from(schemesMap.entries()).map(([name, scheme]) => ({
		...securitySchemeLabel(name, scheme),
		scopes: [] as string[]
	}));
	const globalRequirements = resolveSecurityRequirements(spec.security, schemesMap);
	const isOpen = schemes.length === 0 && globalRequirements.length === 0;
	return {
		schemes,
		globalRequirements,
		isOpen,
		label: formatSecurityLabel(globalRequirements, false)
	};
}

/**
 * Resolve operation `security` against schemes, falling back to document-level `security`.
 * An empty array (`security: []`) means the operation is explicitly public.
 */
export function resolveOperationSecurity(
	operationSecurity: unknown,
	globalSecurity: unknown,
	schemes: Map<string, JsonSchemaObject>
): OpenApiOperationSecurity {
	if (Array.isArray(operationSecurity)) {
		if (operationSecurity.length === 0) {
			return {
				isPublic: true,
				inherited: false,
				requirements: [],
				label: 'Public (no auth)'
			};
		}
		const requirements = resolveSecurityRequirements(operationSecurity, schemes);
		return {
			isPublic: false,
			inherited: false,
			requirements,
			label: formatSecurityLabel(requirements, false)
		};
	}

	const requirements = resolveSecurityRequirements(globalSecurity, schemes);
	return {
		isPublic: false,
		inherited: true,
		requirements,
		label: formatSecurityLabel(requirements, false)
	};
}

/** Extract `info.description` from an OpenAPI document. */
export function getSpecInfoDescription(spec: Record<string, unknown>): string {
	const info = asObject(spec.info);
	return info ? text(info.description) : '';
}

function asObject(value: unknown): JsonSchemaObject | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as JsonSchemaObject)
		: null;
}

function schemaRefFrom(value: unknown): string | undefined {
	const schema = asObject(value);
	if (!schema) return undefined;
	if (typeof schema.$ref === 'string') return refName(schema.$ref);
	return undefined;
}

function text(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function isHttpMethod(key: string): key is HttpMethod {
	return (HTTP_METHODS as readonly string[]).includes(key);
}

/**
 * How an operation accepts caller input in OpenAPI terms.
 *
 * OpenAPI splits "request" across two fields:
 * - `parameters` — path, query, header, and cookie inputs (common on GET/DELETE)
 * - `requestBody` — JSON/form payload (common on POST/PUT/PATCH)
 *
 * The path browser UI merges both under a single "Request" section so it mirrors
 * the "Response" section (which always comes from `responses`).
 */
export type OperationRequestInputKind = 'parameters' | 'requestBody' | 'both' | 'none';

export function getOperationRequestInputKind(
	operation: Pick<OpenApiOperation, 'parameters' | 'requestBody'>
): OperationRequestInputKind {
	const hasParameters = operation.parameters.length > 0;
	const hasRequestBody = Boolean(operation.requestBody);
	if (hasParameters && hasRequestBody) return 'both';
	if (hasRequestBody) return 'requestBody';
	if (hasParameters) return 'parameters';
	return 'none';
}

/** Whether the operation detail panel should show the Request section. */
export function shouldShowRequestSection(
	operation: Pick<OpenApiOperation, 'parameters' | 'requestBody'>
): boolean {
	return getOperationRequestInputKind(operation) !== 'none';
}

/** Whether a path should be visually highlighted as a query/EQL endpoint. */
export function isQueryEndpointPath(path: string): boolean {
	const lower = path.toLowerCase();
	return lower.includes('/query/') || lower.includes('/eql');
}

function formatExample(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === 'string') return value.trim() || undefined;
	return JSON.stringify(value);
}

function parseExternalDocs(value: unknown): OpenApiExternalDocs | undefined {
	const docs = asObject(value);
	if (!docs || typeof docs.url !== 'string') return undefined;
	return {
		url: docs.url,
		description: text(docs.description)
	};
}

function parseParameter(param: JsonSchemaObject): OpenApiParameter {
	const schema = asObject(param.schema) ?? {};
	const examples = extractOpenApiExamples(param);
	const schemaObj = Object.keys(schema).length > 0 ? schema : undefined;
	return {
		name: text(param.name),
		in: text(param.in),
		required: param.required === true,
		description: text(param.description),
		type: describeSchemaType(schema),
		schema: schemaObj,
		schemaRef: schemaRefFrom(schema),
		example: examples[0]?.formatted ?? formatExample(param.example ?? schema.example),
		examples,
		typeHints: extractParameterTypeHints(schemaObj),
		deprecated: param.deprecated === true,
		extensions: extractVendorExtensions(param)
	};
}

function parseRequestBodyContent(content: JsonSchemaObject): OpenApiRequestBodyContent[] {
	return Object.entries(content)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([contentType, value]) => {
			const media = asObject(value) ?? {};
			const schema = asObject(media.schema) ?? {};
			const hasEmptySchema = Object.keys(schema).length === 0;
			return {
				contentType,
				schema: hasEmptySchema ? undefined : schema,
				schemaRef: schemaRefFrom(schema),
				schemaType: mediaSchemaType(schema, contentType),
				hasEmptySchema,
				examples: extractOpenApiExamples(media)
			};
		});
}

function parseRequestBody(body: JsonSchemaObject): OpenApiRequestBody | undefined {
	const content = asObject(body.content);
	if (!content) return undefined;

	const contentTypes = Object.keys(content);
	const parsedContent = parseRequestBodyContent(content);
	const schemaRef = parsedContent.find((entry) => entry.schemaRef)?.schemaRef;

	return {
		description: text(body.description),
		contentTypes,
		content: parsedContent,
		schemaRef,
		required: body.required === true,
		extensions: extractVendorExtensions(body)
	};
}

function parseResponseHeaders(headers: JsonSchemaObject): OpenApiResponseHeader[] {
	return Object.entries(headers)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, value]) => {
			const header = asObject(value) ?? {};
			const schema = asObject(header.schema) ?? {};
			return {
				name,
				description: text(header.description),
				required: header.required === true,
				type: describeSchemaType(schema),
				schema: Object.keys(schema).length > 0 ? schema : undefined,
				schemaRef: schemaRefFrom(schema)
			};
		});
}

function parseResponseContent(content: JsonSchemaObject): OpenApiResponseContent[] {
	return Object.entries(content)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([contentType, value]) => {
			const media = asObject(value) ?? {};
			const schema = asObject(media.schema) ?? {};
			const hasEmptySchema = Object.keys(schema).length === 0;
			return {
				contentType,
				schema: hasEmptySchema ? undefined : schema,
				schemaRef: schemaRefFrom(schema),
				schemaType: mediaSchemaType(schema, contentType),
				hasEmptySchema,
				examples: extractOpenApiExamples(media)
			};
		});
}

function parseResponses(responses: JsonSchemaObject): OpenApiResponse[] {
	return Object.entries(responses)
		.sort(([a], [b]) => {
			const na = Number(a);
			const nb = Number(b);
			if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
			return a.localeCompare(b);
		})
		.map(([status, value]) => {
			const response = asObject(value) ?? {};
			const content = asObject(response.content);
			const parsedContent = content ? parseResponseContent(content) : [];
			const contentTypes = parsedContent.map((entry) => entry.contentType);
			const schemaRef = parsedContent.find((entry) => entry.schemaRef)?.schemaRef;
			const headers = asObject(response.headers);

			return {
				status,
				description: text(response.description),
				schemaRef,
				contentTypes,
				content: parsedContent,
				headers: headers ? parseResponseHeaders(headers) : [],
				extensions: extractVendorExtensions(response)
			};
		});
}

function operationId(path: string, method: HttpMethod): string {
	return `${method.toUpperCase()} ${path}`;
}

const pathBrowserCache = new WeakMap<object, PathBrowserData>();

/**
 * Parse sanitized OpenAPI spec into tag-grouped operations for the path browser.
 *
 * For each path item and HTTP method we read:
 * - `parameters` (path / operation / global, merged) → Request section tables
 * - `requestBody.content.*.schema` → Request section body schema blocks
 * - `responses.*.content.*.schema` → Response section schema blocks
 */
export function buildPathBrowserData(spec: Record<string, unknown>): PathBrowserData {
	const cached = pathBrowserCache.get(spec);
	if (cached) return cached;

	const paths = asObject(spec.paths) ?? {};
	const schemesMap = parseSecuritySchemes(spec);
	const securitySummary = buildSecuritySummary(spec);
	const infoDescription = getSpecInfoDescription(spec);
	const globalLevelParameters = Array.isArray(spec.parameters)
		? spec.parameters
				.map((p) => asObject(p))
				.filter((p): p is JsonSchemaObject => p !== null)
				.map(parseParameter)
		: [];
	const tagDescriptions = new Map<string, string>();
	const rawTags = spec.tags;
	if (Array.isArray(rawTags)) {
		for (const entry of rawTags) {
			const tag = asObject(entry);
			if (!tag) continue;
			const name = text(tag.name);
			if (name) tagDescriptions.set(name, text(tag.description));
		}
	}

	const operations: OpenApiOperation[] = [];

	for (const [path, pathItemValue] of Object.entries(paths)) {
		const pathItem = asObject(pathItemValue);
		if (!pathItem) continue;

		const pathLevelParameters = Array.isArray(pathItem.parameters)
			? pathItem.parameters
					.map((p) => asObject(p))
					.filter((p): p is JsonSchemaObject => p !== null)
					.map(parseParameter)
			: [];
		const pathExtensions = extractVendorExtensions(pathItem);

		for (const [key, operationValue] of Object.entries(pathItem)) {
			if (!isHttpMethod(key)) continue;
			const operation = asObject(operationValue);
			if (!operation) continue;

			const tags = Array.isArray(operation.tags)
				? operation.tags.filter((t): t is string => typeof t === 'string')
				: [];

			const operationParameters = Array.isArray(operation.parameters)
				? operation.parameters
						.map((p) => asObject(p))
						.filter((p): p is JsonSchemaObject => p !== null)
						.map(parseParameter)
				: [];
			const parameters = mergeOpenApiParameters(
				pathLevelParameters,
				operationParameters,
				globalLevelParameters
			);

			operations.push({
				id: operationId(path, key),
				path,
				method: key,
				summary: text(operation.summary),
				description: text(operation.description),
				operationId: text(operation.operationId),
				tags,
				deprecated: operation.deprecated === true,
				externalDocs: parseExternalDocs(operation.externalDocs),
				parameters,
				requestBody: operation.requestBody
					? parseRequestBody(asObject(operation.requestBody) ?? {})
					: undefined,
				responses: operation.responses ? parseResponses(asObject(operation.responses) ?? {}) : [],
				extensions: extractVendorExtensions(operation),
				pathExtensions,
				isQueryEndpoint: isQueryEndpointPath(path),
				security: resolveOperationSecurity(operation.security, spec.security, schemesMap)
			});
		}
	}

	operations.sort((a, b) => {
		const tagCmp = compareTagNames(a.tags[0] ?? '', b.tags[0] ?? '');
		if (tagCmp !== 0) return tagCmp;
		const pathCmp = a.path.localeCompare(b.path);
		if (pathCmp !== 0) return pathCmp;
		return a.method.localeCompare(b.method);
	});

	const byTag = new Map<string, OpenApiOperation[]>();
	for (const op of operations) {
		const tag = op.tags[0] ?? UNTAGGED_LABEL;
		const list = byTag.get(tag) ?? [];
		list.push(op);
		byTag.set(tag, list);
	}

	const tagGroups: OpenApiTagGroup[] = Array.from(byTag.entries())
		.sort(([a], [b]) => compareTagNames(a, b))
		.map(([name, ops]) => ({
			name,
			description: tagDescriptions.get(name) ?? '',
			operations: [...ops].sort((a, b) => {
				const pathCmp = a.path.localeCompare(b.path);
				if (pathCmp !== 0) return pathCmp;
				return a.method.localeCompare(b.method);
			})
		}));

	// All tag groups start collapsed; the UI expands deep-link / search matches.
	const defaultExpandedTags: string[] = [];

	const result = {
		tagGroups,
		totalPaths: Object.keys(paths).length,
		totalOperations: operations.length,
		defaultExpandedTags,
		infoDescription,
		securitySummary
	};
	pathBrowserCache.set(spec, result);
	return result;
}

/** Stable id for deep links (`#operationId` in the URL hash). */
export function getOperationDeepLinkId(operation: OpenApiOperation): string {
	return operation.operationId || operation.id;
}

/** Find an operation by OpenAPI `operationId` or synthetic `METHOD path` id. */
export function findOperationByDeepLinkId(
	operations: OpenApiOperation[],
	deepLinkId: string
): OpenApiOperation | undefined {
	if (!deepLinkId) return undefined;
	return operations.find((op) => op.operationId === deepLinkId || op.id === deepLinkId);
}

/** Filter operations by search query and optional HTTP method. */
export function filterPathBrowserOperations(
	operations: OpenApiOperation[],
	query: string,
	method: HttpMethod | 'all'
): OpenApiOperation[] {
	const q = query.trim().toLowerCase();
	return operations.filter((op) => {
		if (method !== 'all' && op.method !== method) return false;
		if (!q) return true;
		if (op.path.toLowerCase().includes(q)) return true;
		if (op.summary.toLowerCase().includes(q)) return true;
		if (op.description.toLowerCase().includes(q)) return true;
		if (op.operationId.toLowerCase().includes(q)) return true;
		if (op.tags.some((t) => t.toLowerCase().includes(q))) return true;
		if (op.method.includes(q)) return true;
		return false;
	});
}
