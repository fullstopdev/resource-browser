import type { AiSchemaPayload } from './loadAiSchema';
import type { RagSource } from './rag/chunkTypes';
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

function topLevelSpecSummary(schema: AiSchemaPayload, maxFields = 5): string[] {
	const resolved = resolveObjectSchema(schema.specSchema);
	if (!resolved) return [];
	const bullets: string[] = [];
	for (const key of Object.keys(resolved.properties).slice(0, maxFields)) {
		const prop = resolved.properties[key] as Record<string, unknown> | undefined;
		const desc =
			typeof prop?.description === 'string' && prop.description.length < 160
				? `: ${prop.description}`
				: '';
		bullets.push(`- \`${key}\`${desc}`);
	}
	return bullets;
}

export function buildSchemaExplainFallback(schema: AiSchemaPayload): string {
	const header = `**${schema.kind}** (\`${schema.apiVersion}\`) — EDA release **${schema.release}**`;
	const notice =
		'_Generated from the CRD schema (Workers AI unavailable). Verify details in the Resource Browser spec view._';
	const required =
		schema.specRequired.length > 0
			? `**Required spec fields:** ${schema.specRequired.join(', ')}`
			: '**Required spec fields:** none listed at the top level of spec.';
	const statusLine =
		schema.statusSchema && resolveObjectSchema(schema.statusSchema)
			? 'This CRD exposes a **status** sub-resource (state/reporting).'
			: 'This CRD appears to be primarily a **configuration** resource (spec-driven).';
	const bullets = topLevelSpecSummary(schema);
	const keyFields =
		bullets.length > 0
			? `**Key spec fields (sample):**\n${bullets.join('\n')}`
			: '**Key spec fields:** see the full schema in the browser.';

	return [header, '', notice, '', required, '', statusLine, '', keyFields].join('\n');
}

export function buildSchemaFieldFallback(schema: AiSchemaPayload, fieldPath: string): string | null {
	const node = navigateSchemaProperty(
		{ spec: schema.specSchema, status: schema.statusSchema },
		fieldPath.startsWith('spec.') || fieldPath.startsWith('status.')
			? fieldPath
			: `spec.${fieldPath}`
	);
	if (!node) {
		return `Field \`${fieldPath}\` is not defined in **${schema.kind}** for release **${schema.release}**.`;
	}

	const resolved = resolveObjectSchema(node);
	const o = node as Record<string, unknown>;
	const lines = [
		`**Field \`${fieldPath}\` in ${schema.kind}** (release ${schema.release})`,
		'',
		'_Schema-derived summary (Workers AI unavailable)._',
		'',
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
		lines.push(`- **Description:** ${o.description}`);
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

	const body = context.trim();
	return [
		`**Retrieved context for EDA ${release}**`,
		'',
		`_${reasonLine} The excerpts below are copied from indexed schema/documentation — they are not paraphrased by a model._`,
		'',
		`**Question:** ${question}`,
		'',
		body,
		sourceLines
	].join('\n');
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
	schemaSummary?: string;
	richContext?: string;
	ragContext?: string;
	sources?: RagSource[];
	reason?: 'quota' | 'llm_error';
}): string {
	const { question, release, kind, group, version, schemaSummary, richContext, ragContext, sources, reason } =
		params;
	const api = version ? `${group}/${version}` : group;
	const gvk = `**${kind}** (\`${api}\`) — EDA **${release}**`;
	const reasonLine =
		reason === 'quota'
			? WORKERS_AI_NEURON_LIMIT_MESSAGE
			: 'Workers AI could not generate a narrative answer right now.';
	const intro = [
		gvk,
		'',
		`_${reasonLine} Summary below is from the CRD schema for this exact kind and API group (not other *Policy* resources)._`,
		'',
		`**Question:** ${question}`,
		''
	].join('\n');

	const primary = schemaSummary?.trim() || richContext?.trim() || '';
	const rag =
		ragContext?.trim() &&
		`**Indexed excerpts (${kind} / ${group} only):**\n\n${ragContext.trim()}`;
	const sourceLines =
		sources && sources.length
			? `\n**Sources:** ${sources
					.slice(0, 6)
					.map((s) => s.label)
					.join('; ')}`
			: '';

	return [intro, primary, rag || '', sourceLines].filter(Boolean).join('\n\n');
}

