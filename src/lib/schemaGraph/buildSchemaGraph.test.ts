import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildSchemaGraph, enumerateLeafPaths, TRUNCATED_CIRCULAR_REFERENCE } from './buildSchemaGraph';

describe('buildSchemaGraph', () => {
	it('builds a simple 2-schema $ref graph', () => {
		const schemas = {
			A: {
				type: 'object',
				properties: {
					spec: { $ref: '#/components/schemas/B' }
				}
			},
			B: {
				type: 'object',
				properties: {
					x: { type: 'string' }
				}
			}
		} as Record<string, unknown>;

		const g = buildSchemaGraph(schemas);
		expect(g.nodes).toEqual([
			{ name: 'A', isRecursive: false },
			{ name: 'B', isRecursive: false }
		]);
		expect(g.edges).toEqual([
			{
				source: 'A',
				target: 'B',
				viaProperty: 'spec',
				isBackEdge: false
			}
		]);
	});

	it('detects real recursive ErrorResponse cycle (core.json)', () => {
		const coreSpecPath = path.join(process.cwd(), 'static/openapi/26.4.3/core/core.json');
		const coreSpec = JSON.parse(fs.readFileSync(coreSpecPath, 'utf8')) as Record<string, unknown>;
		const components = coreSpec.components as Record<string, unknown>;
		const schemas = components.schemas as Record<string, unknown>;

		const g = buildSchemaGraph(schemas);
		const errorNode = g.nodes.find((n) => n.name === 'ErrorResponse');
		expect(errorNode?.isRecursive).toBe(true);

		expect(
			g.edges.some((e) => e.isBackEdge && (e.source === 'ErrorResponse' || e.target === 'ErrorResponse'))
		).toBe(true);
	});

	it('detects mutual recursion QueryWhereParsed <-> QueryWhereExpression', () => {
		const coreSpecPath = path.join(process.cwd(), 'static/openapi/26.4.3/core/core.json');
		const coreSpec = JSON.parse(fs.readFileSync(coreSpecPath, 'utf8')) as Record<string, unknown>;
		const components = coreSpec.components as Record<string, unknown>;
		const schemas = components.schemas as Record<string, unknown>;

		const g = buildSchemaGraph(schemas);
		const parsed = g.nodes.find((n) => n.name === 'QueryWhereParsed');
		const expr = g.nodes.find((n) => n.name === 'QueryWhereExpression');
		expect(parsed?.isRecursive).toBe(true);
		expect(expr?.isRecursive).toBe(true);

		expect(
			g.edges.some(
				(e) =>
					e.isBackEdge &&
					((e.source === 'QueryWhereParsed' && e.target === 'QueryWhereExpression') ||
						(e.source === 'QueryWhereExpression' && e.target === 'QueryWhereParsed'))
			)
		).toBe(true);
	});

	it('enumerateLeafPaths returns dotted leaves for nested objects', () => {
		const schemas = {
			Root: {
				type: 'object',
				properties: {
					spec: {
						type: 'object',
						properties: {
							a: {
								type: 'object',
								properties: {
									b: { type: 'string' }
								}
							}
						}
					}
				}
			}
		} as Record<string, unknown>;

		expect(enumerateLeafPaths(schemas, 'Root')).toEqual(['spec.a.b']);
	});

	it('enumerateLeafPaths terminates for recursive schemas and uses truncation marker', () => {
		const schemas = {
			A: {
				type: 'object',
				properties: {
					spec: { $ref: '#/components/schemas/B' }
				}
			},
			B: {
				type: 'object',
				properties: {
					foo: { $ref: '#/components/schemas/A' }
				}
			}
		} as Record<string, unknown>;

		expect(enumerateLeafPaths(schemas, 'A')).toEqual([
			`spec.foo.${TRUNCATED_CIRCULAR_REFERENCE}`
		]);
	});
});

