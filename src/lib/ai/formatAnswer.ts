import type { AiSchemaPayload } from './loadAiSchema';
import { resolveObjectSchema } from '$lib/schema/requiredFields';

export type FormatAnswerOptions = {
	/** Include a minimal valid YAML example. Default true. */
	includeExample?: boolean;
	/** Max top-level spec fields to list. Default 8. */
	maxFields?: number;
	/** Optional notice line (e.g. fallback disclaimer). */
	notice?: string;
};

function schemaTypeLabel(node: unknown): string {
	const resolved = resolveObjectSchema(node);
	if (resolved) return 'object';
	if (Array.isArray(node)) return 'array';
	if (node && typeof node === 'object') {
		const o = node as Record<string, unknown>;
		if (typeof o.type === 'string') return o.type;
		if (Array.isArray(o.enum) && o.enum.length) {
			return `enum (${(o.enum as string[]).slice(0, 6).join(' | ')})`;
		}
	}
	return typeof node === 'string' ? node : 'unknown';
}

function shortDescription(node: unknown): string | undefined {
	if (!node || typeof node !== 'object') return undefined;
	const o = node as Record<string, unknown>;
	if (typeof o.description !== 'string') return undefined;
	const d = o.description.trim();
	if (!d) return undefined;
	return d.length > 140 ? `${d.slice(0, 137)}…` : d;
}

function inferResourceType(schema: AiSchemaPayload): string {
	const hasStatus = !!(schema.statusSchema && resolveObjectSchema(schema.statusSchema));
	if (hasStatus) {
		return 'Configuration resource with a **status** sub-resource (spec + observed state).';
	}
	return 'Configuration resource (spec-driven; no status sub-resource in schema).';
}

function crdTitle(schema: AiSchemaPayload): string {
	const deprecated = schema.deprecated ? ' _(deprecated API version)_' : '';
	return `**${schema.kind}** (\`${schema.apiVersion}\`) — EDA release **${schema.release}**${deprecated}`;
}

function overviewParagraph(schema: AiSchemaPayload): string {
	const specDesc = shortDescription(schema.specSchema);
	if (specDesc) return specDesc;
	return `The **${schema.kind}** custom resource in API group \`${schema.group}\` is part of Nokia Event-Driven Automation (EDA) release **${schema.release}**.`;
}

function formatRequiredSection(schema: AiSchemaPayload): string {
	if (schema.specRequired.length > 0) {
		return schema.specRequired.map((f) => `\`${f}\``).join(', ');
	}
	return '_None listed at the top level of `spec`._';
}

function formatKeyFields(schema: AiSchemaPayload, maxFields: number): string[] {
	const resolved = resolveObjectSchema(schema.specSchema);
	if (!resolved) return [];

	const bullets: string[] = [];
	for (const key of Object.keys(resolved.properties).slice(0, maxFields)) {
		const prop = resolved.properties[key];
		const type = schemaTypeLabel(prop);
		const desc = shortDescription(prop);
		const req = schema.specRequired.includes(key) ? ' **required**' : '';
		bullets.push(
			desc
				? `- \`${key}\` (${type})${req} — ${desc}`
				: `- \`${key}\` (${type})${req}`
		);
	}
	return bullets;
}

function placeholderForType(node: unknown): unknown {
	const resolved = resolveObjectSchema(node);
	if (resolved) {
		const obj: Record<string, unknown> = {};
		for (const key of resolved.required.slice(0, 4)) {
			const prop = resolved.properties[key];
			obj[key] = placeholderForType(prop);
		}
		if (Object.keys(obj).length === 0) {
			const firstKey = Object.keys(resolved.properties)[0];
			if (firstKey) obj[firstKey] = placeholderForType(resolved.properties[firstKey]);
		}
		return Object.keys(obj).length ? obj : {};
	}
	if (!node || typeof node !== 'object') return '…';
	const o = node as Record<string, unknown>;
	if (Array.isArray(o.enum) && o.enum.length) return o.enum[0];
	switch (o.type) {
		case 'boolean':
			return true;
		case 'integer':
		case 'number':
			return 1;
		case 'array':
			return [];
		default:
			return 'example';
	}
}

/** Build a minimal valid-looking YAML manifest from required spec fields. */
export function buildExampleYamlSnippet(schema: AiSchemaPayload): string {
	const specResolved = resolveObjectSchema(schema.specSchema);
	const spec: Record<string, unknown> = {};
	if (specResolved) {
		for (const key of specResolved.required) {
			spec[key] = placeholderForType(specResolved.properties[key]);
		}
		if (Object.keys(spec).length === 0) {
			const first = Object.keys(specResolved.properties)[0];
			if (first) spec[first] = placeholderForType(specResolved.properties[first]);
		}
	}

	const lines = [
		`apiVersion: ${schema.apiVersion}`,
		`kind: ${schema.kind}`,
		'metadata:',
		`  name: example-${schema.kind.toLowerCase()}`,
		'spec:'
	];

	if (Object.keys(spec).length === 0) {
		lines.push('  {}');
	} else {
		for (const [key, value] of Object.entries(spec)) {
			const yamlVal = JSON.stringify(value);
			if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
				lines.push(`  ${key}:`);
				for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
					lines.push(`    ${k}: ${JSON.stringify(v)}`);
				}
			} else {
				lines.push(`  ${key}: ${yamlVal}`);
			}
		}
	}

	return lines.join('\n');
}

/** Pro markdown answer rendered from CRD schema (Claude-style sections). */
export function formatCrdAnswer(schema: AiSchemaPayload, options: FormatAnswerOptions = {}): string {
	const { includeExample = true, maxFields = 8, notice } = options;
	const sections: string[] = [];

	if (notice) {
		sections.push(`_${notice}_`, '');
	}

	sections.push('## Overview', '', crdTitle(schema), '', overviewParagraph(schema), '');

	sections.push('## Resource type', '', inferResourceType(schema), '');

	sections.push('## Required fields', '', formatRequiredSection(schema), '');

	const keyBullets = formatKeyFields(schema, maxFields);
	if (keyBullets.length) {
		sections.push('## Key fields', '', ...keyBullets, '');
	}

	if (includeExample) {
		sections.push(
			'## Example manifest',
			'',
			'```yaml',
			buildExampleYamlSnippet(schema),
			'```',
			''
		);
	}

	return sections.join('\n').trim();
}

/** Condensed schema context for LLM prompts (structured, not raw JSON dump). */
export function formatSchemaContextForLlm(schema: AiSchemaPayload): string {
	const keyBullets = formatKeyFields(schema, 12);
	const parts = [
		`## Target CRD (schema-grounded)`,
		crdTitle(schema),
		`Group: \`${schema.group}\``,
		`Resource name: \`${schema.resourceName}\``,
		`Required spec fields: ${formatRequiredSection(schema)}`,
		inferResourceType(schema)
	];
	if (keyBullets.length) {
		parts.push('', 'Key spec fields:', ...keyBullets);
	}
	parts.push('', 'Example skeleton:', '```yaml', buildExampleYamlSnippet(schema), '```');
	return parts.join('\n');
}

/** Wrap KV-cached explain text as prioritized LLM context. */
export function formatKvContextSection(cachedAnswer: string): string {
	return `## Cached CRD summary (KV — authoritative for this kind/release)\n${cachedAnswer.trim()}`;
}
