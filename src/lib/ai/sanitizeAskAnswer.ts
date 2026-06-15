import type { AskQuestionIntent } from './classifyQuestionIntent';

/** Remove server/UI "## Related in EDA" footer if the model echoed it. */
export function stripRelatedSection(answer: string): string {
	return answer.replace(/\n*##\s+Related in EDA\b[\s\S]*$/i, '').trim();
}

/** Remove inline [Source: …] citation markers from LLM output. */
export function stripSourceCitations(answer: string): string {
	return answer.replace(/\s*\[Source:\s*[^\]]+\]/gi, '').trim();
}

const UNWANTED_SECTIONS = /^##\s+(?:Overview|Notes|Use case|Key fields|Cached CRD explanation)\b/im;

/** Drop common extra sections when the question did not ask for an overview tour. */
export function stripUnwantedOverviewSections(answer: string): string {
	const parts = answer.split(/(?=^##\s+)/m);
	if (parts.length <= 1) return answer;

	const preamble = parts[0].trim();
	const kept: string[] = preamble ? [preamble] : [];

	for (let i = 1; i < parts.length; i++) {
		const block = parts[i];
		if (UNWANTED_SECTIONS.test(block)) continue;
		kept.push(block.trimStart());
	}

	return kept.join('\n\n').trim();
}

const INTENT_SECTION: Partial<Record<AskQuestionIntent, RegExp>> = {
	required_fields: /^##\s+Required\s+fields\b/i,
	example_yaml: /^##\s+Example\b/i,
	relationships: /^##\s+Relationships\b/i,
	overview: /^##\s+Overview\b/i
};

/** Keep preamble plus only the section header that matches the classified intent. */
export function keepIntentSections(answer: string, intent: AskQuestionIntent): string {
	const allowed = INTENT_SECTION[intent];
	if (!allowed) return stripUnwantedOverviewSections(answer);

	const parts = answer.split(/(?=^##\s+)/m);
	if (parts.length <= 1) return stripUnwantedOverviewSections(answer);

	const preamble = parts[0].trim();
	const kept: string[] = preamble ? [preamble] : [];

	for (let i = 1; i < parts.length; i++) {
		const block = parts[i];
		const header = block.match(/^##\s+([^\n]+)/)?.[1] ?? '';
		if (/^Related in EDA\b/i.test(header)) continue;
		if (allowed.test(`## ${header}`)) {
			kept.push(block.trimStart());
		}
	}

	return kept.join('\n\n').trim() || answer.trim();
}

/** Normalize LLM markdown for Ask AI display. */
export function sanitizeAskAnswer(answer: string, intent?: AskQuestionIntent): string {
	let text = stripRelatedSection(answer);
	text = stripSourceCitations(text);
	if (intent) {
		text = keepIntentSections(text, intent);
	} else {
		text = stripUnwantedOverviewSections(text);
	}
	return text.trim();
}
