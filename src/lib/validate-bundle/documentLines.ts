/** 1-based document index → first line number in the bundle YAML. */
export function bundleDocumentStartLine(yamlInput: string, docIndex: number): number {
	if (docIndex < 1) return 1;

	const lines = yamlInput.split('\n');
	const starts = [1];

	for (let i = 0; i < lines.length; i++) {
		if (/^---\s*$/.test(lines[i]!) && i > 0) {
			starts.push(i + 1);
		}
	}

	return starts[docIndex - 1] ?? starts[starts.length - 1] ?? 1;
}
