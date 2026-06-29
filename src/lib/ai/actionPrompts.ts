import type { AiSchemaPayload } from './loadAiSchema';
import { formatSchemaContextForLlm } from './formatAnswer';
import {
	schemaAtYamlPath,
	schemaParentAtPath
} from '$lib/validate-bundle/schemaNavigation';

export type ActionPrompt = {
	system: string;
	user: string;
};

const SCHEMA_JSON_LIMIT = 10_000;
const FIX_SCOPED_SCHEMA_LIMIT = 8_000;
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
	return buildSchemaPrompt(release, kind, schema, SCHEMA_JSON_LIMIT);
}

function fieldPathToSpecSegments(fieldPath?: string): string[] {
	if (!fieldPath) return [];
	return fieldPath
		.replace(/^spec\./, '')
		.split('.')
		.filter(Boolean);
}

/** Compact CRD schema context for fix prompts — parent object + field subtree only. */
export function buildFixScopedSchemaPrompt(
	release: string,
	kind: string,
	schema: AiSchemaPayload,
	issue: FixIssueContext
): string {
	const segments = fieldPathToSpecSegments(issue.fieldPath);
	const includeSpecAsParent =
		segments.length === 1 &&
		(issue.issueKind === 'unknownField' || issue.issueKind === 'type');
	const parentSchema =
		schema.specSchema && segments.length > 1
			? schemaParentAtPath(schema.specSchema, segments)
			: schema.specSchema && includeSpecAsParent
				? schema.specSchema
				: null;
	const leafSchema =
		schema.specSchema && segments.length > 0
			? schemaAtYamlPath(schema.specSchema, segments)
			: null;

	const scoped: Record<string, unknown> = {
		apiVersion: schema.apiVersion,
		kind: schema.kind,
		group: schema.group,
		release,
		specRequired: schema.specRequired
	};
	if (issue.fieldPath) scoped.fieldPath = issue.fieldPath;
	if (parentSchema) scoped.parentObjectSchema = parentSchema;
	if (leafSchema) scoped.fieldSchema = leafSchema;

	const scopedJson = truncateJson(scoped, FIX_SCOPED_SCHEMA_LIMIT);

	return `You are an expert assistant for Nokia EDA (Event-Driven Automation) Custom Resource Definitions (CRDs).
You fix Kubernetes-style YAML manifests for "${kind}" (API group ${schema.group}, release ${release}).

STRICT RULES:
- Use ONLY the schema JSON below for the reported field path. Never invent fields, types, or enum values.
- If a field is not in the schema context, it is not defined for this CRD version.
- Apply minimal edits only — one issue per request.

CRD SCHEMA (relevant subtree for this fix — not the full CRD):
\`\`\`json
${scopedJson}
\`\`\``;
}

function buildSchemaPrompt(
	release: string,
	kind: string,
	schema: AiSchemaPayload,
	jsonLimit: number
): string {
	const structured = formatSchemaContextForLlm(schema);
	const truncated = truncateJson(schemaForPrompt(schema), jsonLimit);
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

export type FixIssueContext = {
	message: string;
	fieldPath?: string;
	line?: number;
	severity?: string;
	renameHint?: { from: string; to: string };
	issueKind?: 'unknownField' | 'misspelledField' | 'enum' | 'type' | 'required' | 'syntax' | 'other';
	allowedSiblingKeys?: string[];
	allowedValues?: string[];
	expectedTypes?: string[];
	/** When true, a one-click deterministic fix exists — AI must not be used. */
	deterministicFixAvailable?: boolean;
	suggestedFix?: { action?: string; field: string; value: string };
	/** Parent-path-specific schema note (e.g. Fabric underlay vs overlay protocol key). */
	parentPathContext?: string;
	relocationHint?: { from: string; to: string };
	migrationContext?: string;
	relatedIssues?: string[];
};

function issueKindRules(issue: FixIssueContext): string[] {
	const rules: string[] = [];

	if (issue.renameHint) {
		rules.push(
			`RENAME ONLY: change YAML key "${issue.renameHint.from}" to "${issue.renameHint.to}". Preserve the value under that key exactly — same scalars, same list items, same child keys, same order.`
		);
	}

	if (issue.relocationHint) {
		rules.push(
			`RELOCATE: move "${issue.relocationHint.from}" to "${issue.relocationHint.to}" preserving the value. Remove the old key after relocating.`
		);
	}

	if (issue.migrationContext) {
		rules.push(`Migration context: ${issue.migrationContext}`);
	}

	switch (issue.issueKind) {
		case 'misspelledField':
			if (issue.allowedSiblingKeys?.length) {
				rules.push(
					`Valid property names at this object level (from CRD schema): ${issue.allowedSiblingKeys.join(', ')}`
				);
			}
			rules.push(
				'Prefer RENAMING the YAML key to the correct schema property. Keep the field value unchanged.'
			);
			rules.push(
				'For rename/misspelled field fixes: rename the YAML key only — do not add or remove list items, enum values, or child keys.'
			);
			rules.push(
				'Preserve the exact indentation structure and all existing scalar, array, and object values under the renamed key.'
			);
			rules.push(
				'Do not delete a field when a matching or similar schema property exists at the same object level.'
			);
			break;
		case 'unknownField':
			if (issue.allowedSiblingKeys?.length) {
				rules.push(
					`Valid property names at this object level (from CRD schema): ${issue.allowedSiblingKeys.join(', ')}`
				);
			}
			if (issue.renameHint) {
				rules.push(
					'Prefer RENAMING the YAML key to the correct schema property. Keep the field value unchanged.'
				);
				rules.push(
					'For rename fixes: rename the YAML key only — do not add or remove list items, enum values, or child keys.'
				);
			} else {
				rules.push(
					'Remove the unknown field and/or relocate its value to a schema-valid property path within spec.'
				);
				rules.push(
					'When relocating, preserve the original scalar, list, or object value being moved — do not invent new configuration.'
				);
				rules.push(
					'Structural edits within spec are allowed when removing obsolete fields and placing values under nested schema paths (e.g. encapOptions.vxlan).'
				);
				rules.push(
					'Example: spec.tunnelIndexPool: pool → spec.encapOptions.vxlan.tunnelIndexPool: pool (delete the old key).'
				);
			}
			break;
		case 'enum':
			if (issue.allowedValues?.length) {
				rules.push(
					`Allowed values (exact case required): ${issue.allowedValues.join(', ')}`
				);
			}
			rules.push(
				'Change only the single invalid scalar value to a schema-valid enum value. Never expand a list to include all schema enum options.'
			);
			rules.push('Do not restructure the document or add enum values that were not in the original.');
			break;
		case 'type':
			if (issue.expectedTypes?.length) {
				rules.push(`Expected types from schema: ${issue.expectedTypes.join(', ')}`);
			}
			rules.push('Coerce or correct the value to match the schema type with minimal changes.');
			rules.push(
				'Structural wrapping is allowed at the reported field path (e.g. convert a boolean scalar to an object with schema-required child keys).'
			);
			rules.push(
				'Example: macLearning: true → macLearning:\\n  enabled: true (merge macAging into agingTimeSeconds when present).'
			);
			break;
		case 'required':
			rules.push(
				'Add the missing field with a schema-appropriate empty value (empty string, [], or {}) — do not invent semantic configuration values.'
			);
			break;
		case 'syntax':
			rules.push('Fix only YAML syntax. Do not change semantic field values unless required for valid YAML.');
			break;
	}
	return rules;
}

const MINIMAL_FIX_RULES = [
	'MINIMAL FIX: output YAML must be identical to the input except for the single minimal edit that resolves the reported issue.',
	'Lines and fields not related to the issue MUST be byte-identical to the input (same keys, values, order, indentation, spacing, and quote style).',
	'FORBIDDEN: adding new keys, list items, object properties, or blocks that were not in the original — unless the issue is a missing required field.',
	'FORBIDDEN: filling an empty object `{}` with default sub-fields from the schema.',
	'FORBIDDEN: expanding a list to include additional enum or schema options not present in the original.',
	'FORBIDDEN: reformatting indentation, spacing, or quote style on unrelated lines.',
	'For rename issues: change exactly one YAML key name — zero value changes, zero list additions/removals.',
	'For enum issues: change exactly one scalar value — do not expand or restructure lists.',
	'For required-field issues: add only the single missing field with an empty placeholder (`""`, `[]`, or `{}`) — no sibling or nested fields.'
];

function minimalFixRulesFor(issue: FixIssueContext): string[] {
	if (issue.issueKind === 'type') {
		return MINIMAL_FIX_RULES.map((rule) =>
			rule.startsWith('FORBIDDEN: adding new keys')
				? 'ALLOWED for type fixes: add object/array child keys under the reported field path when wrapping a scalar to match the schema type.'
				: rule
		);
	}

	if (issue.issueKind === 'unknownField' && !issue.renameHint) {
		return [
			...MINIMAL_FIX_RULES.filter((rule) => !rule.startsWith('FORBIDDEN: adding new keys')),
			'ALLOWED for unknown-field fixes: remove the unknown field and add schema-valid paths within spec to relocate its value.',
			'Keep unrelated spec fields, metadata, and apiVersion/kind unchanged unless required for relocation.'
		];
	}

	return MINIMAL_FIX_RULES;
}

export function promptFixYaml(
	release: string,
	kind: string,
	schema: AiSchemaPayload,
	docYaml: string,
	issue: FixIssueContext,
	options?: { excerptYaml?: string }
): ActionPrompt {
	const yamlForPrompt = options?.excerptYaml ?? docYaml;
	const excerptNote = options?.excerptYaml
		? '\n- The YAML excerpt is for context only; FIXED_YAML must be the complete corrected document.'
		: '';
	const issueLines = [
		issue.issueKind ? `Issue type: ${issue.issueKind}` : null,
		`Message: ${issue.message}`,
		issue.fieldPath ? `Field: ${issue.fieldPath}` : null,
		issue.line ? `Line: ${issue.line}` : null,
		issue.severity ? `Severity: ${issue.severity}` : null,
		issue.renameHint
			? `Rename hint: replace YAML key "${issue.renameHint.from}" with "${issue.renameHint.to}" (keep the same value)`
			: null,
		issue.relocationHint
			? `Relocation hint: move "${issue.relocationHint.from}" to "${issue.relocationHint.to}" (preserve value)`
			: null,
		issue.migrationContext ? `Migration: ${issue.migrationContext}` : null,
		issue.relatedIssues?.length ? `Related issues: ${issue.relatedIssues.join('; ')}` : null,
		issue.parentPathContext ? `Parent path context: ${issue.parentPathContext}` : null,
		issue.allowedValues?.length
			? `Schema allowed values: ${issue.allowedValues.join(', ')}`
			: null,
		issue.expectedTypes?.length ? `Schema expected types: ${issue.expectedTypes.join(', ')}` : null
	]
		.filter(Boolean)
		.join('\n');

	const kindRules = issueKindRules(issue);

	return {
		system: buildFixScopedSchemaPrompt(release, kind, schema, issue),
		user: `Fix the following YAML manifest to resolve ONE validation issue for "${kind}" (EDA release ${release}).

VALIDATION ISSUE:
${issueLines}

CURRENT YAML:
\`\`\`yaml
${yamlForPrompt}
\`\`\`

Rules:
${minimalFixRulesFor(issue).map((r) => `- ${r}`).join('\n')}${excerptNote}
- Use valid enum values and types from the schema only — never invent fields or values not in the schema.
- If a Rename hint is provided, apply that rename exactly and leave all values under the renamed key unchanged.
${kindRules.map((r) => `- ${r}`).join('\n')}
- If the issue cannot be fixed safely without guessing, say FIXABLE: no.

Output format (use exactly this structure):

FIXABLE: yes | no

EXPLANATION: one short paragraph describing what you changed or why it is not fixable

FIXED_YAML:
\`\`\`yaml
(full corrected document — required when FIXABLE: yes)
\`\`\``
	};
}

export function promptFixYamlMigration(
	release: string,
	kind: string,
	schema: AiSchemaPayload,
	docYaml: string,
	issues: FixIssueContext[]
): ActionPrompt {
	const issueList = issues
		.map(
			(issue, index) =>
				`${index + 1}. ${issue.fieldPath ?? 'document'}: ${issue.message}${
					issue.relocationHint
						? ` (relocate ${issue.relocationHint.from} → ${issue.relocationHint.to})`
						: ''
				}`
		)
		.join('\n');

	const migrationContext = issues.find((i) => i.migrationContext)?.migrationContext;

	return {
		system: buildFixScopedSchemaPrompt(release, kind, schema, issues[0] ?? { message: '' }),
		user: `Fix the following YAML manifest to resolve ALL listed validation issues for "${kind}" (EDA release ${release}) in one pass.

${migrationContext ? `MIGRATION CONTEXT: ${migrationContext}\n` : ''}ISSUES TO FIX:
${issueList}

CURRENT YAML:
\`\`\`yaml
${docYaml}
\`\`\`

Rules:
- Fix every listed issue in a single corrected document.
- Structural edits within spec are allowed (relocate obsolete fields, wrap scalars into objects per schema).
- Upgrade apiVersion when deprecated; preserve metadata.name and metadata.namespace.
- Do not invent configuration values — preserve existing scalars when relocating.
- Use only fields defined in the CRD schema.
- If the issues cannot be fixed safely, say FIXABLE: no.

Output format (use exactly this structure):

FIXABLE: yes | no

EXPLANATION: one short paragraph describing what you changed

FIXED_YAML:
\`\`\`yaml
(full corrected document — required when FIXABLE: yes)
\`\`\``
	};
}

export function promptFixYamlSyntax(
	release: string,
	docYaml: string,
	issue: FixIssueContext
): ActionPrompt {
	const issueLines = [
		`Message: ${issue.message}`,
		issue.line ? `Line: ${issue.line}` : null
	]
		.filter(Boolean)
		.join('\n');

	const renameRule =
		issue.renameHint || issue.issueKind === 'misspelledField' || issue.issueKind === 'unknownField'
			? `
- If fixing a misspelled or unknown field key: rename the key only — do not add or remove list items, enum values, or child keys; preserve all existing values verbatim.
- Never populate fields with schema enum options that were not in the original document.`
			: '';

	return {
		system: `You are an expert at fixing YAML syntax for Kubernetes manifests used in Nokia EDA release ${release}.
Fix only syntax/structure problems (indentation, quotes, colons, list markers, document structure).
Do not invent spec fields or change semantic values unless required to make valid YAML.
Preserve apiVersion, kind, metadata.name, and metadata.namespace when present.`,
		user: `Fix the YAML syntax error below.

ISSUE:
${issueLines}

BROKEN YAML:
\`\`\`yaml
${docYaml}
\`\`\`

Rules:
${MINIMAL_FIX_RULES.map((r) => `- ${r}`).join('\n')}${renameRule}
- Do not change semantic field values unless required to make valid YAML.

Output format (use exactly this structure):

FIXABLE: yes | no

EXPLANATION: one short paragraph

FIXED_YAML:
\`\`\`yaml
(full corrected document — required when FIXABLE: yes)
\`\`\``
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
	fix: 2048,
	example: 1200,
	compare: 500,
	'spec-search': 400,
	'schema-summary': 0,
	'full-context': 0
};
