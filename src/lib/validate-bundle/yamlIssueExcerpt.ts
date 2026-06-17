import { findLineForYamlFieldPath } from '$lib/yaml-validation/yamlFieldPath';

const DEFAULT_CONTEXT_LINES = 8;
const MAX_EXCERPT_LINES = 28;

/**
 * Extract a YAML excerpt around an issue field for compact AI prompts.
 * Falls back to the full document when the field cannot be located.
 */
export function extractYamlIssueExcerpt(
	docYaml: string,
	fieldPath?: string,
	contextLines = DEFAULT_CONTEXT_LINES
): { excerpt: string; isFullDocument: boolean } {
	const trimmed = docYaml.trim();
	if (!trimmed || !fieldPath) {
		return { excerpt: trimmed, isFullDocument: true };
	}

	const relLine = findLineForYamlFieldPath(trimmed, fieldPath);
	if (relLine === undefined) {
		return { excerpt: trimmed, isFullDocument: true };
	}

	const lines = trimmed.split('\n');
	const start = Math.max(0, relLine - contextLines);
	const end = Math.min(lines.length, relLine + contextLines + 1);
	const excerptLines = lines.slice(start, end);

	if (excerptLines.length >= lines.length) {
		return { excerpt: trimmed, isFullDocument: true };
	}

	const header =
		start > 0 || end < lines.length
			? `# Excerpt around ${fieldPath} (lines ${start + 1}-${end}); apply fix to the full document`
			: undefined;

	const excerpt = header
		? `${header}\n${excerptLines.join('\n')}`
		: excerptLines.join('\n');

	if (excerptLines.length > MAX_EXCERPT_LINES) {
		return { excerpt: trimmed, isFullDocument: true };
	}

	return { excerpt, isFullDocument: false };
}
