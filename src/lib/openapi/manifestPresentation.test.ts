import { describe, expect, it } from 'vitest';
import {
	CORE_API_SERVER_SPEC_ID,
	coreApiServerSpecHref,
	defaultOpenApiSpecId,
	filterOpenApiManifestEntriesWithPaths,
	formatOpenApiManifestLabel,
	openApiManifestEntryHasPaths,
	openApiManifestPathCount,
	resolveOpenApiSpecId
} from './manifestPresentation';
import type { OpenApiManifestEntry } from './types';

const coreEntry: OpenApiManifestEntry = {
	id: 'core',
	title: 'API Server (REST, Query & EQL)',
	group: 'API Server',
	apiVersion: 'core',
	file: 'core/core.json',
	pathCount: 110,
	tags: ['coreQuery']
};

const coreAppEntry: OpenApiManifestEntry = {
	id: 'core.eda.nokia.com/v1',
	title: 'Core Application APIs.',
	group: 'core.eda.nokia.com',
	apiVersion: 'v1',
	file: 'apps/core.eda.nokia.com/v1/core.json',
	pathCount: 192,
	tags: ['apps']
};

const zeroPathEntry: OpenApiManifestEntry = {
	id: 'certcheck.eda.nokia.com/v1alpha1',
	title: 'Cert Checker Application APIs.',
	group: 'certcheck.eda.nokia.com',
	apiVersion: 'v1alpha1',
	file: 'apps/certcheck.eda.nokia.com/v1alpha1/certcheck.json',
	pathCount: 0,
	tags: []
};

describe('manifestPresentation', () => {
	it('uses manifest titles in selectors', () => {
		expect(formatOpenApiManifestLabel(coreEntry)).toBe('API Server (REST, Query & EQL)');
		expect(formatOpenApiManifestLabel(coreAppEntry)).toBe('Core Application APIs.');
	});

	it('builds core API server href', () => {
		expect(coreApiServerSpecHref('26.4.3')).toBe('/openapi?release=26.4.3&spec=core');
	});

	it('defaults to the core API server spec when present', () => {
		expect(defaultOpenApiSpecId([coreAppEntry, coreEntry])).toBe(CORE_API_SERVER_SPEC_ID);
		expect(defaultOpenApiSpecId([coreAppEntry])).toBe('core.eda.nokia.com/v1');
	});

	it('keeps a preferred spec across releases when it still exists', () => {
		expect(resolveOpenApiSpecId([coreAppEntry, coreEntry], 'core.eda.nokia.com/v1')).toBe(
			'core.eda.nokia.com/v1'
		);
	});

	it('falls back to core when preferred spec is missing from the manifest', () => {
		expect(resolveOpenApiSpecId([coreAppEntry, coreEntry], 'missing.app/v1')).toBe(
			CORE_API_SERVER_SPEC_ID
		);
		expect(resolveOpenApiSpecId([coreAppEntry], 'missing.app/v1')).toBe('core.eda.nokia.com/v1');
		expect(resolveOpenApiSpecId([coreAppEntry, coreEntry], '')).toBe(CORE_API_SERVER_SPEC_ID);
	});

	it('treats missing pathCount as zero paths', () => {
		expect(openApiManifestPathCount({ pathCount: Number.NaN })).toBe(0);
		expect(openApiManifestPathCount({ pathCount: undefined as unknown as number })).toBe(0);
		expect(openApiManifestEntryHasPaths(zeroPathEntry)).toBe(false);
		expect(openApiManifestEntryHasPaths(coreEntry)).toBe(true);
	});

	it('filters zero-path specs from browse catalogs', () => {
		expect(
			filterOpenApiManifestEntriesWithPaths([zeroPathEntry, coreEntry, coreAppEntry]).map(
				(e) => e.id
			)
		).toEqual(['core', 'core.eda.nokia.com/v1']);
	});
});
