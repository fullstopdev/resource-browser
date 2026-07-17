import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { classifySchemaName, extractKindFromSchemaName } from './schemaPresentation';
import {
	buildInlineSchemaTree,
	buildSchemaExplorer,
	buildSchemaRefGraph,
	buildSchemaSummaries,
	countNestedSchemaEntries,
	createSchemaExplorerHydrator,
	describeAdditionalProperties,
	describeSchemaType,
	filterSchemaExplorer,
	flattenSchemaExplorer,
	getSchemaExplorerPath,
	groupSchemaExplorer,
	isTopLevelSchema,
	jsonSchemaToRenderTree,
	listSchemaNames,
	openApiComponentToRenderSchema,
	schemaConstraints,
	splitSpecStatusSections
} from './schemaBrowser';

describe('schemaPresentation', () => {
	it('classifies CRD and internal schemas', () => {
		expect(classifySchemaName('com.nokia.eda.core.v1.Alarm').category).toBe('crd');
		expect(classifySchemaName('com.nokia.eda.core.v1.Alarm').label).toBe('Alarm');
		expect(classifySchemaName('com.nokia.eda.core.v1.Alarm_metadata').isInternal).toBe(true);
		expect(classifySchemaName('com.nokia.eda.core.v1.AlarmList').category).toBe('crd-list');
		expect(extractKindFromSchemaName('com.nokia.eda.core.v1.Alarm_metadata')).toBe('Alarm');
	});

	it('classifies flat core.json API models separately from CRDs', () => {
		expect(classifySchemaName('QueryResponse').category).toBe('query');
		expect(classifySchemaName('QueryResponse').isQueryRelated).toBe(true);
		expect(classifySchemaName('QueryFieldPath').category).toBe('query');
		expect(classifySchemaName('QueryWhereParsed').category).toBe('query');
		expect(classifySchemaName('CompletionsQuery').category).toBe('query');
		expect(classifySchemaName('AutoCompleteRequest').category).toBe('query');
		expect(classifySchemaName('AutoCompleteRequest').isQueryRelated).toBe(true);
		expect(classifySchemaName('LabelCompletionResponse').category).toBe('query');
		expect(classifySchemaName('CheckAccessRequest').category).toBe('core-api');
		expect(classifySchemaName('CheckAccessResponse').category).toBe('core-api');
		expect(classifySchemaName('AccessQuery').category).toBe('core-api');
		expect(classifySchemaName('mergeRequest').category).toBe('core-api');
		expect(classifySchemaName('dbGetResult').category).toBe('core-api');
		expect(classifySchemaName('ErrorResponse').category).toBe('shared');
		expect(classifySchemaName('Metadata').category).toBe('shared');
		expect(classifySchemaName('TopoOverlayAttrQuery').category).toBe('core-api');
		expect(classifySchemaName('TopoOverlayAttrQuery').isQueryRelated).toBe(false);
		expect(extractKindFromSchemaName('QueryResponse')).toBeNull();
	});
});

describe('schemaBrowser', () => {
	it('lists and summarizes component schemas', () => {
		const spec = {
			components: {
				schemas: {
					QueryResponse: {
						type: 'object',
						description: 'Query result payload',
						required: ['items'],
						properties: {
							items: { type: 'array', items: { type: 'string' } },
							total: { type: 'integer', format: 'int64' }
						}
					},
					Status: { type: 'string', enum: ['ok', 'error'] }
				}
			}
		};

		expect(listSchemaNames(spec)).toEqual(['QueryResponse', 'Status']);

		const summaries = buildSchemaSummaries(spec);
		expect(summaries).toHaveLength(2);
		expect(summaries[0]?.name).toBe('QueryResponse');
		expect(summaries[0]?.properties).toEqual([
			{
				name: 'items',
				type: 'array<string>',
				required: true,
				description: ''
			},
			{
				name: 'total',
				type: 'integer (int64)',
				required: false,
				description: ''
			}
		]);
	});

	it('describes refs and compositions', () => {
		expect(describeSchemaType({ $ref: '#/components/schemas/QueryResponse' })).toBe(
			'QueryResponse'
		);
		expect(
			describeSchemaType({
				oneOf: [{ type: 'string' }, { $ref: '#/components/schemas/Status' }]
			})
		).toBe('oneOf (string | Status)');
	});

	it('describes map-like additionalProperties and rich oneOf branches', () => {
		expect(
			describeSchemaType({
				type: 'object',
				additionalProperties: { type: 'string' }
			})
		).toBe('map<string, string>');

		expect(
			describeSchemaType({
				type: 'object',
				additionalProperties: { $ref: '#/components/schemas/AccessQuery' }
			})
		).toBe('map<string, AccessQuery>');

		expect(
			describeSchemaType({
				type: 'object',
				properties: { name: { type: 'string' } },
				additionalProperties: { type: 'string' }
			})
		).toBe('object (+map<string, string>)');

		expect(describeSchemaType({ type: 'object', additionalProperties: true })).toBe(
			'map<string, any>'
		);

		expect(
			describeSchemaType({
				oneOf: [
					{ type: 'string' },
					{ type: 'number' },
					{ type: 'boolean' },
					{ type: 'array', items: {} },
					{ type: 'object' }
				]
			})
		).toBe('oneOf (string | number | boolean | array | object)');

		expect(describeAdditionalProperties({ type: 'integer' })).toBe('map<string, integer>');
	});

	it('expands oneOf variants and additionalProperties in schema trees', () => {
		const patchValue = buildInlineSchemaTree(
			{},
			{
				oneOf: [
					{ type: 'string' },
					{ type: 'number' },
					{ type: 'boolean' },
					{ type: 'array', items: {} },
					{ type: 'object' }
				]
			}
		);
		expect(patchValue.map((n) => n.name)).toEqual([
			'[oneOf 0]',
			'[oneOf 1]',
			'[oneOf 2]',
			'[oneOf 3]',
			'[oneOf 4]'
		]);
		expect(patchValue.map((n) => n.type)).toEqual([
			'string',
			'number',
			'boolean',
			'array',
			'object'
		]);

		const annotations = buildInlineSchemaTree(
			{},
			{
				type: 'object',
				additionalProperties: { type: 'string' }
			}
		);
		expect(annotations).toHaveLength(1);
		expect(annotations[0]?.name).toBe('[additionalProperties]');
		expect(annotations[0]?.type).toBe('string');

		const nestedMap = buildInlineSchemaTree(
			{
				components: {
					schemas: {
						Wrapper: {
							type: 'object',
							properties: {
								labels: {
									type: 'object',
									additionalProperties: { type: 'string' }
								},
								value: {
									oneOf: [{ type: 'string' }, { type: 'number' }]
								}
							}
						}
					}
				}
			},
			{ $ref: '#/components/schemas/Wrapper' }
		);
		const labels = nestedMap.find((n) => n.name === 'labels');
		expect(labels?.type).toBe('map<string, string>');
		expect(labels?.children.map((c) => c.name)).toEqual(['[additionalProperties]']);
		const value = nestedMap.find((n) => n.name === 'value');
		expect(value?.type).toBe('oneOf (string | number)');
		expect(value?.children.map((c) => c.name)).toEqual(['[oneOf 0]', '[oneOf 1]']);
	});

	it('builds nested schema explorer trees from spec descriptions', () => {
		const spec = {
			components: {
				schemas: {
					QueryResponse: {
						type: 'object',
						required: ['items'],
						properties: {
							items: { type: 'array', items: { type: 'string' } },
							meta: { $ref: '#/components/schemas/Meta' }
						}
					},
					Meta: {
						type: 'object',
						properties: {
							total: { type: 'integer', minimum: 0 }
						}
					}
				}
			}
		};

		const entries = buildSchemaExplorer(spec, { eagerProperties: true });
		const query = entries.find((e) => e.name === 'QueryResponse');
		expect(query?.properties.some((p) => p.path === 'QueryResponse.items')).toBe(true);
		expect(query?.properties.find((p) => p.name === 'items')?.children).toHaveLength(1);

		const meta = query?.nestedEntries?.find((e) => e.name === 'Meta');
		expect(meta).toBeDefined();
		expect(meta?.isNested).toBe(true);
		expect(flattenSchemaExplorer(entries)).toHaveLength(2);
		expect(getSchemaExplorerPath(entries, 'Meta').map((e) => e.name)).toEqual([
			'QueryResponse',
			'Meta'
		]);
		expect(countNestedSchemaEntries(query!)).toBe(1);

		expect(schemaConstraints({ type: 'integer', minimum: 0, maximum: 100 })).toEqual([
			'min: 0',
			'max: 100'
		]);

		expect(schemaConstraints({ type: 'string', readOnly: true, format: 'date-time' })).toEqual([
			'format: date-time',
			'readOnly'
		]);

		expect(filterSchemaExplorer(entries, 'QueryResponse.meta')).toHaveLength(1);
		expect(filterSchemaExplorer(entries, 'Meta.total').map((e) => e.name).sort()).toEqual([
			'Meta',
			'QueryResponse'
		]);
	});

	it('merges allOf properties and groups schemas', () => {
		const spec = {
			components: {
				schemas: {
					'com.nokia.eda.core.v1.Alarm': {
						type: 'object',
						description: 'Alarm CRD',
						properties: {
							spec: {
								type: 'object',
								properties: {
									severity: { type: 'string', description: 'Severity level' }
								}
							},
							metadata: { $ref: '#/components/schemas/com.nokia.eda.core.v1.Alarm_metadata' }
						}
					},
					'com.nokia.eda.core.v1.Alarm_metadata': {
						type: 'object',
						properties: { name: { type: 'string' } }
					}
				}
			}
		};

		const entries = buildSchemaExplorer(spec, { eagerProperties: true });

		const alarm = entries.find((e) => e.name === 'com.nokia.eda.core.v1.Alarm');
		expect(alarm?.presentation.label).toBe('Alarm');
		expect(alarm?.properties.find((p) => p.name === 'metadata')?.description).toBe('');

		const metadata = alarm?.nestedEntries?.find(
			(e) => e.name === 'com.nokia.eda.core.v1.Alarm_metadata'
		);
		expect(metadata?.isNested).toBe(true);

		const specNode = alarm?.properties.find((p) => p.name === 'spec');
		const severity = specNode?.children.find((c) => c.name === 'severity');
		expect(severity?.description).toBe('Severity level');

		const groups = groupSchemaExplorer(entries.filter((e) => !e.presentation.isInternal));
		expect(groups.some((g) => g.category === 'crd')).toBe(true);
	});

	it('marks readOnly properties on schema property nodes', () => {
		const spec = {
			components: {
				schemas: {
					AppStatus: {
						type: 'object',
						properties: {
							status: {
								type: 'object',
								readOnly: true,
								properties: {
									ready: { type: 'boolean', readOnly: true }
								}
							},
							spec: { type: 'object', properties: { name: { type: 'string' } } }
						}
					}
				}
			}
		};

		const entries = buildSchemaExplorer(spec, { eagerProperties: true });
		const app = entries.find((e) => e.name === 'AppStatus');
		const status = app?.properties.find((p) => p.name === 'status');
		expect(status?.readOnly).toBe(true);
		expect(status?.constraints).toContain('readOnly');
		expect(status?.children.find((c) => c.name === 'ready')?.readOnly).toBe(true);
		expect(app?.properties.find((p) => p.name === 'spec')?.readOnly).toBe(false);
	});

	it('captures property and schema x-eda-nokia-com extensions', () => {
		const spec = {
			components: {
				schemas: {
					AuthProvider: {
						type: 'object',
						'x-eda-nokia-com': {
							'ui-title': 'Auth Provider',
							'ui-order-priority': 1
						},
						properties: {
							name: {
								type: 'string',
								'x-eda-nokia-com': {
									immutable: true,
									'ui-title': 'Name',
									'ui-title-key': 'name'
								}
							}
						}
					}
				}
			}
		};

		const entries = buildSchemaExplorer(spec, { eagerProperties: true });
		const auth = entries.find((e) => e.name === 'AuthProvider');
		expect(auth?.edaExtension?.['ui-title']).toBe('Auth Provider');
		expect(auth?.extensions[0]?.key).toBe('x-eda-nokia-com');

		const name = auth?.properties.find((p) => p.name === 'name');
		expect(name?.edaExtension?.immutable).toBe(true);
		expect(name?.extensions[0]?.fields.map((f) => f.key)).toEqual([
			'immutable',
			'ui-title',
			'ui-title-key'
		]);

		expect(filterSchemaExplorer(entries, 'ui-title')).toHaveLength(1);
	});

	it('converts OpenAPI schemas to Render/Tree format with spec/status split', () => {
		const spec = {
			components: {
				schemas: {
					AuthProvider: {
						type: 'object',
						properties: {
							name: { type: 'string' },
							issuer: { type: 'string' }
						},
						required: ['name']
					},
					'com.nokia.eda.core.v1.Alarm': {
						type: 'object',
						properties: {
							spec: {
								type: 'object',
								properties: {
									severity: { type: 'string', description: 'Severity level' }
								}
							},
							status: {
								type: 'object',
								properties: {
									state: { type: 'string' }
								}
							}
						}
					}
				}
			}
		};

		const auth = openApiComponentToRenderSchema(spec, 'AuthProvider');
		expect(auth?.type).toBe('object');
		if (auth?.type === 'object') {
			expect(Object.keys(auth.properties)).toEqual(['issuer', 'name']);
			expect(auth.required).toEqual(['name']);
		}

		const alarm = openApiComponentToRenderSchema(spec, 'com.nokia.eda.core.v1.Alarm');
		expect(alarm).not.toBeNull();
		const sections = splitSpecStatusSections(alarm!);
		expect(sections.spec?.type).toBe('object');
		expect(sections.status?.type).toBe('object');
		if (sections.spec?.type === 'object') {
			expect(sections.spec.properties.severity?.description).toBe('Severity level');
		}

		const resolved = jsonSchemaToRenderTree(spec, {
			$ref: '#/components/schemas/AuthProvider'
		});
		expect(resolved.type).toBe('object');
	});

	it('groups core.json schemas into query, shared, and core-api categories', () => {
		const coreSpecPath = path.join(
			process.cwd(),
			'static/openapi/26.4.3/core/core.json'
		);
		const coreSpec = JSON.parse(fs.readFileSync(coreSpecPath, 'utf8')) as Record<
			string,
			unknown
		>;
		const entries = buildSchemaExplorer(coreSpec, { eagerProperties: true });
		const flat = flattenSchemaExplorer(entries);
		const graph = buildSchemaRefGraph(coreSpec);
		const groups = groupSchemaExplorer(entries.filter((e) => !e.presentation.isInternal));
		const queryGroup = groups.find((g) => g.category === 'query');
		const sharedGroup = groups.find((g) => g.category === 'shared');
		const coreApiGroup = groups.find((g) => g.category === 'core-api');

		expect(entries).toHaveLength(93);
		expect(flat).toHaveLength(198);
		expect(flat.filter((e) => !isTopLevelSchema(e.name, graph))).toHaveLength(105);

		expect(queryGroup?.entries.length).toBe(12);
		expect(flat.filter((e) => e.presentation.category === 'query').length).toBe(27);
		expect(queryGroup?.entries.some((e) => e.name === 'QueryResponse')).toBe(true);
		expect(queryGroup?.entries.some((e) => e.name === 'QueryFieldPath')).toBe(false);
		expect(
			findNestedEntry(queryGroup?.entries ?? [], 'QueryFieldPath')?.name
		).toBe('QueryFieldPath');
		expect(queryGroup?.entries.some((e) => e.name === 'AutoCompleteRequest')).toBe(true);
		expect(queryGroup?.entries.some((e) => e.name === 'LabelCompletionResponse')).toBe(true);
		expect(queryGroup?.entries.some((e) => e.name === 'TopoOverlayAttrQuery')).toBe(false);
		expect(queryGroup?.entries.some((e) => e.name === 'AccessQuery')).toBe(false);

		expect(sharedGroup?.entries.some((e) => e.name === 'ErrorResponse')).toBe(true);
		expect(sharedGroup?.entries.some((e) => e.name === 'Metadata')).toBe(false);
		expect(findNestedEntry(flat, 'Metadata')?.presentation.category).toBe('shared');
		expect(sharedGroup?.entries.some((e) => e.name === 'GroupVersionKind')).toBe(false);
		expect(findNestedEntry(flat, 'GroupVersionKind')?.presentation.category).toBe('shared');

		expect(coreApiGroup?.entries.some((e) => e.name === 'CheckAccessRequest')).toBe(true);
		expect(coreApiGroup?.entries.some((e) => e.name === 'AccessQuery')).toBe(false);
		expect(
			findNestedEntry(coreApiGroup?.entries ?? [], 'AccessQuery')?.presentation.category
		).toBe('core-api');
		expect(coreApiGroup?.entries.some((e) => e.name === 'mergeRequest')).toBe(true);
		expect(coreApiGroup?.entries.some((e) => e.name === 'dbGetResult')).toBe(true);
		expect(coreApiGroup?.entries.some((e) => e.name === 'TopoOverlayAttrQuery')).toBe(false);
		expect(
			findNestedEntry(flat.filter((e) => e.presentation.category === 'core-api'), 'TopoOverlayAttrQuery')
		).toBeDefined();
		expect(coreApiGroup?.entries.some((e) => e.name === 'ErrorResponse')).toBe(false);
		expect(groups.find((g) => g.category === 'crd')?.entries.length ?? 0).toBe(0);
		expect(groups.find((g) => g.category === 'other')?.entries.length ?? 0).toBe(0);
	});

	function findNestedEntry(
		entries: ReturnType<typeof buildSchemaExplorer>,
		name: string
	) {
		return flattenSchemaExplorer(entries).find((entry) => entry.name === name);
	}

	it('lazy explorer hydrates properties on demand', () => {
		const spec = {
			components: {
				schemas: {
					QueryResponse: {
						type: 'object',
						properties: {
							items: { type: 'array', items: { type: 'string' } }
						}
					}
				}
			}
		};

		const entries = buildSchemaExplorer(spec);
		expect(entries[0]?.properties).toEqual([]);

		const hydrator = createSchemaExplorerHydrator(spec);
		const hydrated = hydrator.hydrate(entries[0]!);
		expect(hydrated.properties.some((p) => p.name === 'items')).toBe(true);
		expect(filterSchemaExplorer(entries, 'items', hydrator)).toHaveLength(1);
	});

	it('includes every component schema in grouped explorer output', () => {
		for (const relativePath of [
			'static/openapi/26.4.3/core/core.json',
			'static/openapi/26.4.3/apps/filters.eda.nokia.com/v1/filters.json'
		]) {
			const specPath = path.join(process.cwd(), relativePath);
			const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as Record<string, unknown>;
			const names = listSchemaNames(spec);
			const entries = buildSchemaExplorer(spec, { eagerProperties: true });
			const flat = flattenSchemaExplorer(entries);
			const groups = groupSchemaExplorer(entries);
			const groupedCount = groups.reduce((total, group) => total + group.entries.length, 0);

			expect(flat).toHaveLength(names.length);
			expect(groupedCount).toBe(entries.length);
			expect(new Set(flat.map((entry) => entry.name))).toEqual(new Set(names));
		}
	});
});
