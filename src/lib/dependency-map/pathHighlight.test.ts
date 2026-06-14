import type { Edge, Node } from '@xyflow/svelte';
import { describe, expect, it } from 'vitest';
import { isPathSegmentEdge, applyPathHighlightToFlow, flowHighlightsInSync } from './pathHighlight';

describe('pathHighlight', () => {
	it('detects edges between consecutive breadcrumb nodes (either direction)', () => {
		const path = [
			'policies.protocols.eda.nokia.com',
			'bgppeers.protocols.eda.nokia.com',
			'keychains.protocols.eda.nokia.com'
		];
		expect(
			isPathSegmentEdge(
				'policies.protocols.eda.nokia.com',
				'bgppeers.protocols.eda.nokia.com',
				path
			)
		).toBe(true);
		expect(
			isPathSegmentEdge(
				'bgppeers.protocols.eda.nokia.com',
				'keychains.protocols.eda.nokia.com',
				path
			)
		).toBe(true);
		expect(
			isPathSegmentEdge(
				'policies.protocols.eda.nokia.com',
				'keychains.protocols.eda.nokia.com',
				path
			)
		).toBe(false);
		expect(isPathSegmentEdge('fabric', 'keychain', path)).toBe(false);
	});

	it('returns false when path has fewer than two nodes', () => {
		expect(isPathSegmentEdge('a', 'b', ['a'])).toBe(false);
	});

	it('marks path edges and nodes, dims unrelated edges', () => {
		const nodes: Node[] = [
			{ id: 'a', data: { isFocus: false }, position: { x: 0, y: 0 } },
			{ id: 'b', data: { isFocus: true }, position: { x: 0, y: 0 } },
			{ id: 'c', data: { isFocus: false }, position: { x: 0, y: 0 } }
		];
		const edges: Edge[] = [
			{ id: 'ab', source: 'a', target: 'b', data: { color: '#000' } },
			{ id: 'bc', source: 'b', target: 'c', data: { color: '#000' } },
			{ id: 'ac', source: 'a', target: 'c', data: { color: '#000' } }
		];

		const { nodes: nextNodes, edges: nextEdges } = applyPathHighlightToFlow(
			nodes,
			edges,
			['a', 'b', 'c'],
			null
		);

		expect(nextEdges.find((e) => e.id === 'ab')?.data).toMatchObject({
			pathHighlighted: true,
			dimmed: false
		});
		expect(nextEdges.find((e) => e.id === 'bc')?.data).toMatchObject({
			pathHighlighted: true,
			dimmed: false
		});
		expect(nextEdges.find((e) => e.id === 'ac')?.data).toMatchObject({
			pathHighlighted: false,
			dimmed: true
		});
		expect(nextNodes.find((n) => n.id === 'a')?.data).toMatchObject({ pathInBreadcrumb: true });
		expect(nextNodes.find((n) => n.id === 'b')?.data).toMatchObject({ pathInBreadcrumb: true });
		expect(nextNodes.find((n) => n.id === 'c')?.data).toMatchObject({ pathInBreadcrumb: true });
	});

	it('highlights edges connected to the selected node', () => {
		const nodes: Node[] = [
			{ id: 'a', data: {}, position: { x: 0, y: 0 } },
			{ id: 'b', data: {}, position: { x: 0, y: 0 } },
			{ id: 'c', data: {}, position: { x: 0, y: 0 } }
		];
		const edges: Edge[] = [
			{ id: 'ab', source: 'a', target: 'b', data: { color: '#000' } },
			{ id: 'bc', source: 'b', target: 'c', data: { color: '#000' } }
		];

		const { edges: nextEdges } = applyPathHighlightToFlow(nodes, edges, [], 'b');

		expect(nextEdges.find((e) => e.id === 'ab')?.data).toMatchObject({
			highlighted: true,
			pathHighlighted: false,
			dimmed: false
		});
		expect(nextEdges.find((e) => e.id === 'bc')?.data).toMatchObject({
			highlighted: true,
			pathHighlighted: false,
			dimmed: false
		});
	});

	it('reports when flow highlight flags are already applied', () => {
		const nodes: Node[] = [
			{ id: 'a', data: { pathInBreadcrumb: true }, position: { x: 0, y: 0 }, selected: false },
			{ id: 'b', data: { pathInBreadcrumb: true }, position: { x: 0, y: 0 }, selected: true }
		];
		const edges: Edge[] = [
			{
				id: 'ab',
				source: 'a',
				target: 'b',
				data: { color: '#000', pathHighlighted: true, highlighted: false, dimmed: false }
			}
		];

		expect(flowHighlightsInSync(nodes, edges, ['a', 'b'], 'b')).toBe(true);
		expect(flowHighlightsInSync(nodes, edges, ['a', 'b'], null)).toBe(false);
	});
});
