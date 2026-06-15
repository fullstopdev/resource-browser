import type { AiSchemaPayload } from './loadAiSchema';
import { formatCrdAnswer } from './formatAnswer';
import { resolveObjectSchema } from '$lib/schema/requiredFields';
import { isWorkersAINeuronLimitError } from './workersAIQuota';

function schemaTypeLabel(node: unknown): string {
	const resolved = resolveObjectSchema(node);
	if (resolved) return 'object';
	if (Array.isArray(node)) return 'array';
	if (node && typeof node === 'object') {
		const o = node as Record<string, unknown>;
		if (typeof o.type === 'string') return o.type;
		if (o.enum) return `enum (${(o.enum as string[]).join(' | ')})`;
	}
	return typeof node === 'string' ? node : 'unknown';
}

function navigateSchemaProperty(schema: unknown, fieldPath: string): unknown {
	const normalized = fieldPath.replace(/^\//, '').replace(/^spec\./, 'spec.');
	const parts = normalized.split('.').filter(Boolean);
	let current: unknown = schema;
	for (const part of parts) {
		if (part === 'spec' || part === 'status') {
			const resolved = resolveObjectSchema(current);
			current = resolved?.properties?.[part] ?? current;
			continue;
		}
		const resolved = resolveObjectSchema(current);
		if (!resolved?.properties?.[part]) return null;
		current = resolved.properties[part];
	}
	return current;
}

const FALLBACK_NOTICE =
	'Generated from the CRD schema (Workers AI unavailable). Verify details in the Resource Browser spec view.';

export function buildSchemaExplainFallback(schema: AiSchemaPayload): string {
	return formatCrdAnswer(schema, { notice: FALLBACK_NOTICE });
}

export function buildSchemaFieldFallback(schema: AiSchemaPayload, fieldPath: string): string | null {
	const node = navigateSchemaProperty(
		{ spec: schema.specSchema, status: schema.statusSchema },
		fieldPath.startsWith('spec.') || fieldPath.startsWith('status.')
			? fieldPath
			: `spec.${fieldPath}`
	);
	if (!node) {
		return `## Field not found\n\nField \`${fieldPath}\` is not defined in **${schema.kind}** (\`${schema.apiVersion}\`) for release **${schema.release}**.`;
	}

	const resolved = resolveObjectSchema(node);
	const o = node as Record<string, unknown>;
	const lines = [
		`## Field \`${fieldPath}\``,
		'',
		`_${FALLBACK_NOTICE}_`,
		'',
		`- **CRD:** ${schema.kind} (\`${schema.apiVersion}\`)`,
		`- **Type:** ${schemaTypeLabel(node)}`,
		`- **Required:** ${
			fieldPath.includes('.')
				? 'see parent object required list in schema'
				: schema.specRequired.includes(fieldPath.replace(/^spec\./, ''))
					? 'yes (top-level spec)'
					: 'optional at top-level spec'
		}`
	];

	if (Array.isArray(o.enum) && o.enum.length) {
		lines.push(`- **Allowed values:** ${(o.enum as string[]).join(', ')}`);
	}
	if (o.default !== undefined) {
		lines.push(`- **Default:** ${JSON.stringify(o.default)}`);
	}
	if (typeof o.description === 'string') {
		lines.push('', '### Description', '', o.description);
	} else if (resolved) {
		const req = resolved.required.length ? resolved.required.join(', ') : 'none';
		lines.push(`- **Nested required:** ${req}`);
	}

	return lines.join('\n');
}

export function llmFallbackReason(err: unknown): 'quota' | 'llm_error' {
	return isWorkersAINeuronLimitError(err) ? 'quota' : 'llm_error';
}
