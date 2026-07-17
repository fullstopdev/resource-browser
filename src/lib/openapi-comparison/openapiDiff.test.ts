import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { filterOpenApiManifestEntriesWithPaths } from '$lib/openapi/manifestPresentation';
import type { OpenApiDiffEntry, OpenApiManifestEntry } from '$lib/openapi/types';
import {
	buildManifestDiffEntries,
	compareOpenApiManifests,
	filterOpenApiDiffEntriesWithPaths,
	openApiDiffEntryHasListedPaths,
	summarizeOpenApiEntries
} from './compareReleases';
import {
	classifyOpenApiDiffStatus,
	compareOpenApiPaths,
	compareOpenApiSchemas,
	compareOpenApiSpecs,
	humanizePathChange
} from './openapiDiff';

function loadManifest(release: string): OpenApiManifestEntry[] {
	const raw = readFileSync(
		join(process.cwd(), `static/openapi/${release}/manifest.json`),
		'utf8'
	);
	return JSON.parse(raw) as OpenApiManifestEntry[];
}

function loadSpec(release: string, file: string): Record<string, unknown> {
	const raw = readFileSync(join(process.cwd(), `static/openapi/${release}/${file}`), 'utf8');
	return JSON.parse(raw) as Record<string, unknown>;
}

describe('compareOpenApiPaths', () => {
	it('detects added endpoint', () => {
		const source = { '/foo': { get: { summary: 'A' } } };
		const target = {
			'/foo': { get: { summary: 'A' } },
			'/bar': { post: { summary: 'B', operationId: 'createBar' } }
		};
		const changes = compareOpenApiPaths(source, target);
		const added = changes.find((c) => c.changeType === 'added' && c.path === '/bar');
		expect(added).toBeTruthy();
		expect(added?.operationId).toBe('createBar');
	});

	it('detects removed endpoint', () => {
		const source = { '/foo': { get: { summary: 'A' } }, '/bar': { post: { summary: 'B' } } };
		const target = { '/foo': { get: { summary: 'A' } } };
		const changes = compareOpenApiPaths(source, target);
		expect(changes.some((c) => c.changeType === 'removed' && c.path === '/bar')).toBe(true);
	});

	it('detects modified operation by operationId/summary', () => {
		const source = { '/foo': { get: { summary: 'Old', operationId: 'getFoo' } } };
		const target = { '/foo': { get: { summary: 'New', operationId: 'getFoo' } } };
		const changes = compareOpenApiPaths(source, target);
		expect(changes.some((c) => c.changeType === 'modified' && c.operationId === 'getFoo')).toBe(
			true
		);
		const mod = changes.find((c) => c.changeType === 'modified');
		expect(mod?.details.some((d) => d.includes('~ Modified: summary ::'))).toBe(true);
	});

	it('ignores version-only operationId renames when pairing paths', () => {
		const changes = compareOpenApiPaths(
			{
				'/apps/oam.eda.nokia.com/v1alpha1/mirrors': {
					get: { operationId: 'listOamEdaNokiaComV1alpha1Mirrors' }
				}
			},
			{
				'/apps/oam.eda.nokia.com/v1/mirrors': {
					get: { operationId: 'listOamEdaNokiaComV1Mirrors' }
				}
			}
		);
		// Version-only operationId renames are noise when pairing latest→latest.
		expect(changes.filter((c) => c.changeType === 'modified')).toEqual([]);
	});

	it('ignores trailing version-only operationId and description bumps', () => {
		const changes = compareOpenApiPaths(
			{
				'/apps/aaa.eda.nokia.com/v1alpha1': {
					get: {
						operationId: 'getResourcesAaaEdaNokiaComV1alpha1',
						description: 'get UI specification for aaa.eda.nokia.com v1alpha1'
					}
				}
			},
			{
				'/apps/aaa.eda.nokia.com/v1': {
					get: {
						operationId: 'getResourcesAaaEdaNokiaComV1',
						description: 'get UI specification for aaa.eda.nokia.com v1'
					}
				}
			}
		);
		expect(changes.filter((c) => c.changeType === 'modified')).toEqual([]);
	});

	it('detects fields present on only one side without throwing', () => {
		const changes = compareOpenApiPaths(
			{
				'/foo': {
					get: { summary: 'List', operationId: 'listFoo' }
				}
			},
			{
				'/foo': {
					get: {
						summary: 'List',
						operationId: 'listFoo',
						deprecated: true,
						requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }
					}
				}
			}
		);
		expect(changes).toHaveLength(1);
		expect(changes[0]?.changeType).toBe('modified');
		expect(changes[0]?.details.some((d) => d.includes('+ Added: deprecated'))).toBe(true);
		expect(changes[0]?.details.some((d) => d.includes('+ Added: requestBody'))).toBe(true);
	});

	it('reports real parameter leaf changes, not whole-object dumps', () => {
		const changes = compareOpenApiPaths(
			{
				'/apps/x/v1alpha1/items': {
					get: {
						operationId: 'listXV1alpha1Items',
						parameters: [
							{
								name: 'labelSelector',
								in: 'query',
								description: 'old text',
								schema: { type: 'string' }
							}
						]
					}
				}
			},
			{
				'/apps/x/v1/items': {
					get: {
						operationId: 'listXV1Items',
						parameters: [
							{
								name: 'labelSelector',
								in: 'query',
								description: 'new text',
								schema: { type: 'string' }
							}
						]
					}
				}
			}
		);
		const mod = changes.find((c) => c.changeType === 'modified');
		expect(mod).toBeTruthy();
		expect(mod?.details.some((d) => d.includes('operationId'))).toBe(false);
		expect(
			mod?.details.some(
				(d) =>
					d.includes('parameters.query.labelSelector.description') &&
					d.includes('"old text"') &&
					d.includes('"new text"')
			)
		).toBe(true);
		expect(mod?.details.every((d) => !d.includes('{6 keys}') && !d.includes('{4 keys}'))).toBe(
			true
		);
	});
});

describe('compareOpenApiSchemas', () => {
	it('counts schema add/remove/modify at name level', () => {
		const { schemaChanges, schemaSummary } = compareOpenApiSchemas(
			{ Foo: { type: 'object' }, Bar: { type: 'string' } },
			{ Foo: { type: 'array' }, Baz: { type: 'number' } }
		);
		expect(schemaSummary).toEqual({ added: 1, removed: 1, modified: 1, apiVersion: 0 });
		expect(schemaChanges.some((l) => l.includes('Baz'))).toBe(true);
		expect(schemaChanges.some((l) => l.includes('Bar'))).toBe(true);
		expect(schemaChanges.some((l) => l.includes('Foo'))).toBe(true);
		expect(
			schemaChanges.some((l) => l.includes('~ Modified: type :: "object" → "array"'))
		).toBe(true);
	});

	it('pairs schemas across API version renames instead of add+remove', () => {
		const { schemaChanges, schemaSummary } = compareOpenApiSchemas(
			{
				'com.nokia.eda.filters.v1alpha1.Filter': {
					type: 'object',
					properties: { name: { type: 'string' } }
				},
				'com.nokia.eda.filters.v1alpha1.FilterList': { type: 'object' },
				ErrorIndex: { type: 'integer' }
			},
			{
				'com.nokia.eda.filters.v1.Filter': {
					type: 'object',
					properties: { name: { type: 'string' } }
				},
				'com.nokia.eda.filters.v1.FilterList': { type: 'object' },
				'com.nokia.eda.filters.v1.NewThing': { type: 'string' }
			}
		);
		expect(schemaSummary.added).toBe(1);
		expect(schemaSummary.removed).toBe(1);
		expect(schemaSummary.modified).toBe(0);
		expect(schemaSummary.apiVersion).toBe(2);
		expect(
			schemaChanges.filter((l) => l.startsWith('~ API version schema:')).length
		).toBe(2);
		expect(schemaChanges.some((l) => l.includes('v1alpha1.Filter →') && l.includes('v1.Filter'))).toBe(
			true
		);
		expect(schemaChanges.some((l) => l.includes('NewThing'))).toBe(true);
		expect(schemaChanges.some((l) => l.includes('ErrorIndex'))).toBe(true);
	});

	it('treats versioned $ref-only differences as equal', () => {
		const { schemaSummary, schemaChanges } = compareOpenApiSchemas(
			{
				'com.nokia.eda.filters.v1alpha1.Filter': {
					$ref: '#/components/schemas/com.nokia.eda.filters.v1alpha1.Filter_metadata'
				}
			},
			{
				'com.nokia.eda.filters.v1.Filter': {
					$ref: '#/components/schemas/com.nokia.eda.filters.v1.Filter_metadata'
				}
			}
		);
		expect(schemaSummary).toEqual({ added: 0, removed: 0, modified: 0, apiVersion: 1 });
		expect(schemaChanges.some((l) => l.startsWith('~ API version schema:'))).toBe(true);
	});

	it('treats standalone version string fields as rename-only noise', () => {
		const { schemaSummary, schemaChanges } = compareOpenApiSchemas(
			{
				'com.nokia.eda.x.v1alpha1.Meta': {
					properties: {
						labels: {
							'x-eda-nokia-com': {
								'ui-auto-completes': [
									{ kind: 'Foo', type: 'label', version: 'v1alpha1' }
								]
							}
						}
					}
				}
			},
			{
				'com.nokia.eda.x.v1.Meta': {
					properties: {
						labels: {
							'x-eda-nokia-com': {
								'ui-auto-completes': [{ kind: 'Foo', type: 'label', version: 'v1' }]
							}
						}
					}
				}
			}
		);
		expect(schemaSummary).toEqual({ added: 0, removed: 0, modified: 0, apiVersion: 1 });
		expect(schemaChanges.some((l) => l.startsWith('~ API version schema:'))).toBe(true);
		expect(schemaChanges.some((l) => l.includes('Modified schema'))).toBe(false);
	});

	it('emits CRD-style leaf diffs for real schema content changes', () => {
		const { schemaChanges, schemaSummary } = compareOpenApiSchemas(
			{
				'com.nokia.eda.interfaces.v1alpha1.Breakout': {
					type: 'object',
					properties: {
						apiVersion: {
							type: 'string',
							default: 'interfaces.eda.nokia.com/v1alpha1'
						},
						spec: {
							type: 'object',
							properties: {
								interface: { type: 'string' },
								node: { type: 'string' }
							}
						}
					}
				}
			},
			{
				'com.nokia.eda.interfaces.v1.Breakout': {
					type: 'object',
					properties: {
						apiVersion: {
							type: 'string',
							default: 'interfaces.eda.nokia.com/v1'
						},
						spec: {
							type: 'object',
							properties: {
								interfaces: { type: 'array' },
								nodes: { type: 'array' }
							}
						}
					}
				}
			}
		);
		expect(schemaSummary).toEqual({ added: 0, removed: 0, modified: 1, apiVersion: 0 });
		expect(schemaChanges.some((l) => l === '~ Modified schema: com.nokia.eda.interfaces.v1.Breakout')).toBe(
			true
		);
		// Version-only apiVersion.default must not appear as a leaf change.
		expect(schemaChanges.some((l) => l.includes('apiVersion.default'))).toBe(false);
		// Opaque rename row must not appear.
		expect(schemaChanges.some((l) => l.includes('v1alpha1.Breakout →'))).toBe(false);
		expect(schemaChanges.some((l) => l.includes('{') && l.includes('keys}'))).toBe(false);
		expect(
			schemaChanges.some(
				(l) => l.includes('+ Added: properties.spec.properties.interfaces') || l.includes('interfaces')
			)
		).toBe(true);
		expect(
			schemaChanges.some((l) => l.includes('- Removed: properties.spec.properties.interface'))
		).toBe(true);
	});

	it('expands enum value deltas instead of [N items] → [N items]', () => {
		const { schemaChanges, schemaSummary } = compareOpenApiSchemas(
			{
				'com.nokia.eda.aaa.v1alpha1.NodeGroup': {
					type: 'object',
					properties: {
						spec: {
							properties: {
								services: {
									items: {
										type: 'string',
										enum: [
											'CLI',
											'FTP',
											'GNMI',
											'GNOI',
											'GNSI',
											'GRIBI',
											'Reflection',
											'JSON-RPC',
											'NETCONF'
										]
									}
								}
							}
						}
					}
				}
			},
			{
				'com.nokia.eda.aaa.v1.NodeGroup': {
					type: 'object',
					properties: {
						spec: {
							properties: {
								services: {
									items: {
										type: 'string',
										enum: [
											'CLI',
											'FTP',
											'GNMI',
											'GNOI',
											'GNSI',
											'GRIBI',
											'Reflection',
											'JSONRPC',
											'NETCONF'
										]
									}
								}
							}
						}
					}
				}
			}
		);
		expect(schemaSummary).toEqual({ added: 0, removed: 0, modified: 1, apiVersion: 0 });
		const enumLine = schemaChanges.find((l) => l.includes('.enum'));
		expect(enumLine).toBeTruthy();
		expect(enumLine).not.toMatch(/\[\d+ items\]/);
		expect(enumLine).toContain('JSON-RPC');
		expect(enumLine).toContain('JSONRPC');
	});

	it('summarizes removed schema properties with type/$ref, not {N keys}', () => {
		const { schemaChanges, schemaSummary } = compareOpenApiSchemas(
			{
				ErrorResponse: {
					type: 'object',
					properties: {
						code: {
							deprecated: true,
							description: 'numeric HTTP error code',
							format: 'int64',
							type: 'integer'
						},
						errors: {
							deprecated: true,
							description: 'collection of errors',
							items: { $ref: '#/components/schemas/ErrorResponse' },
							type: 'array'
						},
						message: { type: 'string' }
					}
				}
			},
			{
				ErrorResponse: {
					type: 'object',
					properties: {
						message: { type: 'string' }
					}
				}
			}
		);
		expect(schemaSummary).toEqual({ added: 0, removed: 0, modified: 1, apiVersion: 0 });
		expect(schemaChanges.some((l) => /\{\d+ keys\}/.test(l))).toBe(false);
		expect(
			schemaChanges.some(
				(l) =>
					l.includes('- Removed: properties.code') &&
					l.includes('integer') &&
					l.includes('format:int64')
			)
		).toBe(true);
		expect(
			schemaChanges.some(
				(l) =>
					l.includes('- Removed: properties.errors') &&
					l.includes('array') &&
					l.includes('$ref:ErrorResponse')
			)
		).toBe(true);
	});
});

describe('compareOpenApiPaths version pairing', () => {
	it('pairs /v1alpha1/ and /v1/ paths as the same endpoint', () => {
		const changes = compareOpenApiPaths(
			{
				'/apps/filters.eda.nokia.com/v1alpha1/filters': {
					get: { operationId: 'listFilters', summary: 'List' }
				}
			},
			{
				'/apps/filters.eda.nokia.com/v1/filters': {
					get: { operationId: 'listFilters', summary: 'List' }
				}
			}
		);
		expect(changes).toEqual([]);
	});
});

describe('filters 25.12.3 → 26.4.3 schema cleanliness', () => {
	it('does not flood add/remove for version-bumped package schemas', () => {
		const source = loadManifest('25.12.3').find((e) => e.id === 'filters.eda.nokia.com/v1alpha1');
		const target = loadManifest('26.4.3').find((e) => e.id === 'filters.eda.nokia.com/v1');
		expect(source && target).toBeTruthy();
		if (!source || !target) return;
		const { schemaSummary, schemaChanges, pathChanges } = compareOpenApiSpecs(
			loadSpec('25.12.3', source.file),
			loadSpec('26.4.3', target.file)
		);
		expect(schemaSummary.added).toBeLessThan(15);
		expect(schemaSummary.removed).toBeLessThan(10);
		expect(schemaChanges.some((l) => l.startsWith('~ API version schema:'))).toBe(true);
		// Paths under /v1alpha1 vs /v1 should pair — not dozens of remove+add.
		const pathAdded = pathChanges.filter((c) => c.changeType === 'added').length;
		const pathRemoved = pathChanges.filter((c) => c.changeType === 'removed').length;
		expect(pathAdded + pathRemoved).toBeLessThan(pathChanges.length || 1);
	});
});

describe('interfaces 25.12.3 → 26.4.3 deep schema diffs', () => {
	it('emits leaf field changes for Breakout instead of opaque rename rows', () => {
		const source = loadManifest('25.12.3').find(
			(e) => e.id === 'interfaces.eda.nokia.com/v1alpha1'
		);
		const target = loadManifest('26.4.3').find((e) => e.id === 'interfaces.eda.nokia.com/v1');
		expect(source && target).toBeTruthy();
		if (!source || !target) return;
		const { schemaSummary, schemaChanges } = compareOpenApiSpecs(
			loadSpec('25.12.3', source.file),
			loadSpec('26.4.3', target.file)
		);

		expect(schemaSummary.removed).toBe(2); // ErrorIndex, ErrorItem
		expect(schemaSummary.added).toBe(0);
		// Version-only pairs (incl. metadata version-string noise) are version upgrades, not modified.
		expect(schemaChanges.some((l) => l.startsWith('~ API version schema:'))).toBe(true);
		expect(schemaChanges.some((l) => /API version schema:.*v1alpha1\.Breakout →/.test(l))).toBe(
			false
		);
		expect(schemaChanges.some((l) => l.includes('{') && l.includes('keys} →'))).toBe(false);

		expect(
			schemaChanges.some((l) => l === '~ Modified schema: com.nokia.eda.interfaces.v1.Breakout')
		).toBe(true);
		expect(
			schemaChanges.some((l) =>
				l.includes('- Removed: properties.spec.properties.interface')
			)
		).toBe(true);
		expect(
			schemaChanges.some((l) =>
				l.includes('+ Added: properties.spec.properties.interfaces')
			)
		).toBe(true);
		// Metadata with only version string noise must not be listed as modified.
		expect(
			schemaChanges.some((l) =>
				l.includes('Modified schema: com.nokia.eda.interfaces.v1.Breakout_metadata')
			)
		).toBe(false);

		const modifiedHeaders = schemaChanges.filter((l) => l.startsWith('~ Modified schema:'));
		expect(modifiedHeaders.length).toBe(schemaSummary.modified);
		expect(schemaSummary.modified).toBeGreaterThan(0);
		expect(schemaSummary.modified).toBeLessThan(15);
	});
});

describe('aaa 25.12.3 → 26.4.3 schema cleanliness', () => {
	it('treats AuthenticationPolicy/ServerGroup as truly new and expands NodeGroup enum', () => {
		const source = loadManifest('25.12.3').find((e) => e.id === 'aaa.eda.nokia.com/v1alpha1');
		const target = loadManifest('26.4.3').find((e) => e.id === 'aaa.eda.nokia.com/v1');
		expect(source && target).toBeTruthy();
		if (!source || !target) return;
		const { schemaSummary, schemaChanges } = compareOpenApiSpecs(
			loadSpec('25.12.3', source.file),
			loadSpec('26.4.3', target.file)
		);

		expect(schemaSummary.added).toBe(28);
		expect(schemaSummary.removed).toBe(2); // ErrorIndex, ErrorItem
		expect(schemaSummary.apiVersion).toBeGreaterThan(0);
		expect(schemaSummary.modified).toBeGreaterThan(0);
		expect(schemaChanges.some((l) => l.startsWith('~ API version schema:'))).toBe(true);
		// AAA has real content diffs — API status is Modified (version-only stays a subcategory).
		expect(
			classifyOpenApiDiffStatus([], schemaChanges, schemaSummary, { versionBumped: true })
		).toBe('modified');
		// Version subcategory: rename-only companions (e.g. NodeGroupList); content diffs stay Modified.
		expect(
			schemaChanges.some(
				(l) =>
					l.startsWith('~ API version schema:') &&
					l.includes('NodeGroupList')
			)
		).toBe(true);
		expect(schemaChanges.some((l) => l === '~ Modified schema: com.nokia.eda.aaa.v1.NodeGroup')).toBe(
			true
		);
		expect(schemaChanges.some((l) => l === '~ Modified schema: ErrorResponse')).toBe(true);
		// New resource families — not mis-paired renames.
		expect(
			schemaChanges.filter((l) => l.includes('+ Added schema:') && l.includes('AuthenticationPolicy'))
				.length
		).toBe(14);
		expect(
			schemaChanges.filter((l) => l.includes('+ Added schema:') && l.includes('ServerGroup')).length
		).toBe(14);
		// No opaque dumps / useless same-count enum summaries.
		expect(schemaChanges.every((l) => !/\{\d+ keys\}/.test(l))).toBe(true);
		expect(schemaChanges.every((l) => !(/\[\d+ items\]\s*→\s*\[\d+ items\]/.test(l)))).toBe(true);

		const enumLeaf = schemaChanges.find(
			(l) => l.includes('.enum') && (l.includes('JSON-RPC') || l.includes('JSONRPC'))
		);
		expect(enumLeaf).toBeTruthy();
		expect(enumLeaf).toContain('JSON-RPC');
		expect(enumLeaf).toContain('JSONRPC');

		const errorRemovals = schemaChanges.filter(
			(l) => l.startsWith('- Removed: properties.') && /code|details|dictionary|errors/.test(l)
		);
		expect(errorRemovals.length).toBeGreaterThan(0);
		expect(errorRemovals.every((l) => !/\{\d+ keys\}/.test(l))).toBe(true);
		expect(
			errorRemovals.some(
				(l) => l.includes('integer') || l.includes('array') || l.includes('$ref:')
			)
		).toBe(true);
	});
});

describe('compareOpenApiSpecs', () => {
	it('returns shared when specs match', () => {
		const spec = {
			paths: { '/a': { get: { summary: 'x', operationId: 'aGet' } } },
			components: { schemas: { Foo: { type: 'object' } } }
		};
		const { pathChanges, schemaChanges, schemaSummary } = compareOpenApiSpecs(spec, spec);
		expect(classifyOpenApiDiffStatus(pathChanges, schemaChanges, schemaSummary)).toBe('shared');
	});

	it('classifies path add/remove within a shared API as modified', () => {
		const source = { paths: { '/a': { get: { summary: 'x' } } }, components: { schemas: {} } };
		const target = {
			paths: {
				'/a': { get: { summary: 'x' } },
				'/b': { post: { summary: 'y' } }
			},
			components: { schemas: {} }
		};
		const { pathChanges, schemaChanges, schemaSummary } = compareOpenApiSpecs(source, target);
		expect(classifyOpenApiDiffStatus(pathChanges, schemaChanges, schemaSummary)).toBe('modified');
	});

	it('classifies version-only schema pairs as shared, not modified', () => {
		const { pathChanges, schemaChanges, schemaSummary } = compareOpenApiSpecs(
			{
				paths: {
					'/apps/x/v1alpha1/items': {
						get: { operationId: 'listXV1alpha1Items', summary: 'List' }
					}
				},
				components: {
					schemas: {
						'com.nokia.eda.x.v1alpha1.Item': {
							type: 'object',
							properties: { name: { type: 'string' } }
						}
					}
				}
			},
			{
				paths: {
					'/apps/x/v1/items': {
						get: { operationId: 'listXV1Items', summary: 'List' }
					}
				},
				components: {
					schemas: {
						'com.nokia.eda.x.v1.Item': {
							type: 'object',
							properties: { name: { type: 'string' } }
						}
					}
				}
			}
		);
		expect(schemaSummary).toEqual({ added: 0, removed: 0, modified: 0, apiVersion: 1 });
		expect(pathChanges).toEqual([]);
		expect(schemaChanges.some((l) => l.startsWith('~ API version schema:'))).toBe(true);
		expect(
			classifyOpenApiDiffStatus(pathChanges, schemaChanges, schemaSummary, {
				versionBumped: true
			})
		).toBe('shared');
	});

	it('classifies real enum changes as modified even with version bump', () => {
		const { pathChanges, schemaChanges, schemaSummary } = compareOpenApiSpecs(
			{
				paths: {},
				components: {
					schemas: {
						'com.nokia.eda.aaa.v1alpha1.NodeGroup': {
							type: 'object',
							properties: {
								spec: {
									properties: {
										services: {
											items: { type: 'string', enum: ['CLI', 'JSON-RPC'] }
										}
									}
								}
							}
						}
					}
				}
			},
			{
				paths: {},
				components: {
					schemas: {
						'com.nokia.eda.aaa.v1.NodeGroup': {
							type: 'object',
							properties: {
								spec: {
									properties: {
										services: {
											items: { type: 'string', enum: ['CLI', 'JSONRPC'] }
										}
									}
								}
							}
						}
					}
				}
			}
		);
		expect(schemaSummary.modified).toBe(1);
		expect(schemaSummary.apiVersion).toBe(0);
		expect(schemaChanges.some((l) => l.includes('.enum'))).toBe(true);
		expect(
			classifyOpenApiDiffStatus(pathChanges, schemaChanges, schemaSummary, {
				versionBumped: true
			})
		).toBe('modified');
	});
});

describe('humanizePathChange', () => {
	it('formats added endpoint with operationId', () => {
		expect(
			humanizePathChange({
				path: '/services/routers',
				method: 'POST',
				operationId: 'createRouter',
				changeType: 'added',
				details: []
			})
		).toContain('createRouter');
	});
});

describe('compareOpenApiSpecs (25.8.3 → 25.12.3)', () => {
	it('compares every shared API without throwing on asymmetric operation fields', () => {
		const source = loadManifest('25.8.3');
		const target = loadManifest('25.12.3');
		const entries = buildManifestDiffEntries(source, target).filter(
			(e) => e.sourceFile && e.targetFile
		);
		expect(entries.length).toBeGreaterThan(0);
		for (const entry of entries) {
			expect(() =>
				compareOpenApiSpecs(
					loadSpec('25.8.3', entry.sourceFile!),
					loadSpec('25.12.3', entry.targetFile!)
				)
			).not.toThrow();
		}
	});
});

describe('zero-path OpenAPI filtering', () => {
	const zero: OpenApiManifestEntry = {
		id: 'schema-only.eda.nokia.com/v1',
		title: 'Schema Only',
		group: 'schema-only.eda.nokia.com',
		apiVersion: 'v1',
		file: 'apps/schema-only.json',
		pathCount: 0,
		tags: []
	};
	const withPaths: OpenApiManifestEntry = {
		id: 'routers.eda.nokia.com/v1',
		title: 'Routers',
		group: 'routers.eda.nokia.com',
		apiVersion: 'v1',
		file: 'apps/routers.json',
		pathCount: 12,
		tags: []
	};

	it('excludes zero-path specs from compare partitioning', () => {
		const result = compareOpenApiManifests(
			[zero, withPaths],
			[
				zero,
				{ ...withPaths, pathCount: 14 },
				{
					id: 'new.eda.nokia.com/v1',
					title: 'New',
					group: 'new.eda.nokia.com',
					apiVersion: 'v1',
					file: 'apps/new.json',
					pathCount: 3,
					tags: []
				}
			]
		);
		expect(result.shared.map((s) => s.target.id)).toEqual(['routers.eda.nokia.com/v1']);
		expect(result.added.map((e) => e.id)).toEqual(['new.eda.nokia.com/v1']);
		expect(result.removed).toEqual([]);
	});

	it('shows source→target when only the target gains paths (as Added)', () => {
		const result = compareOpenApiManifests([zero], [{ ...zero, pathCount: 5 }]);
		expect(result.added.map((e) => e.id)).toEqual(['schema-only.eda.nokia.com/v1']);
		expect(result.removed).toEqual([]);
		expect(result.shared).toEqual([]);
	});

	it('filters diff rows by listed-side path count', () => {
		const entries: OpenApiDiffEntry[] = [
			{
				specId: 'a',
				title: 'A',
				group: 'a',
				status: 'added',
				pathChanges: [],
				schemaChanges: [],
				targetPathCount: 0
			},
			{
				specId: 'b',
				title: 'B',
				group: 'b',
				status: 'added',
				pathChanges: [],
				schemaChanges: [],
				targetPathCount: 4
			},
			{
				specId: 'c',
				title: 'C',
				group: 'c',
				status: 'removed',
				pathChanges: [],
				schemaChanges: [],
				sourcePathCount: 0
			},
			{
				specId: 'd',
				title: 'D',
				group: 'd',
				status: 'removed',
				pathChanges: [],
				schemaChanges: [],
				sourcePathCount: 2
			},
			{
				specId: 'e',
				title: 'E',
				group: 'e',
				status: 'shared',
				pathChanges: [],
				schemaChanges: [],
				sourcePathCount: 3,
				targetPathCount: 0
			},
			{
				specId: 'f',
				title: 'F',
				group: 'f',
				status: 'modified',
				pathChanges: [],
				schemaChanges: [],
				sourcePathCount: 1,
				targetPathCount: 2
			}
		];
		expect(entries.filter(openApiDiffEntryHasListedPaths).map((e) => e.specId)).toEqual([
			'b',
			'd',
			'f'
		]);
		expect(filterOpenApiDiffEntriesWithPaths(entries).map((e) => e.specId)).toEqual([
			'b',
			'd',
			'f'
		]);
	});

	it('omits known zero-path catalog entries from real release diffs', () => {
		const entries = buildManifestDiffEntries(loadManifest('25.12.3'), loadManifest('26.4.3'));
		const ids = new Set(entries.flatMap((e) => [e.specId, e.sourceSpecId].filter(Boolean)));
		// Still zero-path on both sides (or target-only schema dumps)
		expect(ids.has('system.eda.nokia.com/v1alpha1')).toBe(false);
		expect(ids.has('cable-map.eda.labs/v1alpha1')).toBe(false);
		expect(ids.has('gemini.eda.nokia.com/v1')).toBe(false);
		expect(ids.has('platformmetrics.eda.nokia.com/v1')).toBe(false);
		// 0 → 10 paths: surfaces as Added (target has paths)
		const certcheck = entries.find((e) => e.specId === 'certcheck.eda.nokia.com/v1alpha1');
		expect(certcheck?.status).toBe('added');
		expect(certcheck?.targetPathCount).toBe(10);
	});
});

describe('compareOpenApiManifests (25.12.3 → 26.4.3)', () => {
	const source = loadManifest('25.12.3');
	const target = loadManifest('26.4.3');
	const sourceWithPaths = filterOpenApiManifestEntriesWithPaths(source);
	const targetWithPaths = filterOpenApiManifestEntriesWithPaths(target);

	it('finds shared APIs including exact and cross-version pairs', () => {
		const result = compareOpenApiManifests(source, target);
		expect(result.shared.length).toBeGreaterThan(0);
		const sourceIds = new Set([
			...result.removed.map((e) => e.id),
			...result.shared.map((s) => s.source.id)
		]);
		const targetIds = new Set([
			...result.added.map((e) => e.id),
			...result.shared.map((s) => s.target.id)
		]);
		expect(sourceIds.size).toBe(sourceWithPaths.length);
		expect(targetIds.size).toBe(targetWithPaths.length);
		expect(sourceWithPaths.length).toBeLessThan(source.length);
		expect(targetWithPaths.length).toBeLessThan(target.length);
	});

	it('pairs API version bumps (v1alpha1 → v1) instead of remove+add', () => {
		const result = compareOpenApiManifests(source, target);
		const fabrics = result.shared.find(
			(s) =>
				s.source.id === 'fabrics.eda.nokia.com/v1alpha1' &&
				s.target.id === 'fabrics.eda.nokia.com/v1'
		);
		expect(fabrics).toBeTruthy();
		expect(result.removed.some((e) => e.id === 'fabrics.eda.nokia.com/v1alpha1')).toBe(false);
		expect(result.added.some((e) => e.id === 'fabrics.eda.nokia.com/v1')).toBe(false);

		const aaa = result.shared.find(
			(s) => s.source.id === 'aaa.eda.nokia.com/v1alpha1' && s.target.id === 'aaa.eda.nokia.com/v1'
		);
		expect(aaa).toBeTruthy();

		const protocols = result.shared.find(
			(s) =>
				s.source.id === 'protocols.eda.nokia.com/v1' && s.target.id === 'protocols.eda.nokia.com/v2'
		);
		expect(protocols).toBeTruthy();
	});

	it('builds manifest-only entries with sourceSpecId for version bumps', () => {
		const entries = buildManifestDiffEntries(source, target);
		const summary = summarizeOpenApiEntries(entries);
		expect(summary.shared).toBeGreaterThan(0);
		expect(summary.apiVersion).toBe(0);
		expect(entries.filter((e) => e.status === 'shared').every((e) => !e.detailsLoaded)).toBe(true);
		expect(entries.filter((e) => e.status === 'added' || e.status === 'removed').every((e) => e.detailsLoaded)).toBe(
			true
		);

		const fabrics = entries.find((e) => e.specId === 'fabrics.eda.nokia.com/v1');
		expect(fabrics?.sourceSpecId).toBe('fabrics.eda.nokia.com/v1alpha1');
		expect(fabrics?.status).toBe('shared');
	});

	it('for Support locators only reports description leaf change', () => {
		const source = loadManifest('25.12.3').find((e) => e.id === 'support.eda.nokia.com/v1alpha1');
		const target = loadManifest('26.4.3').find((e) => e.id === 'support.eda.nokia.com/v1');
		expect(source && target).toBeTruthy();
		if (!source || !target) return;
		const { pathChanges } = compareOpenApiSpecs(
			loadSpec('25.12.3', source.file),
			loadSpec('26.4.3', target.file)
		);
		const locators = pathChanges.find(
			(c) =>
				c.method === 'GET' &&
				c.path === '/workflows/v1/support.eda.nokia.com/v1/locators' &&
				c.changeType === 'modified'
		);
		expect(locators).toBeTruthy();
		expect(locators?.details.every((d) => !d.includes('operationId'))).toBe(true);
		expect(locators?.details.every((d) => !d.includes('{4 keys}'))).toBe(true);
		expect(
			locators?.details.some((d) => d.includes('parameters.query.labelSelector.description'))
		).toBe(true);
	});

	it('for OAM mirrors only reports real leaf changes (not operationId version rename)', () => {
		const source = loadManifest('25.12.3').find((e) => e.id === 'oam.eda.nokia.com/v1alpha1');
		const target = loadManifest('26.4.3').find((e) => e.id === 'oam.eda.nokia.com/v1');
		expect(source && target).toBeTruthy();
		if (!source || !target) return;
		const { pathChanges } = compareOpenApiSpecs(
			loadSpec('25.12.3', source.file),
			loadSpec('26.4.3', target.file)
		);
		const mirrors = pathChanges.find(
			(c) => c.method === 'GET' && c.path.endsWith('/mirrors') && c.changeType === 'modified'
		);
		expect(mirrors).toBeTruthy();
		expect(mirrors?.details.every((d) => !d.includes('operationId'))).toBe(true);
		expect(
			mirrors?.details.some((d) => d.includes('parameters.query.labelSelector.description'))
		).toBe(true);
	});

	it('detects real path/schema diffs for core when enriched', () => {
		const sourceCore = source.find((e) => e.id === 'core');
		const targetCore = target.find((e) => e.id === 'core');
		expect(sourceCore && targetCore).toBeTruthy();
		if (!sourceCore || !targetCore) return;

		const sourceSpec = loadSpec('25.12.3', sourceCore.file);
		const targetSpec = loadSpec('26.4.3', targetCore.file);
		const { pathChanges, schemaChanges, schemaSummary } = compareOpenApiSpecs(sourceSpec, targetSpec);
		const status = classifyOpenApiDiffStatus(pathChanges, schemaChanges, schemaSummary);
		expect(['modified', 'shared']).toContain(status);
		if (status === 'modified') {
			expect(pathChanges.length + schemaChanges.length).toBeGreaterThan(0);
		}
	});

	it('classifies shared version bumps after full enrichment', () => {
		const entries = buildManifestDiffEntries(source, target);
		expect(entries.filter((e) => e.status === 'shared').length).toBeGreaterThan(10);

		const enriched = entries.map((entry) => {
			if (entry.status !== 'shared' || !entry.sourceFile || !entry.targetFile) return entry;
			const { pathChanges, schemaChanges, schemaSummary } = compareOpenApiSpecs(
				loadSpec('25.12.3', entry.sourceFile),
				loadSpec('26.4.3', entry.targetFile)
			);
			const versionBumped = !!(entry.sourceSpecId && entry.sourceSpecId !== entry.specId);
			return {
				...entry,
				status: classifyOpenApiDiffStatus(pathChanges, schemaChanges, schemaSummary, {
					versionBumped
				}),
				pathChanges,
				schemaChanges,
				schemaSummary,
				detailsLoaded: true
			};
		});

		const summary = summarizeOpenApiEntries(enriched);
		expect(summary.modified).toBeGreaterThan(10);
		expect(summary.unchanged).toBe(0);

		const aaa = enriched.find((e) => e.specId === 'aaa.eda.nokia.com/v1');
		expect(aaa?.status).toBe('modified');
		expect(aaa?.schemaSummary?.modified).toBeGreaterThan(0);
		expect(aaa?.schemaSummary?.apiVersion).toBeGreaterThan(0);

		// Identical / version-only dual-present APIs stay Shared (never remapped to Modified).
		// Zero-path schema dumps are filtered out, so this release pair may have none left.
		const sharedEntry = enriched.find((e) => e.detailsLoaded && e.status === 'shared');
		if (sharedEntry) {
			expect(sharedEntry.pathChanges.length).toBe(0);
			expect(
				(sharedEntry.schemaSummary?.added ?? 0) +
					(sharedEntry.schemaSummary?.removed ?? 0) +
					(sharedEntry.schemaSummary?.modified ?? 0)
			).toBe(0);
		} else {
			expect(
				classifyOpenApiDiffStatus([], [], { added: 0, removed: 0, modified: 0, apiVersion: 2 })
			).toBe('shared');
		}
	});
});
