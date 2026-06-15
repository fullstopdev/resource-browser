import type { DependencyGraph } from '$lib/dependency-map/types';
import { trimToBudget } from '$lib/ai/tokenBudget';

const EDGE_LINE_RE = /^- \*\*/;

/** Format the full release dependency graph as LLM-readable markdown (deterministic, no neurons). */
export function formatDependencyMapForKv(graph: DependencyGraph, release: string): string {
	const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
	const links = graph.links.filter((l) => (l.confidenceTier ?? 1) <= 2);

	const lines = [
		`## EDA release dependency map — ${release} (KV)`,
		`${graph.nodes.length} CRDs, ${links.length} dependency edges (confidence tier 1–2)`,
		'',
		'### Dependency edges (source → target)',
		''
	];

	const sorted = [...links].sort((a, b) => {
		const sk = nodeById.get(a.source)?.kind ?? a.source;
		const tk = nodeById.get(a.target)?.kind ?? b.target;
		return `${sk}:${tk}`.localeCompare(`${sk}:${tk}`);
	});

	for (const link of sorted) {
		const src = nodeById.get(link.source);
		const tgt = nodeById.get(link.target);
		const srcLabel = src ? `${src.kind} (${src.group})` : link.source;
		const tgtLabel = tgt ? `${tgt.kind} (${tgt.group})` : link.target;
		const field = link.field || link.fieldPaths?.[0];
		const fieldPart = field ? ` via \`${field}\`` : '';
		lines.push(`- **${srcLabel}** —${link.rel}→ **${tgtLabel}**${fieldPart}`);
	}

	return lines.join('\n');
}

function kindMarker(kind: string): string {
	return `**${kind} (`;
}

/** Slice the release map to edges relevant to resolved targets (1-hop neighborhood). */
export function sliceDependencyMapForTargets(
	fullMap: string,
	targets: Array<{ kind: string }>,
	maxChars: number
): string {
	if (!fullMap.trim() || maxChars <= 0) return '';

	const lines = fullMap.split('\n');
	const header: string[] = [];
	const edgeLines: string[] = [];

	for (const line of lines) {
		if (EDGE_LINE_RE.test(line)) edgeLines.push(line);
		else header.push(line);
	}

	const headerText = header.join('\n');
	const kinds = [...new Set(targets.map((t) => t.kind).filter(Boolean))];
	let bodyLines: string[];

	if (!kinds.length) {
		bodyLines = edgeLines;
	} else {
		const primary = edgeLines.filter((line) => kinds.some((k) => line.includes(kindMarker(k))));
		bodyLines = primary.length ? primary : edgeLines;
	}

	let combined = [headerText, '', ...bodyLines].filter(Boolean).join('\n');

	if (bodyLines.length && bodyLines.length < edgeLines.length && kinds.length) {
		const note = `_Showing ${bodyLines.length} of ${edgeLines.length} release dependency edges focused on: ${kinds.join(', ')}._`;
		combined = `${combined}\n\n${note}`;
	}

	return trimToBudget(combined, maxChars);
}
