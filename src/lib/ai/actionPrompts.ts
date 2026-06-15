import type { AiSchemaPayload } from './loadAiSchema';
import { formatSchemaContextForLlm } from './formatAnswer';

export type ActionPrompt = {
	system: string;
	user: string;
};

const SCHEMA_JSON_LIMIT = 10_000;
const COMPARE_SCHEMA_LIMIT = 3000;

function schemaForPrompt(schema: AiSchemaPayload): Record<string, unknown> {
	return {
		apiVersion: schema.apiVersion,
		kind: schema.kind,
		group: schema.group,
		release: schema.release,
		deprecated: schema.deprecated,
		specRequired: schema.specRequired,
		statusRequired: schema.statusRequired,
		specSchema: schema.specSchema,
		statusSchema: schema.statusSchema
	};
}

function truncateJson(value: unknown, limit: number): string {
	const schemaStr = JSON.stringify(value, null, 2);
	if (schemaStr.length <= limit) return schemaStr;
	return `${schemaStr.slice(0, limit)}\n... (truncated)`;
}

export function buildBasePrompt(release: string, kind: string, schema: AiSchemaPayload): string {
	const structured = formatSchemaContextForLlm(schema);
	const truncated = truncateJson(schemaForPrompt(schema), SCHEMA_JSON_LIMIT);
	return `You are an expert assistant for Nokia EDA (Event-Driven Automation) Custom Resource Definitions (CRDs).
You work exclusively with the Kubernetes-style CRD schemas used by Nokia's EDA platform.

STRICT RULES:
- Answer ONLY based on the schema provided below. Never invent fields, types, or behaviors.
- If something is not in the schema, say "not defined in this schema version".
- Be precise and technical. Your audience is network engineers and Kubernetes operators.
- Never use filler phrases like "Great question!" or "Certainly!".
- Use field paths in dot notation (e.g. spec.adminState, metadata.labels).
- For enums, always list ALL valid values.
- Format responses as structured Markdown: ## Overview, ## Key fields, ## Example (with \`\`\`yaml fence when showing manifests).

CONTEXT:
  Nokia EDA Release: ${release}
  Resource Kind: ${kind}
  API Group: ${schema.group}
  API Version: ${schema.apiVersion}

STRUCTURED SCHEMA SUMMARY:
${structured}

FULL CRD SCHEMA (JSON — reference only, prefer structured summary above):
\`\`\`json
${truncated}
\`\`\``;
}

export function promptExplain(release: string, kind: string, schema: AiSchemaPayload): ActionPrompt {
	return {
		system: buildBasePrompt(release, kind, schema),
		user: `Explain the "${kind}" resource (API group ${schema.group}) in Nokia EDA release ${release}.

Use this Markdown structure:

## Overview
(2–4 sentences: what this resource represents, its role in EDA, and when operators use it)

## Use case
(1–2 sentences: primary operational purpose)

## Required fields
(List EVERY required top-level spec field from the schema with type and a one-line description. Do not omit any.)

## Key fields
(Bullet list of important optional spec fields with brief descriptions — cover as many meaningful fields as the schema provides, up to 12)

## Resource type
(Config vs State — infer from schema; note status sub-resource if present)

## Relationships
(How this CRD typically relates to other EDA resources in the same group, when inferable from field names/descriptions)

Be thorough and precise. Use exact field names from the schema. No raw JSON dumps. Aim for 350–500 words.`
	};
}

export function promptField(
	release: string,
	kind: string,
	schema: AiSchemaPayload,
	fieldPath: string
): ActionPrompt {
	return {
		system: buildBasePrompt(release, kind, schema),
		user: `Explain the field "${fieldPath}" in the "${kind}" CRD (EDA release ${release}).

Provide:
1. Type (string, integer, boolean, object, array, etc.)
2. Required or optional?
3. All valid values / enum options if applicable
4. Default value if defined
5. What it controls in the network (1-2 sentences)
6. Any validation constraints (min, max, pattern, etc.)

If this field does not exist in the schema, say exactly:
"Field '${fieldPath}' is not defined in ${kind} for release ${release}."`
	};
}

export function promptValidate(
	release: string,
	kind: string,
	schema: AiSchemaPayload,
	userYaml: string
): ActionPrompt {
	return {
		system: buildBasePrompt(release, kind, schema),
		user: `Validate the following YAML manifest against the "${kind}" CRD schema for Nokia EDA release ${release}.

YAML TO VALIDATE:
\`\`\`yaml
${userYaml}
\`\`\`

Instructions:
- Check that apiVersion and kind match
- Check all required fields are present
- Check field types match the schema
- Check enum values are valid
- Check no unknown fields exist (if schema has additionalProperties: false)

Output format (ALWAYS use this exact format):

STATUS: VALID | INVALID | WARNINGS

ERRORS: (list each as "field.path: reason" — omit section if no errors)
WARNINGS: (list each as "field.path: reason" — omit section if no warnings)
SUMMARY: one sentence.`
	};
}

export function promptExample(release: string, kind: string, schema: AiSchemaPayload): ActionPrompt {
	return {
		system: buildBasePrompt(release, kind, schema),
		user: `Generate 3 distinct, valid YAML examples for the "${kind}" resource in Nokia EDA release ${release}.

Requirements for each example:
- Must be valid against the schema (all required fields present, correct types)
- Use realistic values (not "string" or "value1")
- Include a comment on any non-obvious field choice
- Examples should differ meaningfully (different use cases or configurations)

Output format:
\`\`\`yaml
# Example 1: [brief description]
apiVersion: ...
kind: ${kind}
metadata:
  name: example-1
spec:
  ...
\`\`\`

\`\`\`yaml
# Example 2: [brief description]
...
\`\`\`

\`\`\`yaml
# Example 3: [brief description]
...
\`\`\``
	};
}

export function promptCompare(
	kind: string,
	schemaOld: AiSchemaPayload,
	schemaNew: AiSchemaPayload,
	releaseOld: string,
	releaseNew: string
): ActionPrompt {
	const oldStr = truncateJson(schemaForPrompt(schemaOld), COMPARE_SCHEMA_LIMIT);
	const newStr = truncateJson(schemaForPrompt(schemaNew), COMPARE_SCHEMA_LIMIT);
	return {
		system: `You are an expert on Nokia EDA CRD schema evolution.
Analyze two versions of the same CRD and describe what changed precisely.
Be technical and concise. Your audience is network operators upgrading between EDA releases.
Never invent changes. Only report what is structurally different in the schemas.`,
		user: `Compare the "${kind}" CRD between Nokia EDA releases ${releaseOld} and ${releaseNew}.

SCHEMA ${releaseOld}:
\`\`\`json
${oldStr}
\`\`\`

SCHEMA ${releaseNew}:
\`\`\`json
${newStr}
\`\`\`

Output format:

## Breaking Changes
(fields removed or type-changed — list as "field.path: old → new")

## New Fields
(fields added — list as "field.path: type — description")

## Modified Fields
(defaults changed, validation changed, description changed)

## No Change
If nothing changed, say: "Schema is identical between ${releaseOld} and ${releaseNew}."`
	};
}

export function promptSpecSearch(
	release: string,
	kind: string,
	schema: AiSchemaPayload,
	query: string
): ActionPrompt {
	return {
		system: buildBasePrompt(release, kind, schema),
		user: `Search the "${kind}" CRD schema for fields related to: "${query}"

Instructions:
- Find all fields in the schema that match the query semantically or by name
- Include nested fields using dot notation
- Sort by relevance (most relevant first)

Output format for each match:
- \`field.path\` (type) — one-line description

If no fields match, say: "No fields related to '${query}' found in ${kind} for release ${release}."`
	};
}

export const ACTION_MAX_TOKENS: Record<string, number> = {
	explain: 768,
	field: 300,
	validate: 400,
	example: 1200,
	compare: 500,
	'spec-search': 400,
	'schema-summary': 0,
	'full-context': 0
};
