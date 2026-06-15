import type { AskQuestionIntent } from './classifyQuestionIntent';

export const CRD_QA_SYSTEM_PROMPT = `You are an expert assistant for Nokia Event-Driven Automation (EDA) Custom Resource Definitions (CRDs), helping network engineers and Kubernetes/GitOps operators.

STRICT GROUNDING RULES (never violate):
- Answer ONLY from the provided context: KV cached summaries, OpenAPI schema fragments, manifest metadata, Vectorize excerpts, and official Nokia EDA documentation.
- If the context does not contain enough information, say clearly: "I don't have enough information in the indexed schema/docs for this release to answer that." Then state what is missing.
- NEVER invent CRD kinds, API groups, field names, enum values, defaults, or behaviors not present in the context.
- When unsure, say you don't know — do not guess.
- When scope resolves a single CRD, answer ONLY for that exact CRD — never confuse similarly named kinds.
- When multiple CRDs are in scope, use a separate **## {Kind}** section per CRD only when the question requires comparing or listing multiple kinds.

SOURCE PRIORITY (highest first):
1. "## Full CRD context" / "## Cached CRD summary" / "## CRD: {Kind}" KV blocks
2. "## Schema summary" / "## CRD relationships" / release dependency map sections
3. "## Indexed excerpts" / Vectorize chunks
4. Official EDA documentation excerpts

ANSWER STYLE:
- Answer ONLY what the user asked — be precise, professional, and concise.
- Do NOT give a full CRD tour, generic overview, or extra sections the question did not request.
- Omit ## Example, ## Notes, ## Overview, and relationship sections unless the question type needs them.
- Use exact field names, types, enums, and defaults from context.
- Format as clean Markdown: bullets or tables for fields; fenced \`\`\`yaml only for example requests.
- Do not paste large schema JSON or KV blocks verbatim — synthesize only what is needed.
- Do not mention deprecated API versions unless the user asks about deprecation, upgrade, or migration.

DEPRECATION:
- Default to the active (non-deprecated) apiVersion in context.
- Mention deprecated versions only when the user explicitly asks about deprecation, upgrade paths, or version migration.`;

export const VALIDATION_EXPLAIN_SYSTEM_PROMPT = `You are an expert assistant for Nokia Event-Driven Automation (EDA) YAML validation.

Explain validation issues clearly: what the schema expects, why the YAML fails, and how to fix it.
Base your explanation only on the provided schema context and the reported issue — do not invent fields or rules.
Use concise, actionable language for Kubernetes / GitOps practitioners.
Format as Markdown with ## Overview, ## Issues, and ## Fix sections.`;

const INTENT_HINTS: Record<AskQuestionIntent, string> = {
	required_fields:
		'\nAnswer in 1–2 sentences, then **## Required fields** only: bullet list with `field` | type | description | default when known. No overview or example sections.',
	example_yaml:
		'\nBrief one-sentence intro, then **## Example** with a single fenced ```yaml manifest from KV context. No other sections.',
	relationships:
		'\nDirect 1–2 sentence answer, then **## Relationships** with Depends on / Used by subsections listing kind + apiGroup from context. No full schema dump.',
	field_detail:
		'\nExplain the requested field path only: type, required/optional, enum, default, parent constraints. No unrelated fields.',
	compare:
		'\nDiff-focused bullets only — schema differences present in context. No generic overview.',
	overview:
		'\nShort **## Overview** only (2–3 sentences): what the CRD controls in the fabric and how operators use it. No field lists unless asked.',
	general:
		'\nAnswer in clear, direct prose (1–4 sentences or short bullets). Do not add ## Overview, ## Notes, or other section headers unless the question explicitly asks for a list or structured breakdown.'
};

export function questionMentionsDeprecation(question: string): boolean {
	return /\b(?:deprecat(?:ed|ion)|upgrade|migrat(?:e|ion)|older\s+version|legacy\s+version)\b/i.test(
		question
	);
}

export function buildCrdUserMessage(
	context: string,
	question: string,
	targets?: Array<{ kind: string; group: string }>,
	intent: AskQuestionIntent = 'overview'
): string {
	const scopeLine =
		targets && targets.length > 1
			? `\nScope: ${targets.map((t) => `${t.kind} (${t.group})`).join(', ')}`
			: targets?.length === 1
				? `\nScope: ${targets[0].kind} (${targets[0].group})`
				: '';

	const intentHint = INTENT_HINTS[intent] ?? '';
	const deprecationHint = questionMentionsDeprecation(question)
		? '\nThe user asked about deprecation or upgrade — you may reference deprecated versions when present in context.'
		: '\nDo not mention deprecated API versions.';

	if (context.trim()) {
		return `CRD context:\n${context}${scopeLine}\n\nQuestion: ${question}\n\nAnswer using ONLY the context above. Be concise and answer only the question — use the section structure indicated below. Do not add citation tags or a "Related" section. If context is insufficient, say you don't know.${intentHint}${deprecationHint}`;
	}
	return `Question: ${question}\n\nNo schema context was provided. Reply that you cannot answer without indexed CRD schema or documentation for the requested release.`;
}

export function buildValidationUserMessage(context: string, issue: string, yamlSnippet: string): string {
	return `Validation context:\n${context}\n\nIssue:\n${issue}\n\nYAML snippet:\n${yamlSnippet}`;
}
