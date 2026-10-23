import { extractYamlIssueExcerpt } from '$lib/validate-bundle/yamlIssueExcerpt';

/** Documents up to this many lines are sent whole, and the model returns the whole document. */
export const FULL_DOC_LINE_LIMIT = 200;

/** Context lines kept around the issue when a long document is cut to an excerpt. */
const LONG_DOC_CONTEXT_LINES = 20;
const LONG_DOC_MAX_EXCERPT_LINES = 120;

export type FixInput =
	| { mode: 'full'; doc: string }
	| {
			mode: 'excerpt';
			doc: string;
			/** Raw lines [startLine, endLine) of `doc`, original indentation kept. */
			excerpt: string;
			startLine: number;
			endLine: number;
			totalLines: number;
	  };

/**
 * Decide what the model sees for a single-issue fix. Short documents go in full; long ones are cut
 * to the lines around the issue, and the model returns only those lines (see spliceFixedExcerpt).
 */
export function buildFixInput(userYaml: string, fieldPath?: string): FixInput {
	const doc = userYaml.trim();
	const lines = doc.split('\n');
	if (lines.length <= FULL_DOC_LINE_LIMIT || !fieldPath) return { mode: 'full', doc };

	const window = extractYamlIssueExcerpt(
		doc,
		fieldPath,
		LONG_DOC_CONTEXT_LINES,
		LONG_DOC_MAX_EXCERPT_LINES
	);
	if (window.isFullDocument || window.startLine === undefined || window.endLine === undefined) {
		return { mode: 'full', doc };
	}

	return {
		mode: 'excerpt',
		doc,
		excerpt: lines.slice(window.startLine, window.endLine).join('\n'),
		startLine: window.startLine,
		endLine: window.endLine,
		totalLines: lines.length
	};
}

/** Put the model's corrected excerpt back in place of the original lines. */
export function spliceFixedExcerpt(
	input: Extract<FixInput, { mode: 'excerpt' }>,
	fixedExcerpt: string
): string {
	const lines = input.doc.split('\n');
	const replacement = fixedExcerpt.replace(/\s+$/, '').split('\n');
	return [...lines.slice(0, input.startLine), ...replacement, ...lines.slice(input.endLine)].join(
		'\n'
	);
}
