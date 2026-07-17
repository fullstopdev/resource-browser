import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildUnifiedApiGraph, operationNodeId, schemaNodeId } from './unifiedApiGraph';

describe('buildUnifiedApiGraph', () => {
	it('creates path→schema edge for requestBody $ref', () => {
		const spec = {
			paths: {
				'/demo': {
					post: {
						operationId: 'createDemo',
						tags: ['demo'],
						requestBody: {
							content: {
								'application/json': {
									schema: { $ref: '#/components/schemas/DemoRequest' }
								}
							}
						},
						responses: {
							'200': {
								description: 'ok',
								content: {
									'application/json': {
										schema: { $ref: '#/components/schemas/DemoResponse' }
									}
								}
							}
						}
					}
				}
			},
			components: {
				schemas: {
					DemoRequest: { type: 'object' },
					DemoResponse: { type: 'object' }
				}
			}
		} as Record<string, unknown>;

		const graph = buildUnifiedApiGraph(spec);
		const opId = operationNodeId('post', '/demo');

		expect(graph.nodes.some((n) => n.id === opId && n.kind === 'path')).toBe(true);
		expect(
			graph.edges.some(
				(e) =>
					e.kind === 'request-body' &&
					e.source === opId &&
					e.target === schemaNodeId('DemoRequest')
			)
		).toBe(true);
		expect(
			graph.edges.some(
				(e) =>
					e.kind === 'response' &&
					e.source === opId &&
					e.target === schemaNodeId('DemoResponse') &&
					e.statusCode === '200'
			)
		).toBe(true);
	});

	it('keeps schema $ref edges between component schemas', () => {
		const spec = {
			paths: {},
			components: {
				schemas: {
					A: {
						type: 'object',
						properties: {
							spec: { $ref: '#/components/schemas/B' }
						}
					},
					B: { type: 'object', properties: { x: { type: 'string' } } }
				}
			}
		} as Record<string, unknown>;

		const graph = buildUnifiedApiGraph(spec);
		expect(
			graph.edges.some(
				(e) =>
					e.kind === 'schema-ref' &&
					e.source === schemaNodeId('A') &&
					e.target === schemaNodeId('B') &&
					e.viaProperty === 'spec'
			)
		).toBe(true);
	});

	it('flags ErrorResponse cycle on schema subgraph', () => {
		const coreSpecPath = path.join(process.cwd(), 'static/openapi/26.4.3/core/core.json');
		const coreSpec = JSON.parse(fs.readFileSync(coreSpecPath, 'utf8')) as Record<string, unknown>;

		const graph = buildUnifiedApiGraph(coreSpec);
		const errorNode = graph.nodes.find((n) => n.schemaName === 'ErrorResponse');
		expect(errorNode?.isRecursive).toBe(true);
		expect(
			graph.edges.some(
				(e) =>
					e.kind === 'schema-ref' &&
					e.isBackEdge &&
					(e.source === schemaNodeId('ErrorResponse') ||
						e.target === schemaNodeId('ErrorResponse'))
			)
		).toBe(true);
	});

	it('creates parameter edges for parameter schema refs', () => {
		const spec = {
			paths: {
				'/items': {
					get: {
						operationId: 'listItems',
						parameters: [
							{
								name: 'filter',
								in: 'query',
								schema: { $ref: '#/components/schemas/ItemFilter' }
							}
						],
						responses: { '200': { description: 'ok' } }
					}
				}
			},
			components: {
				schemas: {
					ItemFilter: { type: 'object' }
				}
			}
		} as Record<string, unknown>;

		const graph = buildUnifiedApiGraph(spec);
		const opId = operationNodeId('get', '/items');
		expect(
			graph.edges.some(
				(e) =>
					e.kind === 'parameter' &&
					e.source === opId &&
					e.target === schemaNodeId('ItemFilter')
			)
		).toBe(true);
	});
});
