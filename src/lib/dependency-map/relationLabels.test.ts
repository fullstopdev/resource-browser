import { describe, expect, it } from 'vitest';
import {
	directionDisplayLabel,
	getEdgeClassLabel,
	getRelationDescription,
	getRelationLabel,
	LEGEND_TITLE,
	MAP_DIRECTION,
	MAP_ROLE_LABELS,
	REL_LABELS,
	relationDisplayLabel
} from './relationLabels';
import type { LinkRelation } from './types';

const ALL_RELATIONS: LinkRelation[] = [
	'orchestrates',
	'observes',
	'deploys',
	'references',
	'member',
	'memberOf',
	'bindsTo',
	'appliesTo',
	'extends'
];

describe('relationDisplayLabel', () => {
	it('returns concise legend labels (1–2 words)', () => {
		expect(relationDisplayLabel('references', 'legend')).toBe('References schema');
		expect(relationDisplayLabel('observes', 'legend')).toBe('Watches');
		expect(relationDisplayLabel('orchestrates', 'legend')).toBe('Controls');
		expect(relationDisplayLabel('bindsTo', 'legend')).toBe('Binds');
		expect(relationDisplayLabel('extends', 'legend')).toBe('Extends');
		expect(relationDisplayLabel('appliesTo', 'legend')).toBe('Used by');
	});

	it('returns longer inspect labels where semantics need clarity', () => {
		expect(relationDisplayLabel('references', 'inspect')).toBe('Schema reference');
		expect(relationDisplayLabel('observes', 'inspect')).toBe('Watches state');
		expect(relationDisplayLabel('appliesTo', 'inspect')).toBe('Used by');
	});

	it('covers every LinkRelation', () => {
		for (const rel of ALL_RELATIONS) {
			expect(relationDisplayLabel(rel, 'legend').length).toBeGreaterThan(0);
			expect(relationDisplayLabel(rel, 'inspect').length).toBeGreaterThan(0);
		}
	});
});

describe('directionDisplayLabel', () => {
	it('maps focus-relative directions to intent wording', () => {
		expect(directionDisplayLabel('dependsOn', 'toolbar')).toBe('Uses upstream');
		expect(directionDisplayLabel('requiredBy', 'toolbar')).toBe('Consumers');
		expect(directionDisplayLabel('dependsOn', 'legend')).toBe('needs');
		expect(directionDisplayLabel('requiredBy', 'legend')).toBe('consumers');
	});
});

describe('relationLabels helpers', () => {
	it('REL_LABELS mirrors inspect context', () => {
		expect(REL_LABELS.references).toBe('Schema reference');
		expect(REL_LABELS.observes).toBe('Watches state');
		expect(REL_LABELS.orchestrates).toBe('Controls');
	});

	it('getRelationLabel handles related and inspect context', () => {
		expect(getRelationLabel(undefined)).toBe('Related');
		expect(getRelationLabel('related')).toBe('Related');
		expect(getRelationLabel('references')).toBe('Schema reference');
	});

	it('getRelationDescription returns legend copy for map relations', () => {
		expect(getRelationDescription('references')).toContain('OpenAPI');
		expect(getRelationDescription('orchestrates')).toBeTruthy();
	});

	it('getEdgeClassLabel maps hardRef evidence class', () => {
		expect(getEdgeClassLabel('hardRef')).toBe('Schema field link');
		expect(getEdgeClassLabel(undefined)).toBeUndefined();
	});

	it('MAP_DIRECTION derives from directionDisplayLabel', () => {
		expect(MAP_DIRECTION.uses.label).toBe('Uses upstream');
		expect(MAP_DIRECTION.usedBy.label).toBe('Consumers');
		expect(MAP_DIRECTION.uses.statLabel).toBe('needs');
		expect(MAP_DIRECTION.usedBy.statLabel).toBe('consumers');
	});

	it('MAP_ROLE_LABELS use Kubedeck-style column roles', () => {
		expect(MAP_ROLE_LABELS.dependent).toBe('Consumer');
		expect(MAP_ROLE_LABELS.prerequisite).toBe('Upstream');
		expect(MAP_ROLE_LABELS.focus).toBe('Focus');
	});

	it('LEGEND_TITLE is Relationships', () => {
		expect(LEGEND_TITLE).toBe('Relationships');
	});
});
