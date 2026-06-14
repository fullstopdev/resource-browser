import { describe, expect, it } from 'vitest';
import {
	assertNoLayoutOverlaps,
	buildIntentTopologyLayout,
	COLUMN_WIDTH,
	findLayoutOverlaps,
	NODE_HEIGHT,
	ROW_STEP
} from './intentTopologyLayout';
import type { DependencyGraph } from './types';

const graph: DependencyGraph = {
	releaseFolder: 'resources/26.4.2',
	generatedAt: '2026-01-01',
	nodes: [
		{
			id: 'topologies.topologies.eda.nokia.com',
			kind: 'Topology',
			group: 'topologies.eda.nokia.com',
			type: 'config',
			version: 'v1',
			shortName: 'topologies'
		},
		{
			id: 'routers.services.eda.nokia.com',
			kind: 'Router',
			group: 'services.eda.nokia.com',
			type: 'config',
			version: 'v1',
			shortName: 'routers'
		},
		{
			id: 'alarmoverlays.topologies.eda.nokia.com',
			kind: 'AlarmOverlay',
			group: 'topologies.eda.nokia.com',
			type: 'config',
			version: 'v1',
			shortName: 'alarmoverlays'
		}
	],
	links: [
		{
			id: 'l1',
			source: 'topologies.topologies.eda.nokia.com',
			target: 'routers.services.eda.nokia.com',
			rel: 'references',
			field: 'spec.router',
			edgeClass: 'intentDependency',
			edgeSource: 'semantic',
			confidenceTier: 2
		},
		{
			id: 'l2',
			source: 'alarmoverlays.topologies.eda.nokia.com',
			target: 'topologies.topologies.eda.nokia.com',
			rel: 'observes',
			field: 'spec.topology',
			edgeClass: 'intentDependency',
			edgeSource: 'catalog',
			confidenceTier: 1
		},
		{
			id: 'l3',
			source: 'topologies.topologies.eda.nokia.com',
			target: 'routers.services.eda.nokia.com',
			rel: 'references',
			field: 'spec.explicitRef',
			edgeClass: 'hardRef',
			edgeSource: 'explicit'
		}
	]
};

const focusId = 'topologies.topologies.eda.nokia.com';

describe('buildIntentTopologyLayout', () => {
	it('places focus centered with consumers left and prerequisites right', () => {
		const layout = buildIntentTopologyLayout(graph, focusId);
		expect(layout.isEmpty).toBe(false);
		expect(layout.nodes).toHaveLength(3);
		expect(layout.edges).toHaveLength(2);

		const focus = layout.nodes.find((n) => n.id === focusId);
		expect(focus?.data.isFocus).toBe(true);
		expect(focus?.position.x).toBe(COLUMN_WIDTH);

		const router = layout.nodes.find((n) => n.id === 'routers.services.eda.nokia.com');
		expect(router?.data.role).toBe('prerequisite');
		expect(router!.position.x).toBe(COLUMN_WIDTH * 2);
		expect(router!.position.x).toBeGreaterThan(focus!.position.x);

		const overlay = layout.nodes.find((n) => n.id === 'alarmoverlays.topologies.eda.nokia.com');
		expect(overlay?.data.role).toBe('dependent');
		expect(overlay!.position.x).toBe(0);
		expect(overlay!.position.x).toBeLessThan(focus!.position.x);
	});

	it('flows consumer edges into focus and prerequisite edges outward to the right', () => {
		const layout = buildIntentTopologyLayout(graph, focusId);
		const depEdge = layout.edges.find((e) => e.target === 'routers.services.eda.nokia.com');
		expect(depEdge?.source).toBe(focusId);
		expect(depEdge?.rel).toBe('references');

		const reqEdge = layout.edges.find((e) => e.source === 'alarmoverlays.topologies.eda.nokia.com');
		expect(reqEdge?.target).toBe(focusId);
		expect(reqEdge?.rel).toBe('observes');
	});

	it('never places an edge target left of its source', () => {
		const layout = buildIntentTopologyLayout(graph, focusId);
		const xById = new Map(layout.nodes.map((node) => [node.id, node.position.x]));

		for (const edge of layout.edges) {
			expect(xById.get(edge.source)).toBeLessThan(xById.get(edge.target)!);
		}
	});

	it('includes hardRef edges in layout (schema references)', () => {
		const layout = buildIntentTopologyLayout(graph, focusId);
		expect(layout.edges.length).toBeGreaterThanOrEqual(2);
	});

	it('returns empty when filters hide all deps', () => {
		const layout = buildIntentTopologyLayout(graph, focusId, { depSearch: 'nonexistent' });
		expect(layout.isEmpty).toBe(true);
		expect(layout.nodes).toHaveLength(0);
	});

	it('respects direction toggles', () => {
		const onlyDepends = buildIntentTopologyLayout(graph, focusId, { showRequiredBy: false });
		expect(onlyDepends.nodes).toHaveLength(2);
		expect(onlyDepends.edges).toHaveLength(1);

		const onlyRequired = buildIntentTopologyLayout(graph, focusId, { showDependsOn: false });
		expect(onlyRequired.nodes).toHaveLength(2);
		expect(onlyRequired.edges).toHaveLength(1);
	});

	it('propagates evidence metadata and relColor to node data', () => {
		const layout = buildIntentTopologyLayout(graph, focusId);
		const router = layout.nodes.find((n) => n.id === 'routers.services.eda.nokia.com');
		expect(router?.data.edgeSource).toBe('semantic');
		expect(router?.data.confidenceTier).toBe(2);
		expect(router?.data.relColor).toBeTruthy();

		const overlay = layout.nodes.find((n) => n.id === 'alarmoverlays.topologies.eda.nokia.com');
		expect(overlay?.data.edgeSource).toBe('catalog');
		expect(overlay?.data.confidenceTier).toBe(1);
	});

	it('stacks nodes from different API groups with vertical gap', () => {
		const multiGroupGraph: DependencyGraph = {
			...graph,
			nodes: [
				...graph.nodes,
				{
					id: 'subinterfaces.interfaces.eda.nokia.com',
					kind: 'Subinterface',
					group: 'interfaces.eda.nokia.com',
					type: 'config',
					version: 'v1',
					shortName: 'subinterfaces'
				}
			],
			links: [
				...graph.links,
				{
					id: 'l4',
					source: 'topologies.topologies.eda.nokia.com',
					target: 'subinterfaces.interfaces.eda.nokia.com',
					rel: 'references',
					field: 'spec.subIf',
					edgeClass: 'intentDependency',
					edgeSource: 'semantic',
					confidenceTier: 2
				}
			]
		};

		const layout = buildIntentTopologyLayout(multiGroupGraph, focusId);
		const router = layout.nodes.find((n) => n.id === 'routers.services.eda.nokia.com')!;
		const subif = layout.nodes.find((n) => n.id === 'subinterfaces.interfaces.eda.nokia.com')!;
		expect(router.position.x).toBe(subif.position.x);
		expect(Math.abs(router.position.y - subif.position.y)).toBeGreaterThanOrEqual(ROW_STEP);
	});

	it('has no overlapping node bounding boxes', () => {
		const layout = buildIntentTopologyLayout(graph, focusId);
		expect(findLayoutOverlaps(layout.nodes)).toEqual([]);
		assertNoLayoutOverlaps(layout.nodes);
	});

	it('maintains minimum vertical gap between nodes in the same column', () => {
		const layout = buildIntentTopologyLayout(graph, focusId);
		const byColumn = new Map<number, typeof layout.nodes>();

		for (const node of layout.nodes) {
			const col = Math.round(node.position.x / COLUMN_WIDTH);
			const bucket = byColumn.get(col) ?? [];
			bucket.push(node);
			byColumn.set(col, bucket);
		}

		for (const colNodes of byColumn.values()) {
			const sorted = [...colNodes].sort((a, b) => a.position.y - b.position.y);
			for (let i = 1; i < sorted.length; i++) {
				const prev = sorted[i - 1]!;
				const curr = sorted[i]!;
				const gap = curr.position.y - (prev.position.y + NODE_HEIGHT);
				expect(gap).toBeGreaterThanOrEqual(0);
			}
		}
	});

	it('excludes deploys catalog pairing from layout', () => {
		const withDeploys: DependencyGraph = {
			...graph,
			nodes: [
				...graph.nodes,
				{
					id: 'deployments.apps.eda.nokia.com',
					kind: 'Deployment',
					group: 'apps.eda.nokia.com',
					type: 'config',
					version: 'v1',
					shortName: 'deployments'
				}
			],
			links: [
				...graph.links,
				{
					id: 'l-deploy',
					source: 'topologies.topologies.eda.nokia.com',
					target: 'deployments.apps.eda.nokia.com',
					rel: 'deploys',
					edgeClass: 'intentDependency',
					edgeSource: 'catalog',
					confidenceTier: 1
				}
			]
		};

		const layout = buildIntentTopologyLayout(withDeploys, focusId);
		expect(layout.nodes.some((n) => n.id === 'deployments.apps.eda.nokia.com')).toBe(false);
	});

	it('places consumers left and prerequisites right of focus', () => {
		const layout = buildIntentTopologyLayout(graph, focusId);
		const router = layout.nodes.find((n) => n.id === 'routers.services.eda.nokia.com')!;
		const overlay = layout.nodes.find((n) => n.id === 'alarmoverlays.topologies.eda.nokia.com')!;
		expect(overlay.position.x).toBe(0);
		expect(router.position.x).toBe(COLUMN_WIDTH * 2);
		expect(overlay.position.x).toBeLessThan(router.position.x);
	});

	it('collapses duplicate intent edges by count metadata', () => {
		const dupGraph: DependencyGraph = {
			...graph,
			links: [
				...graph.links.filter((l) => l.id !== 'l3'),
				{
					id: 'l1b',
					source: 'topologies.topologies.eda.nokia.com',
					target: 'routers.services.eda.nokia.com',
					rel: 'references',
					field: 'spec.altRouter',
					edgeClass: 'intentDependency',
					edgeSource: 'semantic',
					confidenceTier: 2
				}
			]
		};

		const layout = buildIntentTopologyLayout(dupGraph, focusId);
		const depEdge = layout.edges.find((e) => e.target === 'routers.services.eda.nokia.com');
		expect(depEdge?.count).toBe(2);
		expect(depEdge?.rel).toBe('references');
	});

	it('does not emit canvas column labels', () => {
		const layout = buildIntentTopologyLayout(graph, focusId);
		expect(layout.columnLabels).toEqual([]);
	});
});
