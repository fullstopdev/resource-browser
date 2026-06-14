import { linkEndpointId } from './transitiveClosure';
import type { EdgeClass, GraphLink, LinkRelation } from './types';

const REL_PRIORITY: Record<LinkRelation, number> = {
	observes: 100,
	deploys: 100,
	orchestrates: 90,
	extends: 85,
	bindsTo: 80,
	appliesTo: 78,
	member: 70,
	memberOf: 70,
	references: 60
};

function visualEdgeKey(source: string, target: string): string {
	return `${source}|${target}`;
}

function relPriority(rel: LinkRelation): number {
	return REL_PRIORITY[rel] ?? 0;
}

function pickRepresentativeLink(links: GraphLink[]): GraphLink {
	return links.reduce((best, link) => {
		const bestRel = relPriority(best.rel);
		const linkRel = relPriority(link.rel);
		if (linkRel !== bestRel) return linkRel > bestRel ? link : best;

		const bestTier = best.confidenceTier ?? 3;
		const linkTier = link.confidenceTier ?? 3;
		if (linkTier !== bestTier) return linkTier < bestTier ? link : best;

		const bestConf = best.confidence ?? 0;
		const linkConf = link.confidence ?? 0;
		return linkConf > bestConf ? link : best;
	});
}

function uniqueStrings(values: Array<string | undefined>): string[] {
	return [...new Set(values.filter((v): v is string => Boolean(v)))];
}

/**
 * Collapse multiple inference edges with the same source→target into one visual edge.
 * Full edge detail is preserved in fieldPaths/reasons for tooltips and inspection.
 */
export function collapseVisualLinks(links: GraphLink[]): GraphLink[] {
	const groups = new Map<string, GraphLink[]>();

	for (const link of links) {
		const source = linkEndpointId(link.source);
		const target = linkEndpointId(link.target);
		const key = visualEdgeKey(source, target);
		const group = groups.get(key);
		if (group) group.push(link);
		else groups.set(key, [link]);
	}

	return [...groups.values()].map((group) => {
		if (group.length === 1) return group[0]!;

		const source = linkEndpointId(group[0]!.source);
		const target = linkEndpointId(group[0]!.target);
		const representative = pickRepresentativeLink(group);
		const fieldPaths = uniqueStrings(group.flatMap((link) => link.fieldPaths ?? [link.field]));
		const reasons = uniqueStrings(group.flatMap((link) => link.reasons ?? [link.reason]));
		const relations = [...new Set(group.map((link) => link.rel))];
		const apiVersions = uniqueStrings(group.flatMap((link) => link.apiVersions ?? []));
		const resolvedCandidates = uniqueStrings(group.flatMap((link) => link.resolvedCandidates ?? []));
		const edgeClasses = [...new Set(group.map((link) => link.edgeClass).filter(Boolean))] as EdgeClass[];

		return {
			...representative,
			id: `visual:${visualEdgeKey(source, target)}`,
			source,
			target,
			field: fieldPaths[0] ?? representative.field,
			fieldPaths,
			reasons,
			relations: relations.length > 1 ? relations : undefined,
			edgeClasses: edgeClasses.length > 1 ? edgeClasses : undefined,
			edgeClass: edgeClasses.length === 1 ? edgeClasses[0] : representative.edgeClass,
			apiVersions: apiVersions.length > 0 ? apiVersions : representative.apiVersions,
			resolvedCandidates:
				resolvedCandidates.length > 0 ? resolvedCandidates : representative.resolvedCandidates,
			refCount: group.length
		};
	});
}
