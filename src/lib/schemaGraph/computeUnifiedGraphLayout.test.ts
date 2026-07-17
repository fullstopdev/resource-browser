import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildUnifiedApiGraph, schemaNodeId } from './unifiedApiGraph';
import {
	computeApiMapLayout,
	computeSchemaDepsLayout,
	countForwardSchemaSubtree,
	countLayerCrossings,
	estimateSchemaNodeWidthPx,
	findApiMapPathNode,
	listEqlQuickPickSchemas,
	listApiMapOperations,
	listSchemaRootOptions,
	inferOwnedSchemaPrefix,
	orderLevelsByBarycenter,
	pickDefaultApiMapSelection,
	pickDefaultSchemaRoot,
	SCHEMA_DEPS_X_SPACING,
	SCHEMA_DEPS_Y_SPACING,
	SCHEMA_NODE_WIDTH_PX
} from './computeUnifiedGraphLayout';

describe('computeUnifiedGraphLayout', () => {
	it('exports layout spacing sized for readable cards and routing lanes', () => {
		expect(SCHEMA_DEPS_X_SPACING).toBeGreaterThanOrEqual(520);
		expect(SCHEMA_DEPS_Y_SPACING).toBeGreaterThanOrEqual(120);
		expect(SCHEMA_NODE_WIDTH_PX).toBeGreaterThanOrEqual(260);
	});

	it('barycenter ordering reduces crossings vs alphabetical sibling order', () => {
		// Crossed alphabetically: A→Z and B→Y would cross if Y then Z on the right.
		const levels = new Map<number, string[]>([
			[0, ['A', 'B']],
			[1, ['Y', 'Z']]
		]);
		const edges = [
			{ source: 'A', target: 'Z' },
			{ source: 'B', target: 'Y' }
		];
		const alphaCrossings = countLayerCrossings(['A', 'B'], ['Y', 'Z'], edges);
		expect(alphaCrossings).toBe(1);

		const ordered = orderLevelsByBarycenter(levels, edges);
		const right = ordered.get(1)!;
		const reduced = countLayerCrossings(ordered.get(0)!, right, edges);
		expect(reduced).toBe(0);
		expect(right).toEqual(['Z', 'Y']);
	});

	it('barycenter ordering is deterministic across runs', () => {
		const levels = new Map<number, string[]>([
			[0, ['Root']],
			[1, ['ChildB', 'ChildA', 'ChildC']]
		]);
		const edges = [
			{ source: 'Root', target: 'ChildA' },
			{ source: 'Root', target: 'ChildB' },
			{ source: 'Root', target: 'ChildC' }
		];
		const a = orderLevelsByBarycenter(levels, edges);
		const b = orderLevelsByBarycenter(levels, edges);
		expect(a.get(1)).toEqual(b.get(1));
		expect(a.get(1)).toEqual(['ChildA', 'ChildB', 'ChildC']);
	});

	it('estimateSchemaNodeWidthPx grows with long schema names', () => {
		expect(estimateSchemaNodeWidthPx(['Meta'])).toBeGreaterThanOrEqual(260);
		expect(estimateSchemaNodeWidthPx(['TransactionExecutionResultWithCounts'])).toBeGreaterThan(
			estimateSchemaNodeWidthPx(['Meta'])
		);
		expect(estimateSchemaNodeWidthPx(['TransactionExecutionResultWithCounts'])).toBeLessThanOrEqual(
			340
		);
	});

	it('schema-deps applies barycenter order on a crossing-prone tree', () => {
		const graph = buildUnifiedApiGraph({
			paths: {},
			components: {
				schemas: {
					Root: {
						type: 'object',
						properties: {
							first: { $ref: '#/components/schemas/Alpha' },
							second: { $ref: '#/components/schemas/Beta' }
						}
					},
					Alpha: {
						type: 'object',
						properties: {
							leaf: { $ref: '#/components/schemas/Zulu' }
						}
					},
					Beta: {
						type: 'object',
						properties: {
							leaf: { $ref: '#/components/schemas/Yankee' }
						}
					},
					Yankee: { type: 'object' },
					Zulu: { type: 'object' }
				}
			}
		});

		const layout = computeSchemaDepsLayout(graph, 'Root');
		const level1 = layout.nodes
			.filter((n) => n.level === 1)
			.sort((a, b) => a.indexInLevel - b.indexInLevel)
			.map((n) => n.schemaName);
		const level2 = layout.nodes
			.filter((n) => n.level === 2)
			.sort((a, b) => a.indexInLevel - b.indexInLevel)
			.map((n) => n.schemaName);

		expect(level1).toEqual(['Alpha', 'Beta']);
		// Zulu under Alpha should sit above Yankee under Beta (no cross).
		expect(level2).toEqual(['Zulu', 'Yankee']);

		const forward = layout.edges
			.filter((e) => !e.isBackEdge)
			.map((e) => ({ source: e.source, target: e.target }));
		const l1Ids = layout.nodes
			.filter((n) => n.level === 1)
			.sort((a, b) => a.indexInLevel - b.indexInLevel)
			.map((n) => n.id);
		const l2Ids = layout.nodes
			.filter((n) => n.level === 2)
			.sort((a, b) => a.indexInLevel - b.indexInLevel)
			.map((n) => n.id);
		expect(countLayerCrossings(l1Ids, l2Ids, forward)).toBe(0);
	});

	it('schema-deps subtree hides orphan schemas', () => {
		const graph = buildUnifiedApiGraph({
			paths: {},
			components: {
				schemas: {
					Root: {
						type: 'object',
						properties: { child: { $ref: '#/components/schemas/Child' } }
					},
					Child: { type: 'object' },
					Orphan: { type: 'object' }
				}
			}
		});

		const layout = computeSchemaDepsLayout(graph, 'Root');
		expect(layout.nodes.map((n) => n.schemaName).sort()).toEqual(['Child', 'Root']);
		expect(layout.edges).toHaveLength(1);
	});

	it('schema-deps show-all includes every schema node', () => {
		const graph = buildUnifiedApiGraph({
			paths: {},
			components: {
				schemas: {
					Root: {
						type: 'object',
						properties: { child: { $ref: '#/components/schemas/Child' } }
					},
					Child: { type: 'object' },
					Orphan: { type: 'object' }
				}
			}
		});

		const layout = computeSchemaDepsLayout(graph, 'Root', true);
		expect(layout.nodes.map((n) => n.schemaName).sort()).toEqual(['Child', 'Orphan', 'Root']);
		expect(layout.edges.length).toBeGreaterThanOrEqual(1);
		const root = layout.nodes.find((n) => n.schemaName === 'Root');
		const child = layout.nodes.find((n) => n.schemaName === 'Child');
		expect(root?.level).toBe(0);
		expect(child?.level).toBeGreaterThan(root?.level ?? -1);
	});

	it('api-map places path nodes at level 0 and schemas to the right', () => {
		const graph = buildUnifiedApiGraph({
			paths: {
				'/q': {
					get: {
						operationId: 'query',
						tags: ['coreQuery'],
						responses: {
							'200': {
								description: 'ok',
								content: {
									'application/json': {
										schema: { $ref: '#/components/schemas/QueryResponse' }
									}
								}
							}
						}
					}
				}
			},
			components: {
				schemas: {
					QueryResponse: {
						type: 'object',
						properties: {
							meta: { $ref: '#/components/schemas/Meta' }
						}
					},
					Meta: { type: 'object' }
				}
			}
		});

		const layout = computeApiMapLayout(graph);
		const pathNode = layout.nodes.find((n) => n.kind === 'path');
		const queryNode = layout.nodes.find((n) => n.schemaName === 'QueryResponse');
		const metaNode = layout.nodes.find((n) => n.schemaName === 'Meta');

		expect(pathNode?.level).toBe(0);
		expect(queryNode?.level).toBe(1);
		// Strict bipartite: nested Meta is not expanded in API map
		expect(metaNode).toBeUndefined();
		expect(
			layout.edges.some(
				(e) => e.kind === 'response' && e.target === schemaNodeId('QueryResponse')
			)
		).toBe(true);
		expect(layout.edges.every((e) => e.kind !== 'schema-ref')).toBe(true);
		expect(layout.edges.every((e) => !e.label.includes('default · default'))).toBe(true);
	});

	it('api-map response labels never emit default · default', () => {
		const graph = buildUnifiedApiGraph({
			paths: {
				'/x': {
					get: {
						operationId: 'getX',
						tags: ['t'],
						responses: {
							default: {
								description: 'err',
								content: {
									'application/json': {
										schema: { $ref: '#/components/schemas/ErrorResponse' }
									}
								}
							}
						}
					}
				}
			},
			components: {
				schemas: {
					ErrorResponse: { type: 'object' }
				}
			}
		});
		const layout = computeApiMapLayout(graph, { tagFilter: 't' });
		expect(layout.edges.length).toBeGreaterThan(0);
		for (const e of layout.edges) {
			expect(e.label).not.toMatch(/default\s*[·•]\s*default/i);
			expect(e.label === 'default' || e.label === 'response' || e.label.length > 0).toBe(true);
		}
	});

	it('listApiMapOperations keeps tag ops even when schemaFocus would match zero paths', () => {
		const coreGraphPath = path.join(process.cwd(), 'static/openapi/26.4.3/core/api-graph.json');
		const graph = JSON.parse(fs.readFileSync(coreGraphPath, 'utf8')) as ReturnType<
			typeof buildUnifiedApiGraph
		>;

		const ops = listApiMapOperations(graph, 'coreTransaction');
		expect(ops.length).toBeGreaterThan(0);
		expect(ops.every((op) => (op.tags ?? []).includes('coreTransaction'))).toBe(true);

		// Nested $ref roots like QueryEqlParsed have no direct path usage edges.
		const broken = computeApiMapLayout(graph, {
			tagFilter: 'coreTransaction',
			schemaFocus: 'QueryEqlParsed'
		});
		expect(broken.nodes.filter((n) => n.kind === 'path').length).toBe(ops.length);

		const focused = computeApiMapLayout(graph, {
			tagFilter: 'coreTransaction',
			pathId: ops[0]!.id
		});
		expect(focused.nodes.filter((n) => n.kind === 'path')).toHaveLength(1);
		expect(focused.nodes.some((n) => n.id === ops[0]!.id)).toBe(true);
		expect(focused.edges.length).toBeGreaterThan(0);
	});

	it('api-map edgeKinds filter keeps path and drops filtered usage edges', () => {
		const graph = buildUnifiedApiGraph({
			paths: {
				'/q': {
					get: {
						operationId: 'query',
						tags: ['coreQuery'],
						parameters: [
							{
								name: 'filter',
								in: 'query',
								schema: { $ref: '#/components/schemas/FilterParam' }
							}
						],
						responses: {
							'200': {
								description: 'ok',
								content: {
									'application/json': {
										schema: { $ref: '#/components/schemas/QueryResponse' }
									}
								}
							}
						}
					}
				}
			},
			components: {
				schemas: {
					QueryResponse: { type: 'object' },
					FilterParam: { type: 'string' }
				}
			}
		});

		const responseOnly = computeApiMapLayout(graph, {
			pathId: 'operation:get:/q',
			edgeKinds: ['response']
		});
		expect(responseOnly.edges.every((e) => e.kind === 'response')).toBe(true);
		expect(responseOnly.nodes.some((n) => n.schemaName === 'QueryResponse')).toBe(true);
		expect(responseOnly.nodes.some((n) => n.schemaName === 'FilterParam')).toBe(false);

		const none = computeApiMapLayout(graph, {
			pathId: 'operation:get:/q',
			edgeKinds: []
		});
		expect(none.edges).toHaveLength(0);
		expect(none.nodes.filter((n) => n.kind === 'path')).toHaveLength(1);
		expect(none.nodes.filter((n) => n.kind === 'schema')).toHaveLength(0);
	});

	it('pickDefaultApiMapSelection auto-picks first op and prefers schema-linked ops', () => {
		const coreGraphPath = path.join(process.cwd(), 'static/openapi/26.4.3/core/api-graph.json');
		const graph = JSON.parse(fs.readFileSync(coreGraphPath, 'utf8')) as ReturnType<
			typeof buildUnifiedApiGraph
		>;

		const byTag = pickDefaultApiMapSelection(graph, { tagFilter: 'coreTransaction' });
		expect(byTag.tagFilter).toBe('coreTransaction');
		expect(byTag.pathId).toBe(listApiMapOperations(graph, 'coreTransaction')[0]!.id);

		const withFocus = pickDefaultApiMapSelection(graph, { schemaFocus: 'QueryResponse' });
		expect(withFocus.tagFilter).toBe('coreQuery');
		expect(withFocus.pathId).toMatch(/^operation:/);

		// Unrelated nested schema must not wipe selection for an explicit tag.
		const nested = pickDefaultApiMapSelection(graph, {
			tagFilter: 'coreTransaction',
			schemaFocus: 'QueryEqlParsed'
		});
		expect(nested.pathId).toBe(byTag.pathId);
	});

	it('findApiMapPathNode resolves by graph id or operation deep-link id', () => {
		const coreGraphPath = path.join(process.cwd(), 'static/openapi/26.4.3/core/api-graph.json');
		const graph = JSON.parse(fs.readFileSync(coreGraphPath, 'utf8')) as ReturnType<
			typeof buildUnifiedApiGraph
		>;
		const sample = listApiMapOperations(graph, 'coreQuery')[0];
		expect(sample).toBeTruthy();
		expect(findApiMapPathNode(graph, sample!.id)?.id).toBe(sample!.id);
		if (sample!.operationId) {
			expect(findApiMapPathNode(graph, sample!.operationId)?.id).toBe(sample!.id);
		}
	});

	it('pickDefaultSchemaRoot prefers QueryEqlParsed on core', () => {
		const coreSpecPath = path.join(process.cwd(), 'static/openapi/26.4.3/core/core.json');
		const coreSpec = JSON.parse(fs.readFileSync(coreSpecPath, 'utf8')) as Record<string, unknown>;
		const graph = buildUnifiedApiGraph(coreSpec);
		const pick = pickDefaultSchemaRoot(graph);
		expect(pick.root).toBe('QueryEqlParsed');
		expect(pick.preferShowAll).toBe(false);
		expect(countForwardSchemaSubtree(graph, 'QueryEqlParsed')).toBeGreaterThan(1);
		expect(listEqlQuickPickSchemas(graph)).toContain('QueryEqlParsed');
	});

	it('pickDefaultSchemaRoot prefers AAA CRD over inlined Resource/Topology platform schemas', () => {
		const aaaSpecPath = path.join(
			process.cwd(),
			'static/openapi/26.4.3/apps/aaa.eda.nokia.com/v1/aaa.json'
		);
		const aaaSpec = JSON.parse(fs.readFileSync(aaaSpecPath, 'utf8')) as Record<string, unknown>;
		const graph = buildUnifiedApiGraph(aaaSpec);

		// Platform trees are larger, but must not win the default root.
		expect(countForwardSchemaSubtree(graph, 'ResourceTopology')).toBeGreaterThan(
			countForwardSchemaSubtree(graph, 'com.nokia.eda.aaa.v1.AuthenticationPolicy')
		);

		const pick = pickDefaultSchemaRoot(graph);
		expect(pick.root).toMatch(/^com\.nokia\.eda\.aaa\.v1\./);
		expect(pick.root).not.toMatch(/^(Resource|Topology|ResourceTopology|K8STopologyRequest)$/);
		expect(pick.preferShowAll).toBe(false);

		const layout = computeSchemaDepsLayout(graph, pick.root, false);
		const labels = layout.nodes.map((n) => n.schemaName ?? n.label);
		expect(labels).not.toContain('Resource');
		expect(labels).not.toContain('Topology');
		expect(labels).not.toContain('ResourceTopology');
	});

	it('pickDefaultSchemaRoot demotes ResourceTopology when FQDN CRDs exist (fixture)', () => {
		const graph = buildUnifiedApiGraph({
			paths: {},
			components: {
				schemas: {
					'com.example.app.v1.Widget': {
						type: 'object',
						properties: {
							meta: { $ref: '#/components/schemas/com.example.app.v1.Widget_metadata' }
						}
					},
					'com.example.app.v1.Widget_metadata': {
						type: 'object',
						properties: { name: { type: 'string' } }
					},
					ResourceTopology: {
						type: 'object',
						properties: {
							topology: { $ref: '#/components/schemas/OverlayState' },
							topologyMetadata: { $ref: '#/components/schemas/Topology' }
						}
					},
					OverlayState: {
						type: 'object',
						properties: {
							nodes: {
								type: 'array',
								items: { $ref: '#/components/schemas/TopoOverlayNode' }
							}
						}
					},
					TopoOverlayNode: {
						type: 'object',
						properties: { name: { type: 'string' } }
					},
					Topology: {
						type: 'object',
						properties: {
							nodes: {
								type: 'array',
								items: { $ref: '#/components/schemas/TopoElemMetadata' }
							}
						}
					},
					TopoElemMetadata: {
						type: 'object',
						properties: { name: { type: 'string' } }
					},
					Resource: { type: 'object', properties: { name: { type: 'string' } } }
				}
			}
		});

		expect(countForwardSchemaSubtree(graph, 'ResourceTopology')).toBeGreaterThan(
			countForwardSchemaSubtree(graph, 'com.example.app.v1.Widget')
		);
		const pick = pickDefaultSchemaRoot(graph);
		expect(pick.root).toBe('com.example.app.v1.Widget');
		expect(pick.preferShowAll).toBe(false);
	});

	it('core Transaction subtree lays out with few layer crossings and full-name width', () => {
		const coreSpecPath = path.join(process.cwd(), 'static/openapi/26.4.3/core/core.json');
		const coreSpec = JSON.parse(fs.readFileSync(coreSpecPath, 'utf8')) as Record<string, unknown>;
		const graph = buildUnifiedApiGraph(coreSpec);
		const layout = computeSchemaDepsLayout(graph, 'Transaction');
		expect(layout.nodes.length).toBeGreaterThan(5);

		const byLevel = new Map<number, string[]>();
		for (const n of layout.nodes) {
			const bucket = byLevel.get(n.level) ?? [];
			bucket[n.indexInLevel] = n.id;
			byLevel.set(n.level, bucket);
		}
		const forward = layout.edges
			.filter((e) => !e.isBackEdge)
			.map((e) => ({ source: e.source, target: e.target }));
		const levels = [...byLevel.keys()].sort((a, b) => a - b);
		let crossings = 0;
		for (let i = 0; i < levels.length - 1; i++) {
			const left = (byLevel.get(levels[i]!) ?? []).filter(Boolean);
			const right = (byLevel.get(levels[i + 1]!) ?? []).filter(Boolean);
			crossings += countLayerCrossings(left, right, forward);
		}
		expect(crossings).toBeLessThanOrEqual(2);

		const labels = layout.nodes.map((n) => n.schemaName ?? n.label);
		expect(labels).toContain('TransactionContent');
		expect(labels).toContain('TransactionPatch');
		expect(estimateSchemaNodeWidthPx(labels)).toBeGreaterThanOrEqual(260);
	});

	it('pickDefaultSchemaRoot avoids ErrorResponse when a richer forward tree exists', () => {
		const graph = buildUnifiedApiGraph({
			paths: {
				'/a': {
					get: {
						operationId: 'getA',
						tags: ['t'],
						responses: {
							'200': {
								description: 'ok',
								content: {
									'application/json': {
										schema: { $ref: '#/components/schemas/Root' }
									}
								}
							},
							default: {
								description: 'err',
								content: {
									'application/json': {
										schema: { $ref: '#/components/schemas/ErrorResponse' }
									}
								}
							}
						}
					}
				},
				'/b': {
					get: {
						operationId: 'getB',
						tags: ['t'],
						responses: {
							default: {
								description: 'err',
								content: {
									'application/json': {
										schema: { $ref: '#/components/schemas/ErrorResponse' }
									}
								}
							}
						}
					}
				}
			},
			components: {
				schemas: {
					Root: {
						type: 'object',
						properties: {
							child: { $ref: '#/components/schemas/Child' }
						}
					},
					Child: {
						type: 'object',
						properties: {
							leaf: { type: 'string' }
						}
					},
					ErrorResponse: {
						type: 'object',
						properties: {
							cause: { $ref: '#/components/schemas/ErrorResponse' }
						}
					}
				}
			}
		});

		const pick = pickDefaultSchemaRoot(graph);
		expect(pick.root).toBe('Root');
		expect(pick.preferShowAll).toBe(false);
		expect(countForwardSchemaSubtree(graph, 'ErrorResponse')).toBe(1);
	});

	it('pickDefaultSchemaRoot enables show-all when every forward tree is tiny', () => {
		const graph = buildUnifiedApiGraph({
			paths: {},
			components: {
				schemas: {
					Lonely: { type: 'object' },
					Other: { type: 'object' }
				}
			}
		});
		const pick = pickDefaultSchemaRoot(graph);
		expect(pick.preferShowAll).toBe(true);
		expect(['Lonely', 'Other']).toContain(pick.root);
	});

	it('listSchemaRootOptions filters platform DTOs for flowsampling when show-all is off', () => {
		const flowSpecPath = path.join(
			process.cwd(),
			'static/openapi/26.4.3/apps/flowsampling.eda.nokia.com/v1alpha1/flowsampling.json'
		);
		const flowSpec = JSON.parse(fs.readFileSync(flowSpecPath, 'utf8')) as Record<
			string,
			unknown
		>;
		const graph = buildUnifiedApiGraph(flowSpec);
		const allNames = graph.nodes
			.filter((n) => n.kind === 'schema')
			.map((n) => n.schemaName ?? '')
			.filter(Boolean);

		expect(allNames).toContain('Resource');
		expect(allNames).toContain('Topology');
		expect(allNames).toContain('ResourceTopology');
		expect(allNames).toContain('ErrorResponse');
		expect(allNames).toContain('AppGroup');
		expect(allNames).toContain('IntentTarget');
		expect(allNames).toContain('com.nokia.eda.flowsampling.v1alpha1.SFlow');

		const filtered = listSchemaRootOptions(allNames, false);
		expect(filtered.every((n) => n.startsWith('com.nokia.eda.flowsampling.v1alpha1.'))).toBe(
			true
		);
		expect(filtered).toContain('com.nokia.eda.flowsampling.v1alpha1.SFlow');
		expect(filtered).toContain('com.nokia.eda.flowsampling.v1alpha1.SFlowList');
		expect(filtered).not.toContain('Resource');
		expect(filtered).not.toContain('Topology');
		expect(filtered).not.toContain('ResourceTopology');
		expect(filtered).not.toContain('ErrorResponse');
		expect(filtered).not.toContain('AppGroup');
		expect(filtered).not.toContain('IntentTarget');
		expect(filtered).not.toContain('OverlayState');
		expect(filtered).not.toContain('K8STopologyRequest');

		const showAll = listSchemaRootOptions(allNames, true);
		expect(showAll).toContain('Resource');
		expect(showAll).toContain('com.nokia.eda.flowsampling.v1alpha1.SFlow');
		expect(showAll.length).toBe(allNames.length);

		expect(inferOwnedSchemaPrefix(allNames)).toBe('com.nokia.eda.flowsampling.v1alpha1');
		expect(pickDefaultSchemaRoot(graph).root).toBe(
			'com.nokia.eda.flowsampling.v1alpha1.SFlow'
		);
	});

	it('listSchemaRootOptions keeps full list for core (no FQDN CRD prefix)', () => {
		const names = ['QueryEqlParsed', 'QueryResponse', 'ErrorResponse', 'Transaction'];
		expect(inferOwnedSchemaPrefix(names)).toBeNull();
		expect(listSchemaRootOptions(names, false)).toEqual([...names].sort((a, b) => a.localeCompare(b)));
	});
});
