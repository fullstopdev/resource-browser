import { describe, expect, it } from 'vitest';
import {
	buildAdjacencyLists,
	extractDirectSubgraph,
	extractSubgraph,
	getAllAncestors,
	getAllDescendants,
	getHighlightSets,
	getTransitiveClosureNodeIds
} from './transitiveClosure';
import type { GraphLink } from './types';

function link(source: string, target: string): GraphLink {
	return { id: `${source}|${target}|references`, source, target, rel: 'references' };
}

function node(id: string) {
	return {
		id,
		kind: id.toUpperCase(),
		group: 'g',
		type: 'config' as const,
		version: 'v1',
		shortName: id
	};
}

describe('transitiveClosure', () => {
	it('traverses multi-hop outgoing and incoming chains', () => {
		const links = [link('a', 'b'), link('b', 'c'), link('d', 'a')];
		const adj = buildAdjacencyLists(links);

		expect([...getAllDescendants('a', adj.outgoing)]).toEqual(['b', 'c']);
		expect([...getAllAncestors('a', adj.incoming)]).toEqual(['d']);
	});

	it('extended mode includes full transitive closure', () => {
		const links = [link('a', 'b'), link('b', 'c'), link('d', 'a')];
		const highlight = getHighlightSets('a', links, 'extended');

		expect([...highlight.nodes].sort()).toEqual(['a', 'b', 'c', 'd']);
		expect(highlight.directOutgoing.size).toBe(1);
		expect(highlight.descendants.size).toBe(2);
		expect(highlight.directIncoming.size).toBe(1);
		expect(highlight.ancestors.size).toBe(1);
	});

	it('direct mode stays at level 1', () => {
		const links = [link('a', 'b'), link('b', 'c'), link('d', 'a')];
		const highlight = getHighlightSets('a', links, 'direct');

		expect([...highlight.nodes].sort()).toEqual(['a', 'b', 'd']);
	});

	it('normalizes D3-style object link endpoints', () => {
		const links = [
			{ ...link('a', 'b'), source: { id: 'a' }, target: { id: 'b' } },
			{ ...link('b', 'c'), source: { id: 'b' }, target: { id: 'c' } }
		] as Parameters<typeof getHighlightSets>[1];
		const highlight = getHighlightSets('a', links, 'extended');

		expect([...highlight.nodes].sort()).toEqual(['a', 'b', 'c']);
	});

	it('extractDirectSubgraph keeps only one-hop neighbors and focus-incident edges', () => {
		const links = [link('a', 'b'), link('b', 'c'), link('d', 'a'), link('x', 'y'), link('b', 'd')];
		const graph = {
			nodes: ['a', 'b', 'c', 'd', 'x', 'y'].map(node),
			links,
			releaseFolder: '26.4.2',
			generatedAt: '2026-01-01T00:00:00.000Z'
		};

		const subgraph = extractDirectSubgraph(graph, 'a');
		expect(subgraph).not.toBeNull();
		expect([...subgraph!.nodes.map((n) => n.id)].sort()).toEqual(['a', 'b', 'd']);
		expect(subgraph!.links.map((l) => `${l.source}|${l.target}`).sort()).toEqual(['a|b', 'd|a']);
	});

	it('extractSubgraph direct mode matches extractDirectSubgraph', () => {
		const links = [link('a', 'b'), link('b', 'c'), link('d', 'a')];
		const graph = {
			nodes: ['a', 'b', 'c', 'd'].map(node),
			links,
			releaseFolder: '26.4.2',
			generatedAt: '2026-01-01T00:00:00.000Z'
		};

		const direct = extractSubgraph(graph, 'a', { transitive: false });
		expect(direct).not.toBeNull();
		expect([...direct!.nodes.map((n) => n.id)].sort()).toEqual(['a', 'b', 'd']);
		expect(direct!.links).toHaveLength(2);
	});

	it('extractSubgraph extended mode returns full transitive subgraph', () => {
		const links = [
			link('a', 'b'),
			link('b', 'c'),
			link('c', 'd'),
			link('d', 'e'),
			link('up', 'a')
		];
		const graph = {
			nodes: ['a', 'b', 'c', 'd', 'e', 'up'].map(node),
			links,
			releaseFolder: '26.4.2',
			generatedAt: '2026-01-01T00:00:00.000Z'
		};

		const subgraph = extractSubgraph(graph, 'a', { transitive: true });
		expect(subgraph).not.toBeNull();
		expect([...subgraph!.nodes.map((n) => n.id)].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'up']);
		expect(subgraph!.links.map((l) => `${l.source}|${l.target}`).sort()).toEqual([
			'a|b',
			'b|c',
			'c|d',
			'd|e',
			'up|a'
		]);
	});

	it('getTransitiveClosureNodeIds includes all reachable nodes', () => {
		const links = [link('a', 'b'), link('b', 'c'), link('c', 'd')];
		const ids = getTransitiveClosureNodeIds('a', links);
		expect([...ids].sort()).toEqual(['a', 'b', 'c', 'd']);
	});

	it('getAllDescendants stops at maxDepth when provided', () => {
		const links = [link('a', 'b'), link('b', 'c'), link('c', 'd')];
		const adj = buildAdjacencyLists(links);
		expect([...getAllDescendants('a', adj.outgoing, undefined, 2)].sort()).toEqual(['b', 'c']);
	});
});
