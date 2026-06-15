export type ParsedFixResponse = {
	fixable: boolean;
	explanation: string;
	fixedYaml?: string;
};

/** Parse Workers AI fix action output into structured fields. */
export function parseFixResponse(text: string): ParsedFixResponse {
	const trimmed = text.trim();
	if (!trimmed) {
		return { fixable: false, explanation: '' };
	}

	const fixableMatch = trimmed.match(/^FIXABLE:\s*(yes|no)\b/im);
	const explicitlyNotFixable = fixableMatch?.[1]?.toLowerCase() === 'no';

	let explanation = '';
	const explanationMatch = trimmed.match(/^EXPLANATION:\s*(.+)$/im);
	if (explanationMatch) {
		explanation = explanationMatch[1].trim();
	} else {
		const beforeYaml = trimmed.split(/```ya?ml/i)[0]?.trim();
		if (beforeYaml) {
			explanation = beforeYaml.replace(/^FIXABLE:\s*(yes|no)\s*/im, '').trim();
		}
	}

	const yamlMatch = trimmed.match(/```ya?ml\n([\s\S]*?)```/i);
	const fixedYaml = yamlMatch?.[1]?.trim();

	if (explicitlyNotFixable || !fixedYaml) {
		return { fixable: false, explanation, fixedYaml: undefined };
	}

	return { fixable: true, explanation, fixedYaml };
}
