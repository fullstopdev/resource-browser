import { describe, expect, it } from 'vitest';
import {
	buildOpenApiComparisonPath,
	buildOpenApiSpecPath,
	decodeSpecIdFromRoute,
	defaultOpenApiRelease,
	encodeSpecIdPathSegments,
	parseOpenApiComparisonParams,
	resolveOpenApiRelease,
	resolveOpenApiReleaseName
} from './urlState';

describe('OpenAPI release resolution', () => {
	const releases = [
		{ name: '26.4.3', label: 'EDA 26.4.3', folder: 'openapi/26.4.3', default: true },
		{ name: '25.12.3', label: 'EDA 25.12.3', folder: 'openapi/25.12.3' },
		{ name: '25.8.3', label: 'EDA 25.8.3', folder: 'openapi/25.8.3' }
	];

	it('defaultOpenApiRelease prefers default flag', () => {
		expect(defaultOpenApiRelease(releases)?.name).toBe('26.4.3');
	});

	it('resolveOpenApiRelease falls back to default when name missing', () => {
		expect(resolveOpenApiRelease(releases, '')?.name).toBe('26.4.3');
		expect(resolveOpenApiRelease(releases, null)?.name).toBe('26.4.3');
	});

	it('resolveOpenApiReleaseName maps CRD-only releases to OpenAPI latest', () => {
		expect(resolveOpenApiReleaseName(releases, '26.4.3')).toBe('26.4.3');
		expect(resolveOpenApiReleaseName(releases, '26.4.2')).toBe('26.4.3');
		expect(resolveOpenApiReleaseName(releases, '25.8.3')).toBe('25.8.3');
		expect(resolveOpenApiReleaseName(releases, null)).toBe('26.4.3');
	});
});

describe('OpenAPI spec path encoding', () => {
	it('builds query-param URLs for app APIs with version segments', () => {
		expect(buildOpenApiSpecPath('aaa.eda.nokia.com/v1', '26.4.3')).toBe(
			'/openapi?release=26.4.3&spec=aaa.eda.nokia.com%2Fv1'
		);
	});

	it('builds query-param URLs for core specs', () => {
		expect(buildOpenApiSpecPath('core', '26.4.3')).toBe('/openapi?release=26.4.3&spec=core');
	});

	it('maps legacy schemas tab to schemaGraph', () => {
		expect(buildOpenApiSpecPath('core', '26.4.3', 'schemas')).toBe(
			'/openapi?release=26.4.3&spec=core&tab=schemaGraph'
		);
	});

	it('includes schemaGraph tab when requested', () => {
		expect(buildOpenApiSpecPath('core', '26.4.3', 'schemaGraph')).toBe(
			'/openapi?release=26.4.3&spec=core&tab=schemaGraph'
		);
	});

	it('prefers op over schema for Schema Graph deep links', () => {
		expect(
			buildOpenApiSpecPath('core', '26.4.3', 'schemaGraph', undefined, {
				op: 'query',
				schema: 'QueryEqlParsed'
			})
		).toBe('/openapi?release=26.4.3&spec=core&tab=schemaGraph&op=query');
	});

	it('round-trips spec ids through route params', () => {
		const encoded = encodeSpecIdPathSegments('aaa.eda.nokia.com/v1');
		expect(encoded).toBe('aaa.eda.nokia.com/v1');
		expect(decodeSpecIdFromRoute(encoded)).toBe('aaa.eda.nokia.com/v1');
	});
});

describe('OpenAPI comparison URL state', () => {
	it('builds sr/tr query path', () => {
		expect(
			buildOpenApiComparisonPath({ sourceRelease: '25.12.3', targetRelease: '26.4.3' })
		).toBe('/openapi-comparison?sr=25.12.3&tr=26.4.3');
	});

	it('parses sr/tr from search params', () => {
		const params = new URLSearchParams('sr=25.12.3&tr=26.4.3');
		expect(parseOpenApiComparisonParams(params)).toEqual({
			sourceRelease: '25.12.3',
			targetRelease: '26.4.3'
		});
	});

	it('returns bare path when empty', () => {
		expect(buildOpenApiComparisonPath({})).toBe('/openapi-comparison');
	});
});
