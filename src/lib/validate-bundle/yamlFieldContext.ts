import type { SchemaSections } from '$lib/yaml-validation/schemaCache';
import {
	collectSchemaProperties,
	getItemsSchema,
	resolveSchemaAtPath,
	schemaLeafMeta,
	type SchemaLeafMeta
} from './schemaNavigation';
import type { BundleResource } from './types';
import {
	resolveYamlCursor,
	specPathFromYamlPath,
	type YamlCursor
} from './yamlCursor';
import { schemaKeyForResource, type YamlCompletionContext } from './yamlSchemaKeys';

export type YamlFieldContext = {
	cursor: YamlCursor;
	resource?: BundleResource;
	sections?: SchemaSections;
	specPath: string[];
	parentSchema?: unknown;
	leafSchema?: unknown;
	fieldName?: string;
	meta?: SchemaLeafMeta;
	inSpec: boolean;
	inMetadata: boolean;
};

function objectPropertiesSchema(schema: unknown): unknown {
	if (!schema || typeof schema !== 'object') return schema;
	const node = schema as Record<string, unknown>;
	if (node.type === 'array') return getItemsSchema(schema);
	return schema;
}

export function schemaNodeForKeyParent(
	specSchema: unknown,
	specPath: string[],
	inArrayItem: boolean
): unknown {
	if (inArrayItem) {
		if (specPath.length === 0) return null;
		const resolved = resolveSchemaAtPath(specSchema, specPath);
		return resolved ? getItemsSchema(resolved.schema) : null;
	}
	if (specPath.length === 0) return specSchema;
	const resolved = resolveSchemaAtPath(specSchema, specPath);
	if (!resolved?.schema) return null;
	return objectPropertiesSchema(resolved.schema);
}

export function schemaNodeForValue(
	specSchema: unknown,
	specPath: string[],
	inArrayItem: boolean
): { leafSchema: unknown; parentSchema: unknown; fieldName: string } | null {
	if (specPath.length === 0) {
		return {
			leafSchema: specSchema,
			parentSchema: specSchema,
			fieldName: 'spec'
		};
	}

	if (inArrayItem) {
		const resolved = resolveSchemaAtPath(specSchema, specPath);
		if (!resolved) return null;
		const itemSchema = getItemsSchema(resolved.schema);
		if (!itemSchema) return null;
		return {
			leafSchema: itemSchema,
			parentSchema: resolved.schema ?? specSchema,
			fieldName: ''
		};
	}

	const fieldName = specPath[specPath.length - 1] ?? '';
	const parentPath = specPath.slice(0, -1);
	const parentResolved =
		parentPath.length === 0
			? { schema: specSchema, path: [] as string[] }
			: resolveSchemaAtPath(specSchema, parentPath);
	const leafResolved = resolveSchemaAtPath(specSchema, specPath);
	if (!parentResolved || !leafResolved) return null;
	return {
		leafSchema: leafResolved.schema,
		parentSchema: parentResolved.schema ?? specSchema,
		fieldName: leafResolved.path[leafResolved.path.length - 1] ?? fieldName
	};
}

export function schemaHasPropertyKeys(schema: unknown): boolean {
	const props = collectSchemaProperties(schema);
	return !!props && props.size > 0;
}

function resourceForDoc(ctx: YamlCompletionContext, docIndex: number): BundleResource | undefined {
	return ctx.resources.find((r) => r.docIndex + 1 === docIndex);
}

/** Resolve cursor position to schema field context for completions, hover, and markers. */
export function resolveYamlFieldContext(
	yaml: string,
	line: number,
	column: number,
	ctx: YamlCompletionContext | null
): YamlFieldContext | null {
	const cursor = resolveYamlCursor(yaml, line, column);
	if (!cursor) return null;

	const inSpec = cursor.yamlPath.includes('spec');
	const inMetadata = cursor.yamlPath.includes('metadata');
	const specPath = specPathFromYamlPath(cursor.yamlPath);

	const base: YamlFieldContext = {
		cursor,
		specPath,
		inSpec,
		inMetadata
	};

	if (!inSpec || !ctx || ctx.resources.length === 0) {
		return base;
	}

	const resource = resourceForDoc(ctx, cursor.docIndex);
	if (!resource) return base;

	const schemaKey = resource.kind ? schemaKeyForResource(ctx, resource) : null;
	const sections = schemaKey ? ctx.schemas.get(schemaKey) : null;
	if (!sections?.spec) {
		return { ...base, resource };
	}

	if (cursor.completionKind === 'key' || cursor.completionKind === 'array-item') {
		const parentSchema = schemaNodeForKeyParent(
			sections.spec,
			specPath,
			cursor.inArrayItem
		);
		return {
			...base,
			resource,
			sections,
			parentSchema: parentSchema ?? undefined
		};
	}

	const resolved = schemaNodeForValue(sections.spec, specPath, cursor.inArrayItem);
	if (!resolved) {
		return { ...base, resource, sections };
	}

	const meta = schemaLeafMeta(resolved.leafSchema, resolved.fieldName, resolved.parentSchema);
	return {
		...base,
		resource,
		sections,
		parentSchema: resolved.parentSchema,
		leafSchema: resolved.leafSchema,
		fieldName: resolved.fieldName,
		meta
	};
}

/** Breadcrumb segments for toolbar display (e.g. doc 1 › spec › leafs). */
export function yamlPathBreadcrumb(cursor: YamlCursor): string {
	const segments = [`doc ${cursor.docIndex}`, ...cursor.yamlPath];
	return segments.join(' › ');
}
