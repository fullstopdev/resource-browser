import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
	buildPathBrowserData,
	findOperationByDeepLinkId,
	getOperationDeepLinkId,
	UNTAGGED_LABEL
} from './pathBrowser';
import { createSchemaResolver } from './schemaResolver';
import { CIRCULAR_REF_MARKER, resolveSchemaNode } from './schemaBrowser';

describe('native path browser helpers', () => {
	it('groups operations by primary tag only', () => {
		const spec = {
			paths: {
				'/multi': {
					get: {
						summary: 'Multi tag',
						tags: ['alpha', 'beta'],
						responses: { '200': { description: 'OK' } }
					}
				},
				'/none': {
					post: {
						summary: 'No tags',
						responses: { '200': { description: 'OK' } }
					}
				}
			}
		};

		const data = buildPathBrowserData(spec);
		expect(data.tagGroups).toHaveLength(2);
		expect(data.tagGroups.find((g) => g.name === 'alpha')?.operations).toHaveLength(1);
		expect(data.tagGroups.find((g) => g.name === UNTAGGED_LABEL)?.operations).toHaveLength(1);
		expect(data.tagGroups.find((g) => g.name === 'beta')).toBeUndefined();
	});

	it('finds operations by operationId for deep links', () => {
		const spec = {
			paths: {
				'/demo': {
					get: {
						operationId: 'listDemo',
						summary: 'List demo',
						responses: { '200': { description: 'OK' } }
					}
				}
			}
		};
		const ops = buildPathBrowserData(spec).tagGroups.flatMap((g) => g.operations);
		const match = findOperationByDeepLinkId(ops, 'listDemo');
		expect(match?.operationId).toBe('listDemo');
		expect(getOperationDeepLinkId(match!)).toBe('listDemo');
	});

	it('filters by operationId without matching path', () => {
		const coreSpecPath = path.join(process.cwd(), 'static/openapi/26.4.3/core/core.json');
		const coreSpec = JSON.parse(fs.readFileSync(coreSpecPath, 'utf8')) as Record<string, unknown>;
		const ops = buildPathBrowserData(coreSpec).tagGroups.flatMap((g) => g.operations);
		const match = findOperationByDeepLinkId(ops, 'queryGetEqlQuery');
		expect(match).toBeDefined();
		expect(match?.path).toBe('/core/query/v1/eql');
	});

	it('marks circular and unresolved $ref in resolved schemas', () => {
		const spec = {
			components: {
				schemas: {
					Node: {
						type: 'object',
						properties: {
							child: { $ref: '#/components/schemas/Node' },
							missing: { $ref: '#/components/schemas/Missing' }
						}
					}
				}
			}
		};

		const cyclic = resolveSchemaNode(
			spec,
			{ $ref: '#/components/schemas/Node' },
			new Set(['Node'])
		);
		expect(cyclic.description).toBe(CIRCULAR_REF_MARKER);

		const resolver = createSchemaResolver(spec);
		const tree = resolver.buildTree({ $ref: '#/components/schemas/Node' });
		const missing = tree.find((n) => n.name === 'missing');
		expect(missing?.description).toContain('unresolved reference:');
	});
});
