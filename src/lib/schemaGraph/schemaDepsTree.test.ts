import { describe, expect, it } from 'vitest';
import { buildUnifiedApiGraph } from './unifiedApiGraph';
import { buildSchemaDepsTree, flattenSchemaDepsTree } from './schemaDepsTree';

describe('schemaDepsTree', () => {
	it('builds a deterministic forward $ref tree from root', () => {
		const graph = buildUnifiedApiGraph({
			paths: {},
			components: {
				schemas: {
					Root: {
						type: 'object',
						properties: {
							child: { $ref: '#/components/schemas/Child' },
							other: { $ref: '#/components/schemas/Sibling' }
						}
					},
					Child: {
						type: 'object',
						properties: { leaf: { $ref: '#/components/schemas/Leaf' } }
					},
					Sibling: { type: 'object' },
					Leaf: { type: 'string' },
					Orphan: { type: 'object' }
				}
			}
		});

		const result = buildSchemaDepsTree(graph, 'Root');
		expect(result.tree?.schemaName).toBe('Root');
		expect(result.tree?.children.map((c) => c.schemaName).sort()).toEqual(['Child', 'Sibling']);
		const child = result.tree?.children.find((c) => c.schemaName === 'Child');
		expect(child?.children.map((c) => c.schemaName)).toEqual(['Leaf']);
		expect(flattenSchemaDepsTree(result.tree).map((n) => n.schemaName)).not.toContain('Orphan');
	});

	it('marks cyclic back-edges without infinite expansion', () => {
		const graph = buildUnifiedApiGraph({
			paths: {},
			components: {
				schemas: {
					A: {
						type: 'object',
						properties: { b: { $ref: '#/components/schemas/B' } }
					},
					B: {
						type: 'object',
						properties: { a: { $ref: '#/components/schemas/A' } }
					}
				}
			}
		});

		const result = buildSchemaDepsTree(graph, 'A');
		expect(result.tree?.children).toHaveLength(1);
		const b = result.tree?.children[0];
		expect(b?.schemaName).toBe('B');
		expect(b?.children.some((c) => c.schemaName === 'A' && c.isBackEdge)).toBe(true);
	});

	it('showAllSchemas appends orphans under the root tree', () => {
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

		const result = buildSchemaDepsTree(graph, 'Root', true);
		const names = flattenSchemaDepsTree(result.tree).map((n) => n.schemaName);
		expect(names).toContain('Orphan');
	});
});
