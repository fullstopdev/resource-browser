import { buildTransitiveDepList } from './transitiveClosure';
import { getGraphPalette, REL_ORDER } from './graphColors';
import { getRelationLabel, MAP_DIRECTION } from './relationLabels';
import type { ThemeMode } from '$lib/theme';
import type { TransitiveDepEntry } from './transitiveClosure';
import type { DependencyGraph, GraphLink, GraphNode, LinkRelation } from './types';

/**
 * Operational catalog pairings and structural noise — not useful for intent/schema topology.
 * deploys/appliesTo: deployment & policy-attachment heuristics; member*: aggregate nesting.
 */
const EXCLUDED_INTENT_TOPOLOGY_RELATIONS = new Set<LinkRelation>([
	'deploys',
	'appliesTo',
	'member',
	'memberOf'
]);

/** Cross-CRD relations shown on Map topology (max ~5 legend entries). */
export function isSchemaIntentRelation(rel: LinkRelation): boolean {
	return !EXCLUDED_INTENT_TOPOLOGY_RELATIONS.has(rel);
}

function isIntentEvidenceLink(link: GraphLink): boolean {
	if (link.edgeClasses?.length && !link.edgeClasses.includes('intentDependency')) {
		return false;
	}
	return (
		link.edgeClass === 'intentDependency' ||
		link.edgeSource === 'catalog' ||
		link.edgeSource === 'semantic' ||
		link.edgeSource === 'explicit'
	);
}

/** Catalog / semantic / explicit intent edges for Map topology (excludes hardRef). */
export function isIntentDependencyLink(link: GraphLink): boolean {
	if (link.edgeClass === 'hardRef') return false;
	if (!isSchemaIntentRelation(link.rel)) return false;
	return isIntentEvidenceLink(link);
}

/** Schema + intent edges on the Map canvas — hardRef field refs plus filtered intent deps. */
export function isMapTopologyLink(link: GraphLink): boolean {
	if (!isSchemaIntentRelation(link.rel)) return false;
	if (link.edgeClass === 'hardRef') return true;
	return isIntentDependencyLink(link);
}

/** appliesTo edges shown on Map topology (consumer attaches or references a policy). */
export function isMapTopologyAppliesToLink(link: GraphLink): boolean {
	if (link.rel !== 'appliesTo') return false;
	return link.edgeClass === 'hardRef' || isIntentEvidenceLink(link);
}

/**
 * Links for depends-on (right column when focus is consumer): map topology plus outgoing appliesTo.
 * deploys/member* stay excluded; appliesTo surfaces policies the focus attaches or references.
 */
export function isMapTopologyDependsOnLink(link: GraphLink): boolean {
	if (isMapTopologyAppliesToLink(link)) return true;
	return isMapTopologyLink(link);
}

/** Links passed to intent topology layout (depends-on + required-by including appliesTo). */
export function isTopologyLayoutLink(link: GraphLink): boolean {
	return isMapTopologyDependsOnLink(link) || isMapTopologyRequiredByLink(link);
}

/**
 * Links for required-by (left column when focus is policy): map topology plus incoming appliesTo.
 * deploys/member* stay excluded; appliesTo surfaces who attaches or depends on a policy.
 */
export function isMapTopologyRequiredByLink(link: GraphLink): boolean {
	if (isMapTopologyAppliesToLink(link)) return true;
	return isMapTopologyLink(link);
}

function nodeLabel(graph: DependencyGraph, id: string): string {
	const node = graph.nodes.find((n) => n.id === id);
	return node?.kind ?? node?.shortName ?? id.split('.')[0];
}

function relLabel(rel?: LinkRelation | 'related'): string {
	return getRelationLabel(rel);
}

function escapeMd(text: string): string {
	return text.replace(/[[\]#*`_]/g, '\\$&');
}

function matchesSearch(
	graph: DependencyGraph,
	dep: TransitiveDepEntry,
	query: string
): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	const node = graph.nodes.find((n) => n.id === dep.id);
	const haystack = `${nodeLabel(graph, dep.id)} ${node?.group ?? ''} ${dep.field ?? ''} ${dep.reason ?? ''}`.toLowerCase();
	return haystack.includes(q);
}

function detailLine(dep: TransitiveDepEntry): string {
	const parts: string[] = [];
	if (dep.field) parts.push(`\`${dep.field}\``);
	if (dep.reason) parts.push(dep.reason.slice(0, 120));
	return parts.join(' · ');
}

function groupDepsByRel(
	deps: TransitiveDepEntry[]
): Array<[LinkRelation | 'related', TransitiveDepEntry[]]> {
	const grouped = new Map<LinkRelation | 'related', TransitiveDepEntry[]>();
	for (const dep of deps) {
		const rel = dep.rel ?? 'related';
		const list = grouped.get(rel) ?? [];
		list.push(dep);
		grouped.set(rel, list);
	}
	const order = [...REL_ORDER, 'related' as const];
	return order.filter((rel) => grouped.has(rel)).map((rel) => [rel, grouped.get(rel)!]);
}

function sectionMarkdown(
	graph: DependencyGraph,
	title: string,
	deps: TransitiveDepEntry[],
	depSearch: string
): string {
	const filtered = deps.filter((d) => matchesSearch(graph, d, depSearch));
	if (filtered.length === 0) return '';

	const lines: string[] = [`- **${title}** (${filtered.length})`];

	for (const [rel, group] of groupDepsByRel(filtered)) {
		lines.push(`  - **${relLabel(rel)}** (${group.length})`);
		for (const dep of group) {
			const label = nodeLabel(graph, dep.id);
			const depthNote = dep.depth > 1 ? ` _(hop ${dep.depth})_` : '';
			lines.push(`    - ${escapeMd(label)}${depthNote}`);
			const detail = detailLine(dep);
			if (detail) lines.push(`      - ${detail}`);
		}
	}
	return lines.join('\n');
}

function markmapColorList(themeMode: ThemeMode = 'light'): string[] {
	const palette = getGraphPalette(themeMode);
	const colors = [
		palette.chipActive,
		palette.linkOut,
		palette.linkIn,
		...REL_ORDER.map((rel) => palette.rel[rel])
	];
	return [...new Set(colors)];
}

function buildFrontmatter(themeMode: ThemeMode = 'light'): string {
	const colors = markmapColorList(themeMode);
	const lines = [
		'---',
		'markmap:',
		`  color: [${colors.map((c) => `'${c}'`).join(', ')}]`,
		'  initialExpandLevel: 2',
		'  paddingX: 14',
		'  spacingVertical: 10',
		'  spacingHorizontal: 96',
		'  maxWidth: 300',
		'  nodeMinHeight: 18',
		'---'
	];
	return lines.join('\n');
}

export type MarkmapMarkdownOptions = {
	depSearch?: string;
	showDependsOn?: boolean;
	showRequiredBy?: boolean;
	themeMode?: ThemeMode;
};

export type IntentMarkmapStats = {
	dependsOn: number;
	requiredBy: number;
	total: number;
	filteredDependsOn: number;
	filteredRequiredBy: number;
	hasData: boolean;
};

export function getIntentMarkmapStats(
	graph: DependencyGraph,
	focusNodeId: string,
	options: MarkmapMarkdownOptions = {}
): IntentMarkmapStats {
	const {
		depSearch = '',
		showDependsOn = true,
		showRequiredBy = true
	} = options;

	const intentLinks = graph.links.filter(isIntentDependencyLink);
	const dependsOn = showDependsOn
		? buildTransitiveDepList(focusNodeId, intentLinks, 'outgoing')
		: [];
	const requiredBy = showRequiredBy
		? buildTransitiveDepList(focusNodeId, intentLinks, 'incoming')
		: [];

	const filteredDependsOn = dependsOn.filter((d) => matchesSearch(graph, d, depSearch));
	const filteredRequiredBy = requiredBy.filter((d) => matchesSearch(graph, d, depSearch));

	return {
		dependsOn: dependsOn.length,
		requiredBy: requiredBy.length,
		total: dependsOn.length + requiredBy.length,
		filteredDependsOn: filteredDependsOn.length,
		filteredRequiredBy: filteredRequiredBy.length,
		hasData: filteredDependsOn.length + filteredRequiredBy.length > 0
	};
}

/** Build markdown outline for markmap from intent-dependency edges only. */
export function buildIntentMarkmapMarkdown(
	graph: DependencyGraph,
	focusNodeId: string,
	options: MarkmapMarkdownOptions = {}
): string {
	const {
		depSearch = '',
		showDependsOn = true,
		showRequiredBy = true,
		themeMode = 'light'
	} = options;

	const intentLinks = graph.links.filter(isIntentDependencyLink);
	const focusLabel = nodeLabel(graph, focusNodeId);
	const focusNode = graph.nodes.find((n) => n.id === focusNodeId);

	const dependsOn = showDependsOn
		? buildTransitiveDepList(focusNodeId, intentLinks, 'outgoing')
		: [];
	const requiredBy = showRequiredBy
		? buildTransitiveDepList(focusNodeId, intentLinks, 'incoming')
		: [];

	const sections = [
		sectionMarkdown(graph, MAP_DIRECTION.uses.sectionTitle, dependsOn, depSearch),
		sectionMarkdown(graph, MAP_DIRECTION.usedBy.sectionTitle, requiredBy, depSearch)
	].filter(Boolean);

	const body =
		sections.length === 0
			? [
					'- **No intent dependencies**',
					'  - Adjust filters or pick another CRD with catalog / semantic edges'
				].join('\n')
			: sections.join('\n');

	const header = [
		buildFrontmatter(themeMode),
		`# ${escapeMd(focusLabel)}`,
		focusNode?.group ? `_${focusNode.group}_` : '',
		'',
		body
	].filter(Boolean);

	return header.join('\n');
}

export function focusNodeFor(graph: DependencyGraph, focusNodeId: string): GraphNode | undefined {
	return graph.nodes.find((n) => n.id === focusNodeId);
}
