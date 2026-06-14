import type { AiSchemaPayload } from './loadAiSchema';
import type { RagSource } from './rag/chunkTypes';
import { formatCrdAnswer } from './formatAnswer';
import { resolveObjectSchema } from '$lib/schema/requiredFields';
import { WORKERS_AI_NEURON_LIMIT_MESSAGE, isWorkersAINeuronLimitError } from './workersAIQuota';

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

export function buildRagOnlyAnswer(params: {
	question: string;
	context: string;
	release: string;
	sources?: RagSource[];
	reason?: 'quota' | 'llm_error';
}): string {
	const { question, context, release, sources, reason } = params;
	const reasonLine =
		reason === 'quota'
			? WORKERS_AI_NEURON_LIMIT_MESSAGE
			: 'Workers AI could not generate a narrative answer right now.';
	const sourceLines =
		sources && sources.length
			? `\n**Sources (${sources.length}):** ${sources
					.slice(0, 6)
					.map((s) => s.label)
					.join('; ')}`
			: '';

	return [
		`## Retrieved context for EDA ${release}`,
		'',
		`_${reasonLine} Excerpts below are from indexed schema/documentation — not paraphrased by a model._`,
		'',
		`**Question:** ${question}`,
		'',
		context.trim(),
		sourceLines
	]
		.filter(Boolean)
		.join('\n');
}

export function llmFallbackReason(err: unknown): 'quota' | 'llm_error' {
	return isWorkersAINeuronLimitError(err) ? 'quota' : 'llm_error';
}

export function buildContextFirstFallbackAnswer(params: {
	question: string;
	release: string;
	kind: string;
	group: string;
	version?: string;
	schema?: AiSchemaPayload;
	kvAnswer?: string;
	ragContext?: string;
	sources?: RagSource[];
	reason?: 'quota' | 'llm_error';
}): string {
	const { question, release, kind, group, schema, kvAnswer, ragContext, sources, reason } = params;
	const api = schema?.apiVersion ?? (group ? `${group}` : group);
	const reasonLine =
		reason === 'quota'
			? WORKERS_AI_NEURON_LIMIT_MESSAGE
			: 'Workers AI could not generate a narrative answer right now.';

	const intro = [
		`## ${kind} (\`${api}\`) — EDA ${release}`,
		'',
		`_${reasonLine} Answer below is grounded on this exact kind and API group (not other similarly named resources)._`,
		'',
		`**Question:** ${question}`,
		''
	].join('\n');

	const primary = kvAnswer?.trim()
		? kvAnswer.trim()
		: schema
			? formatCrdAnswer(schema, { notice: FALLBACK_NOTICE })
			: '';

	const rag =
		ragContext?.trim() &&
		['## Related indexed excerpts', '', ragContext.trim()].join('\n');

	const sourceLines =
		sources && sources.length
			? `\n**Sources:** ${sources
					.slice(0, 6)
					.map((s) => s.label)
					.join('; ')}`
			: '';

	return [intro, primary, rag || '', sourceLines].filter(Boolean).join('\n\n');
}
