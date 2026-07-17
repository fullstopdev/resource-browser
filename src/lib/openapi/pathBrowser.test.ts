import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
	buildPathBrowserData,
	buildSecuritySummary,
	extractParameterTypeHints,
	filterPathBrowserOperations,
	formatMediaContentTypeBadges,
	formatOpenApiTagLabel,
	getOperationRequestInputKind,
	getOperationTagLabel,
	getSpecInfoDescription,
	groupMediaContentBySchema,
	groupParametersByLocation,
	isErrorResponseStatus,
	isPrimaryQueryParameter,
	isQueryEndpointPath,
	mergeOpenApiParameters,
	formatOperationDescriptionParagraphs,
	resolveOperationSecurity,
	shouldCollapseOperationDescription,
	shouldShowInlineParameterSchema,
	shouldShowRequestSection,
	sortParametersForDisplay,
	type OpenApiParameter
} from './pathBrowser';
describe('pathBrowser', () => {
	const spec = {
		tags: [{ name: 'coreQuery', description: 'Query APIs' }],
		paths: {
			'/core/query/v1/eql': {
				get: {
					summary: 'Query request using the EDA query language',
					operationId: 'queryGetEqlQuery',
					tags: ['coreQuery'],
					parameters: [
						{
							name: 'query',
							in: 'query',
							required: true,
							schema: { type: 'string' }
						}
					],
					responses: {
						'200': {
							description: 'OK',
							content: {
								'application/json': {
									schema: { $ref: '#/components/schemas/QueryResponse' }
								}
							}
						}
					}
				}
			},
			'/core/v1/namespaces': {
				get: {
					summary: 'List namespaces',
					tags: ['coreNamespace'],
					responses: { '200': { description: 'OK' } }
				}
			}
		}
	};

	it('detects query/EQL paths', () => {
		expect(isQueryEndpointPath('/core/query/v1/eql')).toBe(true);
		expect(isQueryEndpointPath('/core/v1/namespaces')).toBe(false);
	});

	it('builds tag groups with operation details', () => {
		const data = buildPathBrowserData(spec);
		expect(data.totalPaths).toBe(2);
		expect(data.totalOperations).toBe(2);
		expect(data.defaultExpandedTags).toEqual([]);

		const coreQuery = data.tagGroups.find((g) => g.name === 'coreQuery');
		expect(coreQuery?.operations).toHaveLength(1);
		expect(coreQuery?.operations[0]?.path).toBe('/core/query/v1/eql');
		expect(coreQuery?.operations[0]?.isQueryEndpoint).toBe(true);
		expect(coreQuery?.operations[0]?.responses[0]?.schemaRef).toBe('QueryResponse');
	});

	it('filters by path and method', () => {
		const data = buildPathBrowserData(spec);
		const all = data.tagGroups.flatMap((g) => g.operations);
		expect(filterPathBrowserOperations(all, 'eql', 'all')).toHaveLength(1);
		expect(filterPathBrowserOperations(all, '', 'get')).toHaveLength(2);
		expect(filterPathBrowserOperations(all, 'namespace', 'get')).toHaveLength(1);
	});

	it('parses vendor extensions, deprecated flags, and response content', () => {
		const extended = {
			paths: {
				'/demo': {
					'x-eda-nokia-com': { 'ui-title': 'Demo path' },
					get: {
						summary: 'Demo',
						deprecated: true,
						'x-custom': { flag: true },
						externalDocs: { url: 'https://example.com/docs', description: 'Docs' },
						parameters: [
							{
								name: 'id',
								in: 'query',
								schema: { type: 'string', example: 'abc' },
								'x-eda-nokia-com': { 'ui-title': 'Identifier' }
							}
						],
						responses: {
							'200': {
								description: 'OK',
								headers: {
									'X-Trace': { schema: { type: 'string' }, description: 'Trace id' }
								},
								content: {
									'application/json': {
										schema: { $ref: '#/components/schemas/Demo' }
									},
									'text/plain': { schema: { type: 'string' } }
								}
							}
						}
					}
				}
			}
		};

		const data = buildPathBrowserData(extended);
		const op = data.tagGroups.flatMap((g) => g.operations)[0];
		expect(op?.deprecated).toBe(true);
		expect(op?.externalDocs?.url).toBe('https://example.com/docs');
		expect(op?.pathExtensions[0]?.key).toBe('x-eda-nokia-com');
		expect(op?.extensions[0]?.key).toBe('x-custom');
		expect(op?.parameters[0]?.example).toBe('abc');
		expect(op?.parameters[0]?.examples[0]?.formatted).toBe('abc');
		expect(op?.parameters[0]?.schema?.type).toBe('string');
		expect(op?.parameters[0]?.extensions[0]?.fields[0]?.key).toBe('ui-title');
		expect(op?.responses[0]?.content).toHaveLength(2);
		expect(op?.responses[0]?.content[0]?.schemaRef).toBe('Demo');
		expect(op?.responses[0]?.headers[0]?.name).toBe('X-Trace');
		expect(op?.responses[0]?.headers[0]?.schema?.type).toBe('string');
	});

	it('preserves full schema objects on parameters and responses', () => {
		const withSchemas = {
			components: {
				schemas: {
					QueryResponse: {
						type: 'object',
						properties: {
							results: { type: 'array', items: { type: 'string' } }
						}
					}
				}
			},
			paths: {
				'/core/query/v1/eql': {
					get: {
						parameters: [
							{ name: 'query', in: 'query', schema: { type: 'string' } }
						],
						responses: {
							'200': {
								content: {
									'application/json': {
										schema: { $ref: '#/components/schemas/QueryResponse' }
									}
								}
							}
						}
					}
				}
			}
		};

		const data = buildPathBrowserData(withSchemas);
		const op = data.tagGroups.flatMap((g) => g.operations)[0];
		expect(op?.parameters[0]?.schema?.type).toBe('string');
		expect(op?.responses[0]?.content[0]?.schema?.$ref).toContain('QueryResponse');
		expect(op?.requestBody?.content).toBeUndefined();
	});

	it('dedupes path-, operation-, and global-level parameters by (in, name)', () => {
		const withOverlap = {
			parameters: [{ name: 'Accept', in: 'header', schema: { type: 'string' } }],
			paths: {
				'/items/{id}': {
					parameters: [
						{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
						{ name: 'limit', in: 'query', schema: { type: 'integer' } }
					],
					get: {
						parameters: [
							{
								name: 'id',
								in: 'path',
								required: true,
								schema: { type: 'string', format: 'uuid' }
							},
							{ name: 'offset', in: 'query', schema: { type: 'integer' } },
							{ name: 'Accept', in: 'header', schema: { type: 'string', enum: ['application/json'] } }
						],
						responses: { '200': { description: 'OK' } }
					}
				}
			}
		};

		const data = buildPathBrowserData(withOverlap);
		const op = data.tagGroups.flatMap((g) => g.operations)[0];
		expect(op?.parameters).toHaveLength(4);
		expect(op?.parameters.map((p) => `${p.in}:${p.name}`)).toEqual([
			'header:Accept',
			'path:id',
			'query:limit',
			'query:offset'
		]);
		expect(op?.parameters.find((p) => p.in === 'path')?.schema?.format).toBe('uuid');
		expect(op?.parameters.find((p) => p.name === 'Accept')?.schema?.enum).toEqual([
			'application/json'
		]);
	});

	it('groups parameters by location for sectioned rendering', () => {
		const params: OpenApiParameter[] = [
			{
				name: 'query',
				in: 'query',
				required: true,
				description: '',
				type: 'string',
				deprecated: false,
				examples: [],
				typeHints: [],
				extensions: []
			},
			{
				name: 'X-Trace',
				in: 'header',
				required: false,
				description: '',
				type: 'string',
				deprecated: false,
				examples: [],
				typeHints: [],
				extensions: []
			}
		];

		expect(groupParametersByLocation(params).map((g) => g.label)).toEqual([
			'Query parameters',
			'Header parameters'
		]);
	});

	it('hides inline schema blocks for simple scalars including enum/format hints', () => {
		const scalar: OpenApiParameter = {
			name: 'query',
			in: 'query',
			required: true,
			description: '',
			type: 'string',
			schema: { type: 'string' },
			deprecated: false,
			examples: [],
			typeHints: [],
			extensions: []
		};
		const withEnum: OpenApiParameter = {
			name: 'filter',
			in: 'query',
			required: false,
			description: '',
			type: 'enum (a, b)',
			schema: { type: 'string', enum: ['a', 'b'] },
			deprecated: false,
			examples: [],
			typeHints: ['enum: a | b'],
			extensions: []
		};
		const withObject: OpenApiParameter = {
			name: 'body',
			in: 'query',
			required: false,
			description: '',
			type: 'object',
			schema: { type: 'object', properties: { a: { type: 'string' } } },
			deprecated: false,
			examples: [],
			typeHints: [],
			extensions: []
		};

		expect(shouldShowInlineParameterSchema(scalar)).toBe(false);
		expect(shouldShowInlineParameterSchema(withEnum)).toBe(false);
		expect(shouldShowInlineParameterSchema(withObject)).toBe(true);
	});

	it('mergeOpenApiParameters prefers later layers on conflict', () => {
		const base = [
			{
				name: 'query',
				in: 'query',
				required: false,
				description: 'path',
				type: 'string',
				deprecated: false,
				examples: [],
				typeHints: [],
				extensions: []
			}
		];
		const override = [
			{
				name: 'query',
				in: 'query',
				required: true,
				description: 'operation',
				type: 'string',
				deprecated: false,
				examples: [],
				typeHints: [],
				extensions: []
			}
		];

		const merged = mergeOpenApiParameters(base, override);
		expect(merged).toHaveLength(1);
		expect(merged[0]?.required).toBe(true);
		expect(merged[0]?.description).toBe('operation');
	});

	it('classifies GET EQL as parameters-only request input', () => {
		const coreSpecPath = path.join(
			process.cwd(),
			'static/openapi/26.4.3/core/core.json'
		);
		const coreSpec = JSON.parse(fs.readFileSync(coreSpecPath, 'utf8')) as Record<
			string,
			unknown
		>;
		const data = buildPathBrowserData(coreSpec);
		const eql = data.tagGroups
			.flatMap((g) => g.operations)
			.find((op) => op.path === '/core/query/v1/eql' && op.method === 'get');

		expect(eql).toBeDefined();
		expect(eql?.parameters).toHaveLength(4);
		expect(eql?.parameters.some((p) => p.name === 'query' && p.in === 'query')).toBe(true);
		expect(eql?.requestBody).toBeUndefined();
		expect(eql?.responses[0]?.schemaRef).toBe('QueryResponse');
		expect(getOperationRequestInputKind(eql!)).toBe('parameters');
		expect(shouldShowRequestSection(eql!)).toBe(true);
	});

	it('extracts POST requestBody schema from core checkaccess', () => {
		const coreSpecPath = path.join(
			process.cwd(),
			'static/openapi/26.4.3/core/core.json'
		);
		const coreSpec = JSON.parse(fs.readFileSync(coreSpecPath, 'utf8')) as Record<
			string,
			unknown
		>;
		const data = buildPathBrowserData(coreSpec);
		const checkAccess = data.tagGroups
			.flatMap((g) => g.operations)
			.find((op) => op.path === '/core/access/v1/checkaccess' && op.method === 'post');

		expect(checkAccess).toBeDefined();
		expect(checkAccess?.requestBody?.required).toBe(true);
		expect(checkAccess?.requestBody?.schemaRef).toBe('CheckAccessRequest');
		expect(checkAccess?.requestBody?.content[0]?.schemaRef).toBe('CheckAccessRequest');
		expect(checkAccess?.requestBody?.content[0]?.schema?.$ref).toContain('CheckAccessRequest');
		expect(getOperationRequestInputKind(checkAccess!)).toBe('both');
		expect(checkAccess?.responses[0]?.schemaRef).toBe('CheckAccessResponse');
	});

	it('orders coreQuery first and formats tag labels', () => {
		const coreSpecPath = path.join(
			process.cwd(),
			'static/openapi/26.4.3/core/core.json'
		);
		const coreSpec = JSON.parse(fs.readFileSync(coreSpecPath, 'utf8')) as Record<
			string,
			unknown
		>;
		const data = buildPathBrowserData(coreSpec);

		expect(data.tagGroups[0]?.name).toBe('coreQuery');
		expect(formatOpenApiTagLabel('coreQuery')).toBe('Core Query');
		expect(formatOpenApiTagLabel('coreAutoComplete')).toBe('Core Auto Complete');
	});

	it('marks EQL query param as primary and sorts it first', () => {
		const coreSpecPath = path.join(
			process.cwd(),
			'static/openapi/26.4.3/core/core.json'
		);
		const coreSpec = JSON.parse(fs.readFileSync(coreSpecPath, 'utf8')) as Record<
			string,
			unknown
		>;
		const data = buildPathBrowserData(coreSpec);
		const eql = data.tagGroups
			.flatMap((g) => g.operations)
			.find((op) => op.path === '/core/query/v1/eql' && op.method === 'get');

		const queryGroup = groupParametersByLocation(eql!.parameters).find((g) => g.in === 'query');
		expect(queryGroup?.parameters[0]?.name).toBe('query');
		expect(isPrimaryQueryParameter(queryGroup!.parameters[0]!, eql!)).toBe(true);
		expect(sortParametersForDisplay(queryGroup!.parameters)[0]?.name).toBe('query');
	});

	it('represents text/csv response as plain text without schema', () => {
		const coreSpecPath = path.join(
			process.cwd(),
			'static/openapi/26.4.3/core/core.json'
		);
		const coreSpec = JSON.parse(fs.readFileSync(coreSpecPath, 'utf8')) as Record<
			string,
			unknown
		>;
		const data = buildPathBrowserData(coreSpec);
		const eql = data.tagGroups
			.flatMap((g) => g.operations)
			.find((op) => op.path === '/core/query/v1/eql' && op.method === 'get');
		const csv = eql?.responses[0]?.content.find((c) => c.contentType === 'text/csv');

		expect(csv?.hasEmptySchema).toBe(true);
		expect(csv?.schemaType).toBe('plain text');
		expect(csv?.schema).toBeUndefined();
	});

	it('groups json and yaml response content with the same schema ref', () => {
		const coreSpecPath = path.join(
			process.cwd(),
			'static/openapi/26.4.3/core/core.json'
		);
		const coreSpec = JSON.parse(fs.readFileSync(coreSpecPath, 'utf8')) as Record<
			string,
			unknown
		>;
		const data = buildPathBrowserData(coreSpec);
		const eql = data.tagGroups
			.flatMap((g) => g.operations)
			.find((op) => op.path === '/core/query/v1/eql' && op.method === 'get');
		const success = eql?.responses.find((r) => r.status === '200');
		const groups = groupMediaContentBySchema(success!.content);

		expect(groups).toHaveLength(2);
		const structured = groups.find((g) => g.schemaRef === 'QueryResponse');
		expect(structured?.contentTypes).toEqual(['application/json', 'application/yaml']);
		expect(formatMediaContentTypeBadges(structured!.contentTypes)).toBe(
			'application/json · application/yaml'
		);
		// EDA QueryResponse has no explicit examples — synthesis fills the gap for the UI.
		expect(structured?.examples).toEqual([]);
		const csv = groups.find((g) => g.contentTypes.includes('text/csv'));
		expect(csv?.hasEmptySchema).toBe(true);
	});

	it('extracts request and response media examples including x-examples', () => {
		const withExamples = {
			paths: {
				'/items': {
					post: {
						requestBody: {
							content: {
								'application/json': {
									schema: { type: 'object' },
									example: { name: 'demo' },
									examples: {
										full: {
											summary: 'Full body',
											value: { name: 'demo', count: 2 }
										}
									}
								}
							}
						},
						responses: {
							'200': {
								description: 'OK',
								content: {
									'application/json': {
										schema: { $ref: '#/components/schemas/Item' },
										'x-examples': {
											ok: { value: { status: 'ok' } }
										}
									},
									'application/yaml': {
										schema: { $ref: '#/components/schemas/Item' },
										example: { status: 'ok' }
									}
								}
							}
						}
					}
				}
			}
		};

		const data = buildPathBrowserData(withExamples);
		const op = data.tagGroups.flatMap((g) => g.operations)[0];
		expect(op?.requestBody?.content[0]?.examples.map((e) => e.name)).toEqual(['', 'full']);
		expect(op?.requestBody?.content[0]?.examples[1]?.summary).toBe('Full body');

		const groups = groupMediaContentBySchema(op!.responses[0]!.content);
		expect(groups).toHaveLength(1);
		expect(groups[0]?.contentTypes).toEqual(['application/json', 'application/yaml']);
		// Identical bodies from x-examples + example should dedupe to one
		expect(groups[0]?.examples).toHaveLength(1);
		expect(groups[0]?.examples[0]?.formatted).toContain('"status": "ok"');
	});

	it('classifies error response statuses and collapsible descriptions', () => {
		expect(isErrorResponseStatus('default')).toBe(true);
		expect(isErrorResponseStatus('404')).toBe(true);
		expect(isErrorResponseStatus('200')).toBe(false);

		const short = 'Short summary.';
		const long = 'A'.repeat(200);
		const multiline = 'Line one.\n\nLine two.';
		expect(shouldCollapseOperationDescription(short)).toBe(false);
		expect(shouldCollapseOperationDescription(long)).toBe(true);
		expect(shouldCollapseOperationDescription(multiline)).toBe(true);
	});

	it('reflows hard-wrapped operation descriptions into full-width paragraphs', () => {
		const eql = [
			'Streaming API:',
			'Initiate a streaming query request using the EDA query language.',
			'',
			'Non Streaming API:',
			'REST endpoint supporting one-shot queries.',
			'',
			'Whenever the information described by the query parameter changes,',
			'the result of the query will be sent to the requestor/client via the specified stream.'
		].join('\n');

		expect(formatOperationDescriptionParagraphs(eql)).toEqual([
			'Streaming API: Initiate a streaming query request using the EDA query language.',
			'Non Streaming API: REST endpoint supporting one-shot queries.',
			'Whenever the information described by the query parameter changes, the result of the query will be sent to the requestor/client via the specified stream.'
		]);
		expect(formatOperationDescriptionParagraphs('  single line  ')).toEqual(['single line']);
		expect(formatOperationDescriptionParagraphs('')).toEqual([]);
	});

	it('derives operation tag labels for detail headers', () => {
		expect(getOperationTagLabel({ tags: ['coreQuery'], isQueryEndpoint: true })).toBe(
			'Core Query'
		);
		expect(getOperationTagLabel({ tags: [], isQueryEndpoint: true })).toBe('Query');
	});

	it('includes every path and operation from core and app specs', () => {
		const methods = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options']);

		for (const relativePath of [
			'static/openapi/26.4.3/core/core.json',
			'static/openapi/26.4.3/apps/filters.eda.nokia.com/v1/filters.json'
		]) {
			const specPath = path.join(process.cwd(), relativePath);
			const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as Record<string, unknown>;
			const paths = (spec.paths ?? {}) as Record<string, unknown>;
			let rawOps = 0;
			for (const pathItem of Object.values(paths)) {
				if (!pathItem || typeof pathItem !== 'object') continue;
				for (const key of Object.keys(pathItem as Record<string, unknown>)) {
					if (methods.has(key)) rawOps++;
				}
			}

			const data = buildPathBrowserData(spec);
			expect(data.totalPaths).toBe(Object.keys(paths).length);
			expect(data.totalOperations).toBe(rawOps);
		}
	});

	it('resolves Bearer JWT security and marks security: [] as public', () => {
		const authSpec = {
			info: { title: 'Demo', description: 'Core API surface.' },
			components: {
				securitySchemes: {
					bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
				}
			},
			security: [{ bearerAuth: [] }],
			paths: {
				'/core/about/health': {
					get: {
						operationId: 'healthGet',
						security: [],
						responses: { '200': { description: 'OK' } }
					}
				},
				'/core/v1/namespaces': {
					get: {
						operationId: 'listNamespaces',
						responses: { '200': { description: 'OK' } }
					}
				}
			}
		};

		const data = buildPathBrowserData(authSpec);
		expect(data.infoDescription).toBe('Core API surface.');
		expect(data.securitySummary.label).toBe('Bearer JWT');
		expect(data.securitySummary.schemes[0]?.label).toBe('Bearer JWT');

		const health = data.tagGroups
			.flatMap((g) => g.operations)
			.find((op) => op.path === '/core/about/health');
		expect(health?.security).toEqual({
			isPublic: true,
			inherited: false,
			requirements: [],
			label: 'Public (no auth)'
		});

		const namespaces = data.tagGroups
			.flatMap((g) => g.operations)
			.find((op) => op.path === '/core/v1/namespaces');
		expect(namespaces?.security.isPublic).toBe(false);
		expect(namespaces?.security.inherited).toBe(true);
		expect(namespaces?.security.label).toBe('Bearer JWT');
		expect(namespaces?.security.requirements[0]?.bearerFormat).toBe('JWT');
	});

	it('extracts parameter type hints for enum, default, and format', () => {
		expect(
			extractParameterTypeHints({
				type: 'string',
				enum: ['acknowledge', 'unacknowledge', 'suppress', 'unsuppress'],
				format: 'uuid',
				default: false
			})
		).toEqual([
			'format: uuid',
			'enum: acknowledge | unacknowledge | suppress | unsuppress',
			'default: false'
		]);

		const alarmSpec = {
			paths: {
				'/core/alarm/v2/alarms': {
					put: {
						parameters: [
							{
								name: 'action',
								in: 'query',
								required: true,
								schema: {
									type: 'string',
									enum: ['acknowledge', 'unacknowledge', 'suppress', 'unsuppress']
								}
							},
							{
								name: 'dryRun',
								in: 'query',
								schema: { type: 'boolean', default: false }
							}
						],
						responses: { '200': { description: 'OK' } }
					}
				}
			}
		};

		const data = buildPathBrowserData(alarmSpec);
		const op = data.tagGroups.flatMap((g) => g.operations)[0];
		const action = op?.parameters.find((p) => p.name === 'action');
		expect(action?.typeHints).toEqual([
			'enum: acknowledge | unacknowledge | suppress | unsuppress'
		]);
		expect(op?.parameters.find((p) => p.name === 'dryRun')?.typeHints).toEqual(['default: false']);
	});

	it('buildSecuritySummary and resolveOperationSecurity handle missing schemes', () => {
		const summary = buildSecuritySummary({
			components: {
				securitySchemes: {
					ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' }
				}
			},
			security: [{ ApiKeyAuth: [] }]
		});
		expect(summary.label).toBe('API key (header: X-API-Key)');
		expect(getSpecInfoDescription({})).toBe('');

		const schemes = new Map([
			[
				'bearerAuth',
				{ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } as Record<string, unknown>
			]
		]);
		expect(resolveOperationSecurity([], [{ bearerAuth: [] }], schemes).label).toBe(
			'Public (no auth)'
		);
		expect(resolveOperationSecurity(undefined, [{ bearerAuth: [] }], schemes).label).toBe(
			'Bearer JWT'
		);
	});
});
