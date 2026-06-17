import type { SchemaLeafMeta } from './schemaNavigation';
import {
	collectSchemaProperties,
	fabricProtocolParentHint,
	findSimilarSchemaProperty,
	getChildPropertySchema,
	schemaLeafMeta
} from './schemaNavigation';
import type { YamlFieldContext } from './yamlFieldContext';
import { completionDocumentation } from './yamlCompletions';

function fabricProtocolParentFromPath(specPath: string[], yamlKey?: string): string | undefined {
	const path = yamlKey ? [...specPath, yamlKey] : specPath;
	for (let i = path.length - 1; i >= 0; i--) {
		const segment = path[i];
		if (segment === 'underlayProtocol' || segment === 'overlayProtocol') {
			return segment;
		}
	}
	return undefined;
}

function misspelledKeyHoverMessage(
	yamlKey: string,
	parentSchema: unknown,
	specPath: string[]
): string | null {
	const props = collectSchemaProperties(parentSchema);
	if (!props || props.has(yamlKey)) return null;

	const fabricParent = fabricProtocolParentFromPath(specPath, yamlKey);
	const similar = findSimilarSchemaProperty(
		yamlKey,
		props,
		fabricParent ?? specPath[specPath.length - 1]
	);
	if (!similar) return null;

	const hint = fabricProtocolParentHint(fabricParent);
	const lines = [`⚠️ **Misspelled field** — use \`${similar}\` instead of \`${yamlKey}\`.`];
	if (hint) lines.push('', hint);
	return lines.join('\n');
}

const MANIFEST_HINTS: Record<string, string> = {
	apiVersion: 'Kubernetes API version in `group/version` form.',
	kind: 'Resource kind matching the CRD.',
	metadata: 'Standard Kubernetes object metadata.',
	spec: 'CRD-specific desired state.',
	status: 'Observed state (usually read-only).',
	name: 'Unique name within the namespace.',
	namespace: 'Kubernetes namespace for this resource.',
	labels: 'Key/value labels for selection and grouping.',
	annotations: 'Non-identifying metadata key/value pairs.',
	finalizers: 'Controllers that must clear before deletion.',
	ownerReferences: 'References to objects owning this resource.'
};

function formatMetaSection(meta: SchemaLeafMeta, fieldName?: string): string[] {
	const lines: string[] = [];
	if (fieldName) {
		lines.push(`**${fieldName}**`);
	}
	if (meta.required) {
		lines.push('*Required*');
	}
	if (meta.type) {
		lines.push(`Type: \`${meta.type}\``);
	}
	if (meta.description) {
		lines.push('', meta.description);
	}
	if (meta.enumValues?.length) {
		lines.push('', '**Allowed values:**', meta.enumValues.map((v) => `- \`${v}\``).join('\n'));
	}
	if (meta.defaultValue !== undefined && typeof meta.defaultValue !== 'object') {
		lines.push('', `Default: \`${String(meta.defaultValue)}\``);
	}
	if (meta.referencedKinds.length > 0) {
		lines.push('', `References: ${meta.referencedKinds.join(', ')}`);
	}
	return lines;
}

/** Full YAML key on a line (ignores cursor prefix; uses text before `:`). */
export function extractYamlLineKey(lineContent: string, column?: number): string | undefined {
	const indent = (lineContent.match(/^(\s*)/)?.[1] ?? '').length;
	const trimmed = lineContent.slice(indent);
	const isArrayItem = /^-\s+/.test(trimmed);
	const dashLen = isArrayItem ? 2 : 0;
	const content = isArrayItem ? trimmed.replace(/^-\s+/, '') : trimmed;
	const colonIdx = content.indexOf(':');

	if (colonIdx >= 0) {
		const key = content.slice(0, colonIdx).trim();
		if (!key) return undefined;
		if (column !== undefined) {
			const keyStart = indent + dashLen + 1;
			const keyEnd = keyStart + key.length;
			if (column < keyStart || column > keyEnd) {
				return undefined;
			}
		}
		return key;
	}

	const key = content.trim();
	return key || undefined;
}

function extractValueAtPosition(lineContent: string): string | undefined {
	const colonIdx = lineContent.indexOf(':');
	if (colonIdx < 0) return undefined;
	const value = lineContent.slice(colonIdx + 1).trim();
	return value || undefined;
}

/** Build Monaco hover Markdown from field context. */
export function buildYamlHoverMarkdown(
	fieldCtx: YamlFieldContext,
	lineContent: string,
	column?: number
): string | null {
	const { cursor, meta, fieldName, inSpec, inMetadata } = fieldCtx;
	const lineKey = extractYamlLineKey(lineContent, column);
	const resolvedFieldName = lineKey ?? fieldName;

	if (!inSpec && cursor.completionKind === 'key') {
		const key = lineKey ?? resolvedFieldName;
		if (!key) return null;
		const hint = inMetadata
			? MANIFEST_HINTS[key]
			: MANIFEST_HINTS[key] ?? `Manifest field \`${key}\`.`;
		return `**${key}**\n\n${hint}`;
	}

	if (!inSpec) return null;

	if (lineKey && fieldCtx.parentSchema) {
		const misspelled = misspelledKeyHoverMessage(
			lineKey,
			fieldCtx.parentSchema,
			fieldCtx.specPath
		);
		if (misspelled) {
			return `**${lineKey}**\n\n${misspelled}`;
		}

		const childSchema = getChildPropertySchema(fieldCtx.parentSchema, lineKey);
		const keyMeta = schemaLeafMeta(childSchema, lineKey, fieldCtx.parentSchema);
		return completionDocumentation(keyMeta, lineKey)
			? `**${lineKey}**\n\n${completionDocumentation(keyMeta, lineKey)}`
			: `**${lineKey}**`;
	}

	if (meta) {
		const yamlKey = fieldCtx.specPath[fieldCtx.specPath.length - 1];
		const parentPath = fieldCtx.specPath.slice(0, -1);
		if (yamlKey && fieldCtx.parentSchema) {
			const misspelled = misspelledKeyHoverMessage(
				yamlKey,
				fieldCtx.parentSchema,
				parentPath
			);
			if (misspelled) {
				const value = extractValueAtPosition(lineContent);
				const lines = value ? [`Current value: \`${value}\``, '', misspelled] : [misspelled];
				return lines.join('\n');
			}
		}

		const value = extractValueAtPosition(lineContent);
		const lines = formatMetaSection(meta, resolvedFieldName);
		if (value) {
			lines.unshift(`Current value: \`${value}\``, '');
		}
		return lines.join('\n') || null;
	}

	return null;
}
