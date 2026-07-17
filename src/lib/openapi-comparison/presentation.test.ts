import { describe, expect, it } from 'vitest';
import type { OpenApiPathChange } from '$lib/openapi/types';
import {
	defaultOpenApiComparisonPair,
	entryChangeMetricsLabel,
	entrySpecIdLabel,
	groupPathChanges,
	groupSchemaChanges,
	groupSchemaNamesByRoot,
	buildSchemaDisplayRows,
	groupSchemaChangesForUI,
	filterSchemaDisplayRows,
	schemaKindFilterCounts,
	defaultSchemaKindFilters,
	schemaPairBump,
	humanizeOperationDetail,
	opFieldRowsFromDetails,
	parseSchemaChangeLine,
	pathChangePrimaryLabel,
	schemaRootShortName,
	schemaShortName,
	sortOpenApiReleasesOlderFirst,
	versionBumpLabel
} from './presentation';
import { openApiApiFamilyKey, openApiApiVersion } from './compareReleases';

describe('groupPathChanges', () => {
	it('groups by change type in added/removed/modified order', () => {
		const changes: OpenApiPathChange[] = [
			{ path: '/a', method: 'GET', changeType: 'modified', details: [] },
			{ path: '/b', method: 'POST', changeType: 'added', details: [], operationId: 'createB' },
			{ path: '/c', method: 'DELETE', changeType: 'removed', details: [] }
		];
		const groups = groupPathChanges(changes);
		expect(groups.map((g) => g.changeType)).toEqual(['added', 'removed', 'modified']);
		expect(groups[0].changes[0].operationId).toBe('createB');
	});
});

describe('pathChangePrimaryLabel', () => {
	it('prefers operationId + METHOD path', () => {
		expect(
			pathChangePrimaryLabel({
				path: '/core/query/v1/eql',
				method: 'GET',
				operationId: 'queryGetEqlQuery',
				changeType: 'modified',
				details: []
			})
		).toBe('queryGetEqlQuery · GET /core/query/v1/eql');
	});
});

describe('humanizeOperationDetail', () => {
	it('rewrites CRD-style and legacy modified field lines', () => {
		expect(humanizeOperationDetail('~ Modified: responses')).toBe('responses changed');
		expect(humanizeOperationDetail('~ Modified: parameters')).toBe('parameters changed');
		expect(
			humanizeOperationDetail(
				'~ Modified: operationId :: "listOamEdaNokiaComV1alpha1Mirrors" → "listOamEdaNokiaComV1Mirrors"'
			)
		).toBe(
			'operationId: "listOamEdaNokiaComV1alpha1Mirrors" → "listOamEdaNokiaComV1Mirrors"'
		);
		expect(humanizeOperationDetail('~ Modified responses')).toBe('Responses changed');
		expect(humanizeOperationDetail('~ Modified parameters')).toBe('Parameters changed');
		expect(humanizeOperationDetail('~ Modified summary: "Old" → "New"')).toBe(
			'Summary changed: "Old" → "New"'
		);
	});
});

describe('schema change parsing', () => {
	it('parses and groups schema change lines', () => {
		expect(parseSchemaChangeLine('+ Added schema: Foo')).toEqual({
			kind: 'added',
			name: 'Foo',
			raw: '+ Added schema: Foo'
		});
		const grouped = groupSchemaChanges([
			'+ Added schema: A',
			'- Removed schema: B',
			'~ Modified schema: C',
			'~ API version schema: com.nokia.eda.x.v1alpha1.Item → com.nokia.eda.x.v1.Item',
			'~ API version 21 schemas (v1alpha1 → v1)'
		]);
		expect(grouped.added.map((x) => x.name)).toEqual(['A']);
		expect(grouped.removed.map((x) => x.name)).toEqual(['B']);
		expect(grouped.modified.map((x) => x.name)).toEqual(['C']);
		expect(grouped.apiVersion).toHaveLength(2);
		expect(grouped.apiVersion[0]).toMatchObject({
			kind: 'api_version',
			name: 'com.nokia.eda.x.v1.Item',
			fromName: 'com.nokia.eda.x.v1alpha1.Item',
			toName: 'com.nokia.eda.x.v1.Item'
		});
		expect(grouped.apiVersion[1]?.name).toContain('21 schemas version bump');
	});

	it('attaches CRD leaf details under modified schema headers', () => {
		const grouped = groupSchemaChanges([
			'~ Modified schema: com.nokia.eda.interfaces.v1.Breakout',
			'- Removed: properties.spec.properties.interface :: {"type":"string"}',
			'+ Added: properties.spec.properties.interfaces :: {"type":"array"}',
			'~ Modified: properties.spec.properties.nodes.type :: "string" → "array"',
			'~ API version schema: com.nokia.eda.x.v1alpha1.Meta → com.nokia.eda.x.v1.Meta',
			'~ Modified schema: ErrorResponse',
			'- Removed: properties.code'
		]);
		expect(grouped.apiVersion).toHaveLength(1);
		expect(grouped.apiVersion[0]?.name).toBe('com.nokia.eda.x.v1.Meta');
		expect(grouped.modified).toHaveLength(2);
		expect(grouped.modified[0]?.name).toBe('com.nokia.eda.interfaces.v1.Breakout');
		expect(grouped.modified[0]?.details).toHaveLength(3);
		expect(grouped.modified[1]?.name).toBe('ErrorResponse');
		expect(grouped.modified[1]?.details).toEqual(['- Removed: properties.code']);
		// Opaque version pairs must not land in modified.
		expect(grouped.modified.every((m) => !m.name.includes(' → '))).toBe(true);
	});

	it('accepts legacy renamed footnote lines as api_version', () => {
		const parsed = parseSchemaChangeLine(
			'~ Renamed 21 schemas with API version (v1alpha1 → v1)'
		);
		expect(parsed?.kind).toBe('api_version');
		expect(parsed?.name).toContain('21 schemas version bump only');
	});

	it('groups companion schemas under root resource names', () => {
		expect(schemaShortName('com.nokia.eda.aaa.v1.AuthenticationPolicy_alarms')).toBe(
			'AuthenticationPolicy_alarms'
		);
		expect(schemaRootShortName('com.nokia.eda.aaa.v1.AuthenticationPolicyState_alarms')).toBe(
			'AuthenticationPolicy'
		);
		expect(schemaRootShortName('com.nokia.eda.aaa.v1.ServerGroupList')).toBe('ServerGroup');
		expect(schemaRootShortName('ErrorIndex')).toBe('ErrorIndex');

		const grouped = groupSchemaNamesByRoot([
			{ kind: 'added', name: 'com.nokia.eda.aaa.v1.AuthenticationPolicy', raw: '' },
			{ kind: 'added', name: 'com.nokia.eda.aaa.v1.AuthenticationPolicyList', raw: '' },
			{ kind: 'added', name: 'com.nokia.eda.aaa.v1.AuthenticationPolicy_alarms', raw: '' },
			{ kind: 'added', name: 'com.nokia.eda.aaa.v1.ServerGroup', raw: '' },
			{ kind: 'added', name: 'com.nokia.eda.aaa.v1.ServerGroup_metadata', raw: '' }
		]);
		expect(grouped).toHaveLength(2);
		expect(grouped[0]?.root).toBe('AuthenticationPolicy');
		expect(grouped[0]?.companionCount).toBe(2);
		expect(grouped[0]?.primaryName).toBe('com.nokia.eda.aaa.v1.AuthenticationPolicy');
		expect(grouped[1]?.root).toBe('ServerGroup');
		expect(grouped[1]?.companionCount).toBe(1);
	});
});

describe('schema display rows and deep filtering', () => {
	const sampleChanges = [
		'+ Added schema: com.nokia.eda.aaa.v1.AuthenticationPolicy',
		'+ Added schema: com.nokia.eda.aaa.v1.AuthenticationPolicyList',
		'+ Added schema: com.nokia.eda.aaa.v1.AuthenticationPolicy_alarms',
		'- Removed schema: ErrorIndex',
		'- Removed schema: ErrorItem',
		'- Removed schema: TransactionStructuredAppError',
		'~ Modified schema: com.nokia.eda.interfaces.v1.Breakout',
		'- Removed: properties.spec.properties.interface :: {"type":"string"}',
		'~ API version schema: com.nokia.eda.x.v1alpha1.Meta → com.nokia.eda.x.v1.Meta',
		'~ API version schema: com.nokia.eda.x.v1alpha1.MetaList → com.nokia.eda.x.v1.MetaList'
	];

	it('builds path-style rows without truncation', () => {
		const grouped = groupSchemaChanges(sampleChanges);
		const rows = buildSchemaDisplayRows(grouped);
		expect(rows.filter((row) => row.kind === 'added')).toHaveLength(1);
		expect(rows.find((row) => row.kind === 'added')?.companions).toHaveLength(2);
		expect(rows.filter((row) => row.kind === 'removed')).toHaveLength(3);
		expect(rows.filter((row) => row.kind === 'modified')).toHaveLength(1);
		expect(rows.filter((row) => row.kind === 'api_version')).toHaveLength(1);
	});

	it('groups rows into Added / Removed / API version / Modified sections', () => {
		const uiGroups = groupSchemaChangesForUI(sampleChanges);
		expect(uiGroups.map((group) => group.kind)).toEqual([
			'added',
			'removed',
			'api_version',
			'modified'
		]);
		expect(uiGroups[0]?.rows[0]?.label).toBe('AuthenticationPolicy');
	});

	it('filters by kind and schema name without reclassifying', () => {
		const rows = buildSchemaDisplayRows(groupSchemaChanges(sampleChanges));
		const removedOnly = filterSchemaDisplayRows(rows, ['removed'], '');
		expect(removedOnly.every((row) => row.kind === 'removed')).toBe(true);
		expect(removedOnly.map((row) => row.label)).toEqual([
			'ErrorIndex',
			'ErrorItem',
			'TransactionStructuredAppError'
		]);

		const errorSearch = filterSchemaDisplayRows(rows, defaultSchemaKindFilters(rows), 'error');
		expect(errorSearch.every((row) => row.kind === 'removed')).toBe(true);
		expect(errorSearch).toHaveLength(3);
	});

	it('counts filter buckets for toolbar chips', () => {
		const rows = buildSchemaDisplayRows(groupSchemaChanges(sampleChanges));
		expect(schemaKindFilterCounts(rows)).toEqual({
			added: 1,
			removed: 3,
			modified: 1,
			api_version: 1
		});
	});

	it('derives version bump labels from schema renames', () => {
		expect(
			schemaPairBump({
				fromName: 'com.nokia.eda.x.v1alpha1.Meta',
				toName: 'com.nokia.eda.x.v1.Meta'
			})
		).toBe('v1alpha1 → v1');
	});
});

describe('entryChangeMetricsLabel', () => {
	it('formats compact path and schema metrics', () => {
		expect(
			entryChangeMetricsLabel(
				{ added: 2, removed: 1, modified: 3 },
				{ added: 1, removed: 0, modified: 4 }
			)
		).toBe('+2 −1 ~3 paths · +1 ~4 schemas');
		expect(
			entryChangeMetricsLabel(
				{ added: 0, removed: 0, modified: 0 },
				{ added: 0, removed: 0, modified: 2, apiVersion: 21 }
			)
		).toBe('~2 ↻21 schemas');
		expect(entryChangeMetricsLabel({ added: 0, removed: 0, modified: 0 }, null)).toBe(
			'No changes'
		);
	});
});

describe('defaultOpenApiComparisonPair', () => {
	it('picks penultimate → latest by numeric version', () => {
		expect(
			defaultOpenApiComparisonPair([
				{ name: '26.4.3', default: true },
				{ name: '25.12.3' },
				{ name: '25.8.3' }
			])
		).toEqual({ sourceRelease: '25.12.3', targetRelease: '26.4.3' });
	});

	it('sortOpenApiReleasesOlderFirst is stable', () => {
		expect(
			sortOpenApiReleasesOlderFirst([
				{ name: '26.4.3' },
				{ name: '25.12.3' },
				{ name: '25.8.3' }
			]).map((r) => r.name)
		).toEqual(['25.8.3', '25.12.3', '26.4.3']);
	});
});

describe('opFieldRowsFromDetails', () => {
	it('builds release-changes style rows from CRD detail lines', () => {
		const rows = opFieldRowsFromDetails([
			'~ Modified: operationId :: "listOamEdaNokiaComV1alpha1Mirrors" → "listOamEdaNokiaComV1Mirrors"',
			'~ Modified: parameters',
			'+ Added: parameters.query.limit'
		]);
		expect(rows).toHaveLength(3);
		expect(rows[0]).toMatchObject({
			field: 'operationId',
			kind: 'modified',
			before: '"listOamEdaNokiaComV1alpha1Mirrors"',
			after: '"listOamEdaNokiaComV1Mirrors"'
		});
		expect(rows[1].kind).toBe('modified');
		expect(rows[1].before).toBeUndefined();
		expect(rows[2].kind).toBe('added');
		expect(rows[2].field).toBe('parameters.query.limit');
	});

	it('parses added/removed values after :: into before/after cells', () => {
		const rows = opFieldRowsFromDetails([
			'+ Added: properties.spec.properties.interfaces :: {"type":"array"}',
			'- Removed: properties.spec.properties.interface :: {"type":"string"}'
		]);
		expect(rows[0]).toMatchObject({
			field: 'properties.spec.properties.interfaces',
			kind: 'added',
			after: '{"type":"array"}'
		});
		expect(rows[1]).toMatchObject({
			field: 'properties.spec.properties.interface',
			kind: 'removed',
			before: '{"type":"string"}'
		});
	});
});

describe('API family / version bump labels', () => {
	it('strips version suffix for family key', () => {
		expect(openApiApiFamilyKey('fabrics.eda.nokia.com/v1alpha1')).toBe('fabrics.eda.nokia.com');
		expect(openApiApiFamilyKey('core')).toBe('core');
		expect(openApiApiVersion('protocols.eda.nokia.com/v2')).toBe('v2');
	});

	it('formats version bump labels for UI', () => {
		expect(
			versionBumpLabel({
				specId: 'fabrics.eda.nokia.com/v1',
				sourceSpecId: 'fabrics.eda.nokia.com/v1alpha1'
			})
		).toBe('v1alpha1 → v1');
		expect(
			entrySpecIdLabel({
				specId: 'fabrics.eda.nokia.com/v1',
				sourceSpecId: 'fabrics.eda.nokia.com/v1alpha1'
			})
		).toBe('fabrics.eda.nokia.com/v1alpha1 → fabrics.eda.nokia.com/v1');
		expect(versionBumpLabel({ specId: 'core' })).toBeNull();
	});
});
