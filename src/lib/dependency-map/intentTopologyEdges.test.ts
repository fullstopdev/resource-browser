import { describe, expect, it } from 'vitest';
import { attachFocusEdgePorts, relationsInEdges, relationsInFlowEdges, toFlowEdges } from './intentTopologyEdges';
import {
	COLUMN_WIDTH,
	FOCUS_NODE_HEIGHT,
	NODE_HEIGHT,
	type LayoutEdge,
	type LayoutNode
} from './intentTopologyLayout';

describe('toFlowEdges', () => {
	const layoutEdges: LayoutEdge[] = [
		{
			id: 'e1',
			source: 'a',
			target: 'b',
			label: 'references',
			rel: 'references',
			count: 1
		},
		{
			id: 'e2',
			source: 'b',
			target: 'c',
			label: 'orchestrates',
			rel: 'orchestrates',
			count: 1
		}
	];

	it('maps layout edges with colored strokes and no canvas labels', () => {
		const flow = toFlowEdges(layoutEdges, 'dark');
		expect(flow).toHaveLength(2);
		expect(flow[0].type).toBe('intentTopology');
		expect(flow[0].label).toBeUndefined();
		expect(flow[0].style).toBeUndefined();
		expect(flow[0].data).toEqual({ rel: 'references', color: expect.any(String) });
		expect(flow[0].markerEnd).toMatchObject({ color: expect.any(String), width: 13, height: 13 });
		expect(flow[1].animated).toBe(true);
	});

	it('attachFocusEdgePorts wires per-peer handles on the focus node', () => {
		const consumerY = 10;
		const focusY = 10;
		const nodes: LayoutNode[] = [
			{
				id: 'consumer',
				type: 'intentTopology',
				position: { x: 0, y: consumerY },
				draggable: true,
				height: NODE_HEIGHT,
				data: {
					nodeId: 'consumer',
					kind: 'Router',
					displayName: 'routers',
					resourceId: 'consumer',
					group: 'g',
					shortGroup: 'g',
					type: 'config',
					depth: 1,
					role: 'dependent',
					roleLabel: 'dependent',
					isFocus: false,
					relColor: '#000',
					statusColor: '#000'
				}
			},
			{
				id: 'focus',
				type: 'intentTopology',
				position: { x: COLUMN_WIDTH, y: focusY },
				draggable: true,
				height: FOCUS_NODE_HEIGHT,
				data: {
					nodeId: 'focus',
					kind: 'Policy',
					displayName: 'policys',
					resourceId: 'focus',
					group: 'g',
					shortGroup: 'g',
					type: 'config',
					depth: 0,
					role: 'focus',
					roleLabel: 'focus',
					isFocus: true,
					relColor: '#000',
					statusColor: '#000'
				}
			}
		];
		const edges: LayoutEdge[] = [
			{
				id: 'e1',
				source: 'consumer',
				target: 'focus',
				label: 'appliesTo',
				rel: 'appliesTo',
				count: 1
			}
		];

		const expectedTopPx = consumerY + NODE_HEIGHT / 2 - focusY;

		const wired = attachFocusEdgePorts(nodes, edges);
		expect(wired.edges[0]?.targetHandle).toBe('in-consumer');
		expect(wired.nodes.find((n) => n.id === 'focus')?.data.incomingPorts).toEqual([
			{ id: 'consumer', topPx: expectedTopPx }
		]);
	});

	it('collects relations present in edges', () => {
		expect(relationsInEdges(layoutEdges)).toEqual(['orchestrates', 'references']);
		expect(relationsInEdges([])).toEqual([]);
	});

	it('includes appliesTo in legend order for policy-style maps', () => {
		const policyEdges: LayoutEdge[] = [
			{
				id: 'e-consumer',
				source: 'router',
				target: 'policy',
				label: 'Used by',
				rel: 'appliesTo',
				count: 1
			},
			{
				id: 'e-schema',
				source: 'policy',
				target: 'prefixset',
				label: 'Schema reference',
				rel: 'references',
				count: 1
			}
		];

		expect(relationsInEdges(policyEdges)).toEqual(['appliesTo', 'references']);

		const flow = toFlowEdges(policyEdges, 'light');
		expect(relationsInFlowEdges(flow)).toEqual(['appliesTo', 'references']);
		expect(flow[0]?.data?.color).not.toBe(flow[1]?.data?.color);
	});
});
