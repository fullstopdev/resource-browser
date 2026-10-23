export type ParsedFixResponse = {
	fixable: boolean;
	explanation: string;
	fixedYaml?: string;
};

/**
 * The fenced YAML block of an answer: prefers a `yaml`/`yml` fence, accepts an unlabelled one,
 * tolerates a missing closing fence, and keeps the first line's indentation (excerpt fixes).
 */
function extractYamlBlock(text: string): string | undefined {
	const fenced =
		text.match(/```[ \t]*ya?ml[ \t]*\n([\s\S]*?)(?:\n```|$)/i) ??
		text.match(/```[ \t]*\n([\s\S]*?)(?:\n```|$)/);
	const block = fenced?.[1]
		?.replace(/^(?:[ \t]*\n)+/, '')
		.replace(/\s+$/, '')
		.replace(/\n```[\s\S]*$/, '');
	return block ? block : undefined;
}

/** Parse Workers AI fix action output into structured fields. */
export function parseFixResponse(text: string): ParsedFixResponse {
	const trimmed = text.replace(/\r\n?/g, '\n').trim();
	if (!trimmed) {
		return { fixable: false, explanation: '' };
	}

	const fixableMatch = trimmed.match(/^\**FIXABLE\**:\s*\**\s*(yes|no)\b/im);
	const explicitlyNotFixable = fixableMatch?.[1]?.toLowerCase() === 'no';

	let explanation = '';
	const explanationMatch = trimmed.match(/^\**EXPLANATION\**:\s*(.+)$/im);
	if (explanationMatch) {
		explanation = explanationMatch[1].replace(/\*+/g, '').trim();
	} else {
		const beforeYaml = trimmed.split(/```/)[0]?.trim();
		if (beforeYaml) {
			explanation = beforeYaml.replace(/^\**FIXABLE\**:\s*\**\s*(yes|no)\s*/im, '').trim();
		}
	}

	const fixedYaml = extractYamlBlock(trimmed);

	if (explicitlyNotFixable || !fixedYaml) {
		return { fixable: false, explanation, fixedYaml: undefined };
	}

	return { fixable: true, explanation, fixedYaml };
}
