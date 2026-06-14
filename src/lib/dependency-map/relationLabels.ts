import type { EdgeClass, LinkRelation } from './types';

/** Where a relation or direction label is shown in the Map UI. */
export type RelationDisplayContext = 'legend' | 'toolbar' | 'inspect';

/** Focus-relative edge direction (not a LinkRelation). */
export type TopologyDirection = 'dependsOn' | 'requiredBy';

type ContextLabels = Record<RelationDisplayContext, string>;

/** Intent-focused display copy per relation and surface. Internal `rel` values unchanged. */
const RELATION_DISPLAY: Record<LinkRelation, ContextLabels> = {
	references: { legend: 'References schema', toolbar: 'Schema reference', inspect: 'Schema reference' },
	observes: { legend: 'Watches', toolbar: 'Watches state', inspect: 'Watches state' },
	orchestrates: { legend: 'Controls', toolbar: 'Controls', inspect: 'Controls' },
	bindsTo: { legend: 'Binds', toolbar: 'Binds to', inspect: 'Binds to' },
	extends: { legend: 'Extends', toolbar: 'Extends', inspect: 'Extends' },
	appliesTo: { legend: 'Used by', toolbar: 'Used by', inspect: 'Used by' },
	deploys: { legend: 'Deploys', toolbar: 'Deploys', inspect: 'Deploys' },
	member: { legend: 'Member', toolbar: 'Member', inspect: 'Member' },
	memberOf: { legend: 'In group', toolbar: 'Member of', inspect: 'Member of' }
};

const DIRECTION_DISPLAY: Record<TopologyDirection, ContextLabels> = {
	dependsOn: { legend: 'needs', toolbar: 'Uses upstream', inspect: 'Uses upstream' },
	requiredBy: { legend: 'consumers', toolbar: 'Consumers', inspect: 'Consumers' }
};

export function relationDisplayLabel(
	rel: LinkRelation,
	context: RelationDisplayContext = 'inspect'
): string {
	return RELATION_DISPLAY[rel]?.[context] ?? rel;
}

export function directionDisplayLabel(
	direction: TopologyDirection,
	context: RelationDisplayContext = 'toolbar'
): string {
	return DIRECTION_DISPLAY[direction][context];
}

/** @deprecated Use relationDisplayLabel(rel, 'inspect') */
export const REL_LABELS: Record<LinkRelation, string> = Object.fromEntries(
	(Object.keys(RELATION_DISPLAY) as LinkRelation[]).map((rel) => [
		rel,
		relationDisplayLabel(rel, 'inspect')
	])
) as Record<LinkRelation, string>;

/** Short legend tooltip descriptions keyed by relation. */
export const REL_DESCRIPTIONS: Partial<Record<LinkRelation, string>> = {
	references: 'OpenAPI field or annotation points to another CRD',
	observes: 'Monitors or reads state from another resource',
	orchestrates: 'Controls or coordinates another resource',
	bindsTo: 'Binds configuration to a target resource',
	extends: 'Extends or inherits from another resource',
	appliesTo: 'Consumer resource attaches or applies this policy',
	deploys: 'Deploys or provisions another resource',
	member: 'Aggregate member resource',
	memberOf: 'Part of an aggregate'
};

export const EDGE_CLASS_LABELS: Record<EdgeClass, string> = {
	hardRef: 'Schema field link',
	intentDependency: 'Intent link'
};

export const LEGEND_TITLE = 'Relationships';

export const MAP_ROLE_LABELS: Record<'focus' | 'prerequisite' | 'dependent', string> = {
	focus: 'Focus',
	prerequisite: 'Upstream',
	dependent: 'Consumer'
};

/** @deprecated Use directionDisplayLabel(direction, context) */
export const MAP_DIRECTION = {
	uses: {
		label: directionDisplayLabel('dependsOn', 'toolbar'),
		shortLabel: directionDisplayLabel('dependsOn', 'toolbar'),
		statLabel: directionDisplayLabel('dependsOn', 'legend'),
		sectionTitle: directionDisplayLabel('dependsOn', 'inspect'),
		title: 'Show CRDs the focus uses or needs upstream (right column)'
	},
	usedBy: {
		label: directionDisplayLabel('requiredBy', 'toolbar'),
		shortLabel: directionDisplayLabel('requiredBy', 'toolbar'),
		statLabel: directionDisplayLabel('requiredBy', 'legend'),
		sectionTitle: directionDisplayLabel('requiredBy', 'inspect'),
		title: 'Show CRDs that consume or depend on the focus (left column)'
	}
} as const;

export function getRelationLabel(rel: LinkRelation | 'related' | undefined): string {
	if (!rel || rel === 'related') return 'Related';
	return relationDisplayLabel(rel, 'inspect');
}

export function getRelationDescription(rel: LinkRelation): string | undefined {
	return REL_DESCRIPTIONS[rel];
}

export function getEdgeClassLabel(edgeClass: EdgeClass | undefined): string | undefined {
	if (!edgeClass) return undefined;
	return EDGE_CLASS_LABELS[edgeClass];
}
