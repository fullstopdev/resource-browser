function lineIndent(line: string): number {
	return line.match(/^(\s*)/)?.[1]?.length ?? 0;
}

function lineKey(line: string): string | null {
	const match = line.match(/^\s*(["']?)([^"':\s]+)\1\s*:/);
	return match?.[2] ?? null;
}

function parseFieldPathSegments(fieldPath: string): string[] {
	const segments: string[] = [];
	for (const part of fieldPath.replace(/^\//, '').split('.')) {
		if (!part) continue;
		const arrayMatch = part.match(/^([^[]+)(?:\[\d+\])?$/);
		if (arrayMatch?.[1]) segments.push(arrayMatch[1]);
	}
	return segments;
}

/**
 * Find the document line for a dotted YAML field path (e.g. spec.spines.systemPoolIPV6).
 * Walks nested keys by indentation so duplicate key names at different paths resolve correctly.
 */
export function findLineForYamlFieldPath(docText: string, fieldPath: string): number | undefined {
	const segments = parseFieldPathSegments(fieldPath);
	if (segments.length === 0) return undefined;

	const lines = docText.split('\n');
	let searchFrom = 0;
	let parentIndent = -1;
	let foundLine: number | undefined;

	for (const segment of segments) {
		let matchLine: number | undefined;
		const segmentLower = segment.toLowerCase();

		let minChildIndent = Number.POSITIVE_INFINITY;
		if (parentIndent >= 0) {
			for (let i = searchFrom; i < lines.length; i++) {
				const line = lines[i];
				if (!line.trim() || line.trim().startsWith('#')) continue;

				const indent = lineIndent(line);
				if (indent <= parentIndent) break;
				if (indent < minChildIndent) minChildIndent = indent;
			}
			if (!Number.isFinite(minChildIndent)) return undefined;
		}

		for (let i = searchFrom; i < lines.length; i++) {
			const line = lines[i];
			if (!line.trim() || line.trim().startsWith('#')) continue;

			const indent = lineIndent(line);
			if (parentIndent >= 0 && indent <= parentIndent && i > searchFrom) break;

			const key = lineKey(line);
			if (!key || key.toLowerCase() !== segmentLower) continue;
			if (parentIndent >= 0 && indent !== minChildIndent) continue;

			matchLine = i;
			parentIndent = indent;
			searchFrom = i + 1;
			break;
		}

		if (matchLine === undefined) return undefined;
		foundLine = matchLine;
	}

	return foundLine;
}
