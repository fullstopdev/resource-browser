import type { AiSchemaPayload } from './loadAiSchema';
import { pickRandomExample } from './kvCache';
import type { AiCachePayload } from './kvCache';
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

function shortDescription(node: unknown, maxLen = 140): string | undefined {
	if (!node || typeof node !== 'object') return undefined;
	const o = node as Record<string, unknown>;
	if (typeof o.description !== 'string') return undefined;
	const d = o.description.trim();
	if (!d) return undefined;
	return d.length > maxLen ? `${d.slice(0, maxLen - 1)}…` : d;
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

function formatKeyFields(schema: AiSchemaPayload, maxFields: number, descMaxLen = 140): string[] {
	const resolved = resolveObjectSchema(schema.specSchema);
	if (!resolved) return [];

	const keys = Object.keys(resolved.properties);
	const limit = maxFields <= 0 ? keys.length : Math.min(keys.length, maxFields);

	const bullets: string[] = [];
	for (const key of keys.slice(0, limit)) {
		const prop = resolved.properties[key];
		if (
			prop &&
			typeof prop === 'object' &&
			(prop as Record<string, unknown>).deprecated === true
		) {
			continue;
		}
		const type = schemaTypeLabel(prop);
		const desc = shortDescription(prop, descMaxLen);
		const req = schema.specRequired.includes(key) ? ' **required**' : '';
		const nested = formatNestedFieldHints(prop);
		const detail = [desc, nested].filter(Boolean).join(' ');
		bullets.push(
			detail
				? `- \`${key}\` (${type})${req} — ${detail}`
				: `- \`${key}\` (${type})${req}`
		);
	}
	return bullets;
}

/** Nested required children and enum values for network-engineer context. */
function formatNestedFieldHints(node: unknown): string | undefined {
	const resolved = resolveObjectSchema(node);
	const hints: string[] = [];

	if (resolved?.required?.length) {
		hints.push(`required children: ${resolved.required.map((f) => `\`${f}\``).join(', ')}`);
	}

	if (node && typeof node === 'object') {
		const o = node as Record<string, unknown>;
		if (Array.isArray(o.enum) && o.enum.length) {
			const vals = (o.enum as string[]).slice(0, 12);
			const more = (o.enum as string[]).length > 12 ? '…' : '';
			hints.push(`enum: ${vals.join(' | ')}${more}`);
		}
		if (o.default !== undefined) {
			hints.push(`default: ${JSON.stringify(o.default)}`);
		}
	}

	return hints.length ? hints.join('; ') : undefined;
}

function formatRequiredFieldDetails(schema: AiSchemaPayload): string[] {
	const resolved = resolveObjectSchema(schema.specSchema);
	if (!schema.specRequired.length) {
		return ['_No top-level required fields are listed in the OpenAPI schema for `spec`._'];
	}

	return schema.specRequired.map((field) => {
		const prop = resolved?.properties?.[field];
		const type = schemaTypeLabel(prop);
		const desc = shortDescription(prop, 320);
		return desc
			? `- \`${field}\` (${type}) — ${desc}`
			: `- \`${field}\` (${type})`;
	});
}

function formatStatusFieldSummary(schema: AiSchemaPayload, maxFields = 20): string[] {
	const resolved = resolveObjectSchema(schema.statusSchema);
	if (!resolved) return [];

	const lines: string[] = [];
	if (schema.statusRequired.length) {
		lines.push(`Status required fields: ${schema.statusRequired.map((f) => `\`${f}\``).join(', ')}`);
	}

	const bullets: string[] = [];
	for (const key of Object.keys(resolved.properties).slice(0, maxFields)) {
		const prop = resolved.properties[key];
		const type = schemaTypeLabel(prop);
		const desc = shortDescription(prop, 200);
		const req = schema.statusRequired.includes(key) ? ' **required**' : '';
		bullets.push(
			desc
				? `- \`${key}\` (${type})${req} — ${desc}`
				: `- \`${key}\` (${type})${req}`
		);
	}
	if (bullets.length) {
		lines.push('Status fields:', ...bullets);
	}
	return lines;
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
	return formatSchemaSummaryForKv(schema, { maxSpecFields: 0 });
}

/** Comprehensive deterministic schema summary for KV cache (all required + spec fields). */
export function formatSchemaSummaryForKv(
	schema: AiSchemaPayload,
	options: { maxSpecFields?: number } = {}
): string {
	const maxSpecFields = options.maxSpecFields ?? 0;
	const resolved = resolveObjectSchema(schema.specSchema);
	const specFieldCount = resolved ? Object.keys(resolved.properties).length : 0;
	const fieldLimit = maxSpecFields <= 0 ? specFieldCount : maxSpecFields;

	const parts = [
		'## Schema summary (KV — authoritative for this kind/release)',
		crdTitle(schema),
		`Group: \`${schema.group}\``,
		`Resource name: \`${schema.resourceName}\``,
		`API version: \`${schema.apiVersion}\``,
		inferResourceType(schema),
		'',
		'### Required spec fields',
		...formatRequiredFieldDetails(schema),
		'',
		'### Spec fields'
	];

	const keyBullets = formatKeyFields(schema, fieldLimit, 280);
	if (keyBullets.length) {
		parts.push(...keyBullets);
		if (fieldLimit > 0 && specFieldCount > fieldLimit) {
			parts.push(`_…and ${specFieldCount - fieldLimit} more spec fields in the OpenAPI schema._`);
		}
	} else {
		parts.push('_No spec properties found in schema._');
	}

	const statusLines = formatStatusFieldSummary(schema);
	if (statusLines.length) {
		parts.push('', '### Status schema', ...statusLines);
	}

	parts.push('', '### Example skeleton', '```yaml', buildExampleYamlSnippet(schema), '```');
	return parts.join('\n');
}

/** Assemble warmed KV parts into one full-context block for Ask AI. */
export function assembleFullKvContext(parts: {
	schemaSummary?: string;
	relationships?: string;
	explain?: string;
	example?: string;
}): string {
	const sections: string[] = [];
	if (parts.schemaSummary?.trim()) sections.push(parts.schemaSummary.trim());
	if (parts.relationships?.trim()) sections.push(parts.relationships.trim());
	if (parts.explain?.trim()) {
		sections.push(`## Cached CRD explanation\n${parts.explain.trim()}`);
	}
	if (parts.example?.trim()) {
		const trimmed = parts.example.trim();
		sections.push(
			/```ya?ml/i.test(trimmed)
				? `## Cached example YAML\n${trimmed}`
				: `## Cached example YAML\n\`\`\`yaml\n${trimmed}\n\`\`\``
		);
	}
	return sections.join('\n\n');
}

/** Wrap KV-cached explain text as prioritized LLM context. */
export function formatKvContextSection(cachedAnswer: string, kind?: string): string {
	const label = kind
		? `## Cached CRD summary — ${kind} (KV — authoritative for this kind/release)`
		: '## Cached CRD summary (KV — authoritative for this kind/release)';
	return `${label}\n${cachedAnswer.trim()}`;
}

/** Wrap assembled full-context KV payload for Ask AI. */
export function formatKvFullContextSection(fullContext: string, kind?: string): string {
	const label = kind
		? `## Full CRD context — ${kind} (KV — authoritative for this kind/release)`
		: '## Full CRD context (KV — authoritative for this kind/release)';
	return `${label}\n${fullContext.trim()}`;
}

/** Wrap KV-cached example YAML as prioritized LLM context. */
export function formatKvExampleContextSection(cachedExample: string, kind?: string): string {
	const label = kind
		? `## Cached example YAML — ${kind} (KV — authoritative for this kind/release)`
		: '## Cached example YAML (KV — authoritative for this kind/release)';
	const trimmed = cachedExample.trim();
	if (/```ya?ml/i.test(trimmed)) {
		return `${label}\n${trimmed}`;
	}
	return `${label}\n\`\`\`yaml\n${trimmed}\n\`\`\``;
}

/** Wrap release-wide dependency map KV text for Ask AI context. */
export function formatKvDependencyMapSection(mapText: string): string {
	const label =
		'## Release dependency map (KV — authoritative topology for this EDA release)';
	return `${label}\n${mapText.trim()}`;
}

export type ExampleYamlTarget = {
	kind: string;
	group: string;
	release: string;
	apiVersion?: string;
};

/** Pro markdown answer for example-YAML questions (fallback or direct KV). */
export function formatExampleYamlAnswer(
	target: ExampleYamlTarget,
	yaml: string,
	options: { question?: string; notice?: string } = {}
): string {
	const { question, notice } = options;
	const api = target.apiVersion ?? target.group;
	const sections: string[] = [];

	if (notice) {
		sections.push(`_${notice}_`, '');
	}

	if (question) {
		sections.push(`**Question:** ${question}`, '');
	}

	sections.push(
		'## Overview',
		'',
		`Example YAML manifest for **${target.kind}** (\`${api}\`) in EDA release **${target.release}**.`,
		'',
		'## Example manifest',
		''
	);

	const trimmed = yaml.trim();
	if (/```ya?ml/i.test(trimmed)) {
		sections.push(trimmed, '');
	} else {
		sections.push('```yaml', trimmed, '```', '');
	}

	return sections.join('\n').trim();
}

/** Resolve example YAML text from a warmed KV example payload. */
export function resolveKvExampleText(payload: AiCachePayload | null | undefined): string | undefined {
	if (!payload?.answer?.trim()) return undefined;
	return pickRandomExample(payload).answer.trim();
}

export type MultiCrdFormatInput = {
	target: { kind: string; group: string; release: string };
	kvAnswer?: string;
	kvExample?: string;
	schema?: AiSchemaPayload;
};

/** Pro markdown answer for multiple CRDs (fallback when LLM unavailable). */
export function formatMultiCrdAnswer(
	inputs: MultiCrdFormatInput[],
	options: FormatAnswerOptions & { question?: string; asksExample?: boolean } = {}
): string {
	const { notice, question, asksExample } = options;
	const sections: string[] = [];

	if (notice) {
		sections.push(`_${notice}_`, '');
	}

	if (question) {
		sections.push(`**Question:** ${question}`, '');
	}

	if (inputs.length > 1) {
		const kindList = inputs.map((i) => `**${i.target.kind}**`).join(', ');
		sections.push(
			'## Overview',
			'',
			asksExample
				? `Example YAML for **${inputs.length}** EDA CRD(s) in release **${inputs[0]?.target.release ?? ''}**: ${kindList}.`
				: `Grounded summary for **${inputs.length}** EDA CRD(s) in release **${inputs[0]?.target.release ?? ''}**: ${kindList}.`,
			''
		);
	} else if (inputs.length === 1 && question && !asksExample) {
		const { target } = inputs[0];
		sections.push(
			'## Overview',
			'',
			`Answer for **${target.kind}** (\`${target.group}\`) in EDA release **${target.release}**.`,
			''
		);
	}

	for (const input of inputs) {
		const { target, kvAnswer, kvExample, schema } = input;

		if (asksExample) {
			const yaml = kvExample?.trim();
			if (yaml) {
				sections.push(
					formatExampleYamlAnswer(
						{
							kind: target.kind,
							group: target.group,
							release: target.release,
							apiVersion: schema?.apiVersion
						},
						yaml
					),
					''
				);
				continue;
			}
			if (schema) {
				sections.push(
					formatExampleYamlAnswer(
						{
							kind: target.kind,
							group: target.group,
							release: target.release,
							apiVersion: schema.apiVersion
						},
						buildExampleYamlSnippet(schema)
					),
					''
				);
				continue;
			}
			sections.push(
				`## ${target.kind} (\`${target.group}\`)`,
				'',
				`_No warmed example YAML or schema available for **${target.kind}** in release **${target.release}**._`,
				''
			);
			continue;
		}

		sections.push(`## ${target.kind} (\`${target.group}\`)`, '');

		if (kvAnswer?.trim()) {
			sections.push(kvAnswer.trim(), '');
		} else if (schema) {
			sections.push(formatCrdAnswer(schema, { includeExample: inputs.length === 1 }), '');
		} else {
			sections.push(
				`_No warmed KV summary or schema available for **${target.kind}** in release **${target.release}**._`,
				''
			);
		}
	}

	return sections.join('\n').trim();
}

/** Pro markdown answer listing required spec fields from schema. */
export function formatRequiredFieldsAnswer(
	schema: AiSchemaPayload,
	options: { question?: string; notice?: string } = {}
): string {
	const { question, notice } = options;
	const sections: string[] = [];

	if (notice) {
		sections.push(`_${notice}_`, '');
	}

	if (question) {
		sections.push(`**Question:** ${question}`, '');
	}

	sections.push(
		'## Overview',
		'',
		`Required top-level \`spec\` fields for **${schema.kind}** (\`${schema.apiVersion}\`) in EDA release **${schema.release}**.`,
		'',
		'## Required fields',
		''
	);

	if (schema.specRequired.length === 0) {
		sections.push('_No top-level required fields are listed in the OpenAPI schema for `spec`._');
	} else {
		const resolved = resolveObjectSchema(schema.specSchema);
		for (const field of schema.specRequired) {
			const prop = resolved?.properties?.[field];
			const type = schemaTypeLabel(prop);
			const desc = shortDescription(prop);
			sections.push(
				desc
					? `- \`${field}\` (${type}) — ${desc}`
					: `- \`${field}\` (${type})`
			);
		}
	}

	const optionalBullets = formatKeyFields(schema, 6).filter(
		(b) => !schema.specRequired.some((r) => b.includes(`\`${r}\``))
	);
	if (optionalBullets.length) {
		sections.push('', '## Other notable spec fields', '', ...optionalBullets);
	}

	return sections.join('\n').trim();
}
