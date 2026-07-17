import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildSchemaGraph } from './buildSchemaGraph';
import {
	computeSchemaGraphLayout,
	computeSchemaGraphSubtree,
	pickMostReferencedSchema
} from './computeSchemaGraphLayout';

describe('computeSchemaGraphLayout', () => {
	it('shows only the reachable subtree from the root (no orphan nodes)', () => {
		const graph = buildSchemaGraph({
			Root: {
				type: 'object',
				properties: {
					a: { $ref: '#/components/schemas/Child' }
				}
			},
			Child: {
				type: 'object',
				properties: {
					x: { type: 'string' }
				}
			},
			Orphan: {
				type: 'object',
				properties: {
					y: { type: 'string' }
				}
			}
		});

		const layout = computeSchemaGraphLayout(graph, 'Root');
		expect(layout.nodes.map((n) => n.name).sort()).toEqual(['Child', 'Root']);
		expect(layout.edges).toHaveLength(1);
		expect(layout.edges[0]?.viaProperty).toBe('a');
	});

	it('keeps back-edges without duplicating recursive targets in the subtree', () => {
		const graph = buildSchemaGraph({
			A: {
				type: 'object',
				properties: {
					next: { $ref: '#/components/schemas/B' }
				}
			},
			B: {
				type: 'object',
				properties: {
					back: { $ref: '#/components/schemas/A' }
				}
			}
		});

		const { visibleNodes, visibleEdges } = computeSchemaGraphSubtree(graph, 'A');
		expect([...visibleNodes].sort()).toEqual(['A', 'B']);
		expect(visibleEdges.some((e) => e.isBackEdge && e.source === 'B' && e.target === 'A')).toBe(
			true
		);
	});

	it('defaults to a rich forward subtree, not ErrorResponse hubs', () => {
		const coreSpecPath = path.join(process.cwd(), 'static/openapi/26.4.3/core/core.json');
		const coreSpec = JSON.parse(fs.readFileSync(coreSpecPath, 'utf8')) as Record<string, unknown>;
		const components = coreSpec.components as Record<string, unknown>;
		const schemas = components.schemas as Record<string, unknown>;
		const graph = buildSchemaGraph(schemas);

		const picked = pickMostReferencedSchema(graph);
		expect(picked).not.toBe('ErrorResponse');
		const pickedLayout = computeSchemaGraphLayout(graph, picked);
		expect(pickedLayout.nodes.length).toBeGreaterThan(1);

		const layout = computeSchemaGraphLayout(graph, 'ErrorResponse');
		expect(layout.nodes.some((n) => n.name === 'ErrorResponse')).toBe(true);
		expect(layout.nodes.length).toBeLessThan(graph.nodes.length);
		expect(layout.edges.every((e) => e.viaProperty.length >= 0)).toBe(true);
	});
});
