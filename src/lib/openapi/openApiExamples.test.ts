import { describe, expect, it } from 'vitest';
import {
	buildRepresentationMediaOptions,
	extractOpenApiExamples,
	formatExampleAsYaml,
	formatExampleForRepresentation,
	formatExampleValue,
	isLargeExample,
	mediaTypeToFormat,
	mergeOpenApiExamples,
	resolveRepresentationExamples,
	synthesizeExampleFromSchema,
	LARGE_EXAMPLE_CHARS
} from './openApiExamples';

describe('openApiExamples', () => {
	it('formats objects as pretty JSON and leaves plain strings', () => {
		expect(formatExampleValue({ a: 1, b: [2] })).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}');
		expect(formatExampleValue('hello')).toBe('hello');
		expect(formatExampleValue('{"x":1}')).toBe('{\n  "x": 1\n}');
		expect(formatExampleValue(null)).toBe('null');
	});

	it('formats structured values as YAML', () => {
		expect(formatExampleAsYaml({ data: [{}], jsonSchema: {} })).toContain('data:');
		expect(formatExampleAsYaml({ data: [{}], jsonSchema: {} })).toContain('jsonSchema:');
		expect(formatExampleAsYaml('{"x":1}')).toContain('x: 1');
	});

	it('extracts media-type example and named examples', () => {
		const examples = extractOpenApiExamples({
			example: { ok: true },
			examples: {
				named: {
					summary: 'Happy path',
					description: 'A successful payload',
					value: { id: 'abc' }
				}
			}
		});

		expect(examples).toHaveLength(2);
		expect(examples[0]?.name).toBe('');
		expect(examples[0]?.formatted).toContain('"ok": true');
		expect(examples[0]?.value).toEqual({ ok: true });
		expect(examples[1]?.name).toBe('named');
		expect(examples[1]?.summary).toBe('Happy path');
		expect(examples[1]?.description).toBe('A successful payload');
		expect(examples[1]?.formatted).toContain('"id": "abc"');
	});

	it('falls back to schema.example when media has none', () => {
		const examples = extractOpenApiExamples({
			schema: { type: 'object', example: { nested: true } }
		});
		expect(examples).toHaveLength(1);
		expect(examples[0]?.formatted).toContain('"nested": true');
	});

	it('reads x-examples and x-example vendor fields', () => {
		const examples = extractOpenApiExamples({
			'x-example': { legacy: 1 },
			'x-examples': {
				alt: { value: { legacy: 2 } }
			}
		});
		expect(examples.map((e) => e.name)).toEqual(['x-example', 'alt']);
		expect(examples[0]?.formatted).toContain('"legacy": 1');
		expect(examples[1]?.formatted).toContain('"legacy": 2');
	});

	it('extracts parameter examples including schema fallback', () => {
		expect(
			extractOpenApiExamples({
				name: 'id',
				in: 'query',
				schema: { type: 'string', example: 'abc' }
			})[0]?.formatted
		).toBe('abc');

		expect(
			extractOpenApiExamples({
				name: 'filter',
				in: 'query',
				examples: {
					west: { value: 'us-west' },
					east: { value: 'us-east' }
				}
			}).map((e) => e.formatted)
		).toEqual(['us-west', 'us-east']);
	});

	it('marks large examples for default collapse', () => {
		const small = { name: '', summary: '', description: '', formatted: 'ok', size: 2 };
		const large = {
			name: '',
			summary: '',
			description: '',
			formatted: 'x'.repeat(LARGE_EXAMPLE_CHARS + 1),
			size: LARGE_EXAMPLE_CHARS + 1
		};
		expect(isLargeExample(small)).toBe(false);
		expect(isLargeExample(large)).toBe(true);
	});

	it('merges examples without duplicating identical bodies', () => {
		const a = extractOpenApiExamples({ example: { a: 1 } });
		const b = extractOpenApiExamples({
			example: { a: 1 },
			examples: { other: { value: { b: 2 } } }
		});
		const merged = mergeOpenApiExamples(a, b);
		expect(merged).toHaveLength(2);
		expect(merged[1]?.formatted).toContain('"b": 2');
	});

	it('synthesizes a minimal example from QueryResponse-like schema', () => {
		const spec = {
			components: {
				schemas: {
					QueryResponse: {
						type: 'object',
						properties: {
							data: {
								type: 'array',
								items: { type: 'object' }
							},
							jsonSchema: {
								type: 'object',
								properties: {},
								description: 'The JSON schema definition for the query data being returned.'
							}
						}
					}
				}
			}
		};

		const value = synthesizeExampleFromSchema(spec, {
			$ref: '#/components/schemas/QueryResponse'
		});
		expect(value).toEqual({
			data: [{}],
			jsonSchema: {}
		});

		const resolved = resolveRepresentationExamples(spec, [], {
			$ref: '#/components/schemas/QueryResponse'
		});
		expect(resolved).toHaveLength(1);
		expect(resolved[0]?.synthesized).toBe(true);
		expect(resolved[0]?.formatted).toContain('"data"');
		expect(formatExampleForRepresentation(resolved[0]!, 'yaml')).toContain('data:');
	});

	it('prefers explicit examples over synthesis', () => {
		const examples = extractOpenApiExamples({ example: { explicit: true } });
		const resolved = resolveRepresentationExamples({}, examples, {
			type: 'object',
			properties: { other: { type: 'string' } }
		});
		expect(resolved).toHaveLength(1);
		expect(resolved[0]?.formatted).toContain('"explicit": true');
		expect(resolved[0]?.synthesized).toBeFalsy();
	});

	it('uses enum, default, and example fields when synthesizing', () => {
		expect(
			synthesizeExampleFromSchema({}, {
				type: 'object',
				properties: {
					kind: { type: 'string', enum: ['a', 'b'] },
					count: { type: 'integer', default: 3 },
					name: { type: 'string', example: 'demo' }
				}
			})
		).toEqual({ kind: 'a', count: 3, name: 'demo' });
	});

	it('maps content types to selectable JSON/YAML tabs', () => {
		expect(mediaTypeToFormat('application/json')).toBe('json');
		expect(mediaTypeToFormat('application/yaml')).toBe('yaml');

		const options = buildRepresentationMediaOptions([
			'application/json',
			'application/yaml',
			'text/csv'
		]);
		expect(options.map((o) => o.label)).toEqual(['JSON', 'YAML', 'csv']);
		expect(options.map((o) => o.format)).toEqual(['json', 'yaml', 'text']);

		const dual = buildRepresentationMediaOptions(['application/json+yaml']);
		expect(dual.map((o) => o.label)).toEqual(['JSON', 'YAML']);
	});
});
