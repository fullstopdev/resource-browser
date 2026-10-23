type LineInfo = {
	/** Leading spaces of the raw line. */
	raw: number;
	/** Column where the content starts (after `- ` for list item lines). */
	content: number;
	dash: boolean;
	key: string | null;
};

type Segment = { key: string } | { index: number };

function lineKey(text: string): string | null {
	const match = text.match(/^\s*(["']?)([^"':\s]+)\1\s*:/);
	return match?.[2] ?? null;
}

function describeLine(line: string): LineInfo | null {
	if (!line.trim() || line.trim().startsWith('#')) return null;
	const match = line.match(/^(\s*)(-\s+)?(.*)$/)!;
	const raw = match[1]!.length;
	const dash = Boolean(match[2]);
	return { raw, dash, content: raw + (match[2]?.length ?? 0), key: lineKey(match[3] ?? '') };
}

/** `spec.items[0].name`, `spec.items.0.name` and `/spec/items/0/name` → key/index segments. */
function parseFieldPathSegments(fieldPath: string): Segment[] {
	const segments: Segment[] = [];
	const normalized = fieldPath.replace(/^\//, '').replace(/\//g, '.');
	for (const part of normalized.split('.')) {
		if (!part) continue;
		if (/^\d+$/.test(part)) {
			segments.push({ index: Number(part) });
			continue;
		}
		const match = part.match(/^([^[]+)((?:\[\d+\])*)$/);
		if (!match?.[1]) continue;
		segments.push({ key: match[1] });
		for (const index of match[2]!.matchAll(/\[(\d+)\]/g)) {
			segments.push({ index: Number(index[1]) });
		}
	}
	return segments;
}

/**
 * Find the document line for a YAML field path (e.g. `spec.spines.systemPoolIPV6`,
 * `spec.overlays[0].enabled`). Walks nested keys and list items by indentation, so duplicate key
 * names at different paths resolve correctly. Keys written on a list item's `- ` line count as
 * the item's first field. Key matching is case-insensitive.
 */
export function findLineForYamlFieldPath(docText: string, fieldPath: string): number | undefined {
	const segments = parseFieldPathSegments(fieldPath);
	if (segments.length === 0) return undefined;

	const infos = docText.split('\n').map(describeLine);
	/** Line indices of the current node's descendants (the whole document at the root). */
	let scope = infos.flatMap((info, i) => (info ? [i] : []));
	let found: number | undefined;

	/** Lines under a key line: deeper lines, plus a compact list (`- `) at the key's own column. */
	const blockUnderKey = (line: number): number[] => {
		const { content } = infos[line]!;
		const out: number[] = [];
		for (let i = line + 1; i < infos.length; i++) {
			const info = infos[i];
			if (!info) continue;
			if (info.raw < content || (info.raw === content && !info.dash)) break;
			out.push(i);
		}
		return out;
	};

	/** A list item: its `- ` line plus the lines indented under it. */
	const blockOfItem = (line: number): number[] => {
		const { raw } = infos[line]!;
		const out = [line];
		for (let i = line + 1; i < infos.length; i++) {
			const info = infos[i];
			if (!info) continue;
			if (info.raw <= raw) break;
			out.push(i);
		}
		return out;
	};

	for (const segment of segments) {
		if (scope.length === 0) return undefined;

		if ('index' in segment) {
			const dashLines = scope.filter((i) => infos[i]!.dash);
			if (dashLines.length === 0) return undefined;
			const itemIndent = Math.min(...dashLines.map((i) => infos[i]!.raw));
			const item = dashLines.filter((i) => infos[i]!.raw === itemIndent)[segment.index];
			if (item === undefined) return undefined;
			found = item;
			scope = blockOfItem(item);
			continue;
		}

		const wanted = segment.key.toLowerCase();
		const level = Math.min(...scope.map((i) => infos[i]!.content));
		const match = scope.find((i) => {
			const info = infos[i]!;
			return info.content === level && info.key?.toLowerCase() === wanted;
		});
		if (match === undefined) return undefined;
		found = match;
		scope = blockUnderKey(match);
	}

	return found;
}
