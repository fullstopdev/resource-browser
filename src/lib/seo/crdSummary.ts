import type { SchemaSections } from '$lib/yaml-validation/schemaCache';

export type CrdSeoSummary = {
	kind: string;
	group: string;
	version: string;
	release: string;
	/** First sentence(s) of the CRD's own description, for the meta description. */
	description: string | null;
	/** Top-level spec fields, required first. */
	fields: Array<{ name: string; type: string; required: boolean }>;
};

const MAX_DESCRIPTION = 300;
const MAX_FIELDS = 25;

function shortDescription(text: unknown): string | null {
	if (typeof text !== 'string' || !text.trim()) return null;
	const clean = text.replace(/\s+/g, ' ').trim();
	if (clean.length <= MAX_DESCRIPTION) return clean;
	const cut = clean.slice(0, MAX_DESCRIPTION);
	const sentenceEnd = cut.lastIndexOf('. ');
	return sentenceEnd > 80 ? cut.slice(0, sentenceEnd + 1) : `${cut.trimEnd()}…`;
}

/** What the server-rendered catalog page says about a CRD (meta description + structured data). */
export function buildCrdSeoSummary(params: {
	kind: string;
	group: string;
	version: string;
	release: string;
	sections: SchemaSections;
}): CrdSeoSummary {
	const top = params.sections.topLevel as Record<string, unknown> | undefined;
	const spec = params.sections.spec as
		| {
				description?: unknown;
				properties?: Record<string, { type?: unknown }>;
				required?: string[];
		  }
		| undefined;
	const required = new Set(spec?.required ?? []);
	const fields = Object.entries(spec?.properties ?? {})
		.map(([name, node]) => ({
			name,
			type: typeof node?.type === 'string' ? node.type : 'object',
			required: required.has(name)
		}))
		.sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name))
		.slice(0, MAX_FIELDS);
	return {
		kind: params.kind,
		group: params.group,
		version: params.version,
		release: params.release,
		description: shortDescription(spec?.description) ?? shortDescription(top?.description),
		fields
	};
}

/** schema.org TechArticle for a CRD reference page, as a JSON string safe inside <script>. */
export function crdJsonLd(summary: CrdSeoSummary, url: string): string {
	const fieldList = summary.fields
		.map((f) => `${f.name} (${f.type}${f.required ? ', required' : ''})`)
		.join(', ');
	const json = {
		'@context': 'https://schema.org',
		'@type': 'TechArticle',
		headline: `${summary.kind} ${summary.version} — Nokia EDA ${summary.release} CRD reference`,
		about: `${summary.kind} (${summary.group}/${summary.version})`,
		description: summary.description ?? undefined,
		articleSection: 'Custom Resource Definitions',
		keywords: ['Nokia EDA', summary.kind, summary.group, 'CRD', 'Kubernetes'],
		...(fieldList ? { abstract: `spec fields: ${fieldList}` } : {}),
		url
	};
	// Escape "<" so the JSON can never close the surrounding <script> tag.
	return JSON.stringify(json).replace(/</g, '\\u003c');
}
