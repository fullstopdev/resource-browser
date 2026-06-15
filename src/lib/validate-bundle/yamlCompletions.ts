import type { ManifestEntry } from '$lib/yaml-validation/types';
import {
	collectSchemaProperties,
	getChildPropertySchema,
	getItemsSchema,
	getRequiredKeys,
	resolveSchemaAtPath,
	schemaLeafMeta,
	truncateDetail,
	type SchemaLeafMeta
} from './schemaNavigation';
import type { BundleResource } from './types';
import {
	resolveYamlFieldContext,
	schemaHasPropertyKeys,
	schemaNodeForKeyParent,
	schemaNodeForValue
} from './yamlFieldContext';
import {
	fetchYamlCompletionSchemas,
	schemaKeyForResource,
	schemaKeysForResources,
	type YamlCompletionContext
} from './yamlSchemaKeys';
import { specPathFromYamlPath } from './yamlCursor';

export type { YamlCompletionContext };
export { schemaKeyForResource, schemaKeysForResources };

export type YamlCompletionItem = {
	label: string;
	insertText: string;
	kind: 'property' | 'value' | 'enum' | 'reference';
	detail?: string;
	documentation?: string;
	sortText?: string;
	preselect?: boolean;
};

/**
 * VS Code-style YAML key insert: add ": " only when the line does not already have
 * a colon after the replaced range (avoids `systemPoolIPv6:: value`).
 */
export function yamlPropertyInsertText(
	lineContent: string,
	rangeStartColumn: number,
	rangeEndColumn: number,
	key: string
): string {
	const tail = lineContent.slice(rangeEndColumn - 1);
	if (tail.startsWith(':')) {
		return key;
	}
	const replaced = lineContent.slice(rangeStartColumn - 1, rangeEndColumn - 1);
	if (replaced.includes(':')) {
		return key;
	}
	return `${key}: `;
}

/** Quote YAML string values when they contain spaces or special characters. */
export function yamlValueInsertText(value: string, meta?: SchemaLeafMeta): string {
	if (meta?.type === 'string' || meta?.enumValues?.length) {
		if (/[\s:#{}[\],&*?|>!%@`'"]/.test(value) || value === '') {
			return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
		}
	}
	return value;
}

export function completionDocumentation(meta: SchemaLeafMeta, fieldName?: string): string | undefined {
	const lines: string[] = [];
	if (meta.required) lines.push('*Required*');
	if (meta.type) lines.push(`Type: \`${meta.type}\``);
	if (meta.description) lines.push(meta.description);
	if (meta.enumValues?.length) {
		lines.push(`Allowed: ${meta.enumValues.map((v) => `\`${v}\``).join(', ')}`);
	}
	if (meta.defaultValue !== undefined && typeof meta.defaultValue !== 'object') {
		lines.push(`Default: \`${String(meta.defaultValue)}\``);
	}
	if (meta.referencedKinds.length > 0) {
		lines.push(`References: ${meta.referencedKinds.join(', ')}`);
	}
	const doc = lines.join('\n\n');
	return doc || (fieldName ? `Field \`${fieldName}\`.` : undefined);
}

function resourceForDoc(ctx: YamlCompletionContext, docIndex: number): BundleResource | undefined {
	return ctx.resources.find((r) => r.docIndex + 1 === docIndex);
}

function bundleNamesForKinds(
	ctx: YamlCompletionContext,
	kinds: string[],
	excludeDocIndex: number
): string[] {
	const kindSet = new Set(kinds.map((k) => k.toLowerCase()));
	return ctx.resources
		.filter(
			(r) =>
				r.docIndex + 1 !== excludeDocIndex &&
				r.kind &&
				kindSet.has(r.kind.toLowerCase()) &&
				r.name
		)
		.map((r) => r.name);
}

function keyCompletions(parentSchema: unknown, valuePrefix: string): YamlCompletionItem[] {
	const props = collectSchemaProperties(parentSchema);
	if (!props) return [];

	const required = new Set(getRequiredKeys(parentSchema));
	const prefix = valuePrefix.toLowerCase();
	const items: YamlCompletionItem[] = [];

	for (const key of props) {
		if (prefix && !key.toLowerCase().startsWith(prefix)) continue;
		const childSchema = getChildPropertySchema(parentSchema, key);
		const meta = schemaLeafMeta(childSchema, key, parentSchema);
		const isRequired = required.has(key);
		items.push({
			label: key,
			insertText: key,
			kind: 'property',
			detail: isRequired ? 'required' : truncateDetail(meta.description),
			documentation: completionDocumentation(meta, key),
			sortText: `${isRequired ? '0' : '1'}_${key}`
		});
	}

	const sorted = items.sort((a, b) => (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label));
	if (prefix && sorted.length > 0) {
		sorted[0]!.preselect = true;
	}
	return sorted;
}

function valueCompletions(
	leafSchema: unknown,
	fieldName: string,
	parentSchema: unknown,
	ctx: YamlCompletionContext,
	docIndex: number,
	valuePrefix: string
): YamlCompletionItem[] {
	const meta = schemaLeafMeta(leafSchema, fieldName, parentSchema);
	const prefix = valuePrefix.toLowerCase();
	const items: YamlCompletionItem[] = [];
	const doc = completionDocumentation(meta, fieldName);

	const pushValue = (label: string, kind: YamlCompletionItem['kind'], detail?: string) => {
		if (prefix && !label.toLowerCase().startsWith(prefix)) return;
		items.push({
			label,
			insertText: label,
			kind,
			detail,
			documentation: doc,
			sortText: `0_${label}`
		});
	};

	if (meta.enumValues?.length) {
		for (const value of meta.enumValues) pushValue(value, 'enum', 'enum');
	}

	if (meta.type === 'boolean') {
		pushValue('true', 'value');
		pushValue('false', 'value');
	}

	if (meta.defaultValue !== undefined && typeof meta.defaultValue !== 'object') {
		pushValue(String(meta.defaultValue), 'value', 'default');
	}

	if (meta.referencedKinds.length > 0) {
		for (const name of bundleNamesForKinds(ctx, meta.referencedKinds, docIndex)) {
			pushValue(name, 'reference', meta.referencedKinds.join(', '));
		}
	}

	const sorted = items.sort((a, b) => (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label));
	if (prefix && sorted.length > 0) {
		sorted[0]!.preselect = true;
	}
	return sorted;
}

function arrayItemCompletions(
	arraySchema: unknown,
	ctx: YamlCompletionContext,
	docIndex: number,
	valuePrefix: string
): YamlCompletionItem[] {
	const itemsSchema = getItemsSchema(arraySchema);
	if (!itemsSchema || typeof itemsSchema !== 'object') return [];

	const itemRecord = itemsSchema as Record<string, unknown>;
	if (itemRecord.type === 'string') {
		return valueCompletions(itemsSchema, '', arraySchema, ctx, docIndex, valuePrefix);
	}

	const resolved = collectSchemaProperties(itemsSchema);
	if (!resolved) return [];
	return keyCompletions(itemsSchema, valuePrefix);
}

const MANIFEST_ROOT_KEYS = ['apiVersion', 'kind', 'metadata', 'spec', 'status'] as const;
const METADATA_KEYS = [
	'name',
	'namespace',
	'labels',
	'annotations',
	'finalizers',
	'ownerReferences'
] as const;

function manifestRootKeyCompletions(valuePrefix: string): YamlCompletionItem[] {
	const prefix = valuePrefix.toLowerCase();
	return MANIFEST_ROOT_KEYS.filter((k) => !prefix || k.toLowerCase().startsWith(prefix)).map(
		(k) => ({
			label: k,
			insertText: k,
			kind: 'property' as const,
			sortText: `0_${k}`
		})
	);
}

function metadataKeyCompletions(valuePrefix: string): YamlCompletionItem[] {
	const prefix = valuePrefix.toLowerCase();
	return METADATA_KEYS.filter((k) => !prefix || k.toLowerCase().startsWith(prefix)).map((k) => ({
		label: k,
		insertText: k,
		kind: 'property' as const,
		sortText: `0_${k}`
	}));
}

export function buildYamlCompletions(
	yaml: string,
	line: number,
	column: number,
	ctx: YamlCompletionContext | null
): YamlCompletionItem[] {
	const fieldCtx = resolveYamlFieldContext(yaml, line, column, ctx);
	if (!fieldCtx) return [];

	const { cursor, inSpec, inMetadata } = fieldCtx;

	if (!inSpec && cursor.completionKind === 'key') {
		if (inMetadata) {
			return metadataKeyCompletions(cursor.valuePrefix);
		}
		return manifestRootKeyCompletions(cursor.valuePrefix);
	}

	if (!inSpec) return [];

	if (!ctx || ctx.resources.length === 0) return [];

	const resource = resourceForDoc(ctx, cursor.docIndex);
	if (!resource) return [];

	const schemaKey = resource.kind ? schemaKeyForResource(ctx, resource) : null;
	const sections = schemaKey ? ctx.schemas.get(schemaKey) : null;
	if (!sections?.spec) return [];

	const specPath = specPathFromYamlPath(cursor.yamlPath);

	if (cursor.completionKind === 'key') {
		const parentSchema = schemaNodeForKeyParent(
			sections.spec,
			specPath,
			cursor.inArrayItem
		);
		if (!parentSchema) return [];
		return keyCompletions(parentSchema, cursor.valuePrefix);
	}

	if (cursor.completionKind === 'value') {
		const resolved = schemaNodeForValue(sections.spec, specPath, cursor.inArrayItem);
		if (!resolved) return [];
		if (schemaHasPropertyKeys(resolved.leafSchema)) {
			return keyCompletions(resolved.leafSchema, cursor.valuePrefix);
		}
		return valueCompletions(
			resolved.leafSchema,
			resolved.fieldName,
			resolved.parentSchema,
			ctx,
			cursor.docIndex,
			cursor.valuePrefix
		);
	}

	if (cursor.completionKind === 'array-item') {
		const resolved = resolveSchemaAtPath(sections.spec, specPath);
		if (!resolved) return [];
		return arrayItemCompletions(resolved.schema, ctx, cursor.docIndex, cursor.valuePrefix);
	}

	return [];
}

export async function buildYamlCompletionContext(
	resources: BundleResource[],
	releaseFolder: string,
	manifest: ManifestEntry[],
	fetcher: typeof fetch = fetch
): Promise<YamlCompletionContext> {
	const schemas = await fetchYamlCompletionSchemas(resources, releaseFolder, manifest, fetcher);

	return {
		resources,
		schemas,
		releaseFolder,
		manifest
	};
}
