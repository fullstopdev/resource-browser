import { describe, expect, it } from 'vitest';
import {
	applyDirectionFilter,
	applyEdgeSourceFilter,
	applyIntentTierFilter,
	getDirectNeighborIds
} from './graphFilters';
import type { GraphLink, GraphNode } from './types';

function node(id: string): GraphNode {
	return {
		id,
		kind: id,
		group: 'g',
		type: 'config',
		version: 'v1',
		shortName: id
	};
}

function edge(
	source: string,
	target: string,
	edgeSource: GraphLink['edgeSource'] = 'explicit',
	confidenceTier?: GraphLink['confidenceTier']
): GraphLink {
	return { id: `${source}|${target}`, source, target, rel: 'references', edgeSource, confidenceTier };
}

describe('graphFilters', () => {
	const nodes = [node('focus'), node('up'), node('down'), node('other')];
	const links = [edge('focus', 'down'), edge('up', 'focus'), edge('up', 'other')];

	it('keeps all nodes when both directions enabled', () => {
		const result = applyDirectionFilter(nodes, links, 'focus', {
			showDependsOn: true,
			showRequiredBy: true
		});
		expect(result.nodes.map((n) => n.id).sort()).toEqual(['down', 'focus', 'other', 'up']);
		expect(result.links).toHaveLength(3);
	});

	it('filters to depends-on star when only outgoing enabled', () => {
		const result = applyDirectionFilter(nodes, links, 'focus', {
			showDependsOn: true,
			showRequiredBy: false
		});
		expect(result.nodes.map((n) => n.id).sort()).toEqual(['down', 'focus']);
		expect(result.links).toEqual([edge('focus', 'down')]);
	});

	it('filters to required-by star when only incoming enabled', () => {
		const result = applyDirectionFilter(nodes, links, 'focus', {
			showDependsOn: false,
			showRequiredBy: true
		});
		expect(result.nodes.map((n) => n.id).sort()).toEqual(['focus', 'up']);
		expect(result.links).toEqual([edge('up', 'focus')]);
	});

	it('returns direct neighbors of the focus node', () => {
		expect([...getDirectNeighborIds('focus', links)].sort()).toEqual(['down', 'up']);
		expect([...getDirectNeighborIds(null, links)]).toEqual([]);
		expect([...getDirectNeighborIds('other', links)]).toEqual(['up']);
	});

	it('shows all tiers by default and strict mode hides tier 3', () => {
		const mixed = [
			edge('a', 'b', 'explicit', 2),
			edge('a', 'c', 'inferred', 3),
			edge('a', 'd', 'catalog', 1)
		];
		expect(applyIntentTierFilter(mixed, true).map((l) => l.target).sort()).toEqual(['b', 'c', 'd']);
		expect(applyIntentTierFilter(mixed, undefined as unknown as boolean)).toHaveLength(3);
		expect(applyIntentTierFilter(mixed, false).map((l) => l.target).sort()).toEqual(['b', 'd']);
	});

	it('applyEdgeSourceFilter aliases tier filtering', () => {
		const mixed = [
			edge('a', 'b', 'explicit'),
			edge('a', 'c', 'inferred'),
			edge('a', 'd', 'catalog')
		];
		expect(applyEdgeSourceFilter(mixed, false).map((l) => l.target).sort()).toEqual(['b', 'd']);
		expect(applyEdgeSourceFilter(mixed, true)).toHaveLength(3);
	});
});
