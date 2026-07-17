import { describe, expect, it } from 'vitest';
import type { OpenApiDiffEntry, OpenApiDiffStatus } from '$lib/openapi/types';
import {
	STATUS_FILTERS,
	compareOpenApiHint,
	displayOpenApiStatus,
	entryMatchesStatusFilter
} from './comparisonUtils';
import { classifyOpenApiDiffStatus } from './openapiDiff';

function stubEntry(status: OpenApiDiffStatus): OpenApiDiffEntry {
	return {
		specId: 'example.eda.nokia.com/v1',
		title: 'Example',
		group: 'example',
		status,
		pathChanges: [],
		schemaChanges: [],
		detailsLoaded: true
	};
}

describe('comparisonUtils filters (Shared must not reclassify)', () => {
	it('exposes CRD-aligned filter chips including Shared and Unchanged', () => {
		expect(STATUS_FILTERS.map((f) => f.status)).toEqual([
			'added',
			'removed',
			'modified',
			'shared',
			'unchanged'
		]);
	});

	it('folds legacy api_version into shared for display only', () => {
		expect(displayOpenApiStatus('api_version')).toBe('shared');
		expect(displayOpenApiStatus('shared')).toBe('shared');
		expect(displayOpenApiStatus('unchanged')).toBe('unchanged');
		expect(displayOpenApiStatus('modified')).toBe('modified');
	});

	it('Shared filter matches shared rows without changing their status', () => {
		const entry = stubEntry('shared');
		const before = entry.status;
		expect(entryMatchesStatusFilter(entry, ['shared'])).toBe(true);
		expect(entryMatchesStatusFilter(entry, ['modified'])).toBe(false);
		expect(entryMatchesStatusFilter(entry, ['added', 'removed', 'modified'])).toBe(false);
		expect(entry.status).toBe(before);
	});

	it('toggling Modified filter does not match Shared entries', () => {
		const shared = stubEntry('shared');
		const modified = stubEntry('modified');
		const filter: OpenApiDiffStatus[] = ['modified'];
		expect(entryMatchesStatusFilter(shared, filter)).toBe(false);
		expect(entryMatchesStatusFilter(modified, filter)).toBe(true);
		expect(shared.status).toBe('shared');
		expect(modified.status).toBe('modified');
	});

	it('classify keeps identical APIs as shared (stable after enrich)', () => {
		expect(classifyOpenApiDiffStatus([], [], { added: 0, removed: 0, modified: 0, apiVersion: 0 })).toBe(
			'shared'
		);
		expect(
			classifyOpenApiDiffStatus([], ['~ API version schema: a.v1alpha1.Foo → a.v1.Foo'], {
				added: 0,
				removed: 0,
				modified: 0,
				apiVersion: 1
			})
		).toBe('shared');
		expect(
			classifyOpenApiDiffStatus(
				[
					{
						path: '/x',
						method: 'GET',
						changeType: 'added',
						details: []
					}
				],
				[],
				{ added: 0, removed: 0, modified: 0, apiVersion: 0 }
			)
		).toBe('modified');
	});
});

describe('compareOpenApiHint', () => {
	it('prompts manual compare when ready', () => {
		expect(compareOpenApiHint(true, false, '25.12.3', '26.4.3')).toContain('Press Enter to run');
	});

	it('does not suggest automatic comparison', () => {
		expect(compareOpenApiHint(true, false, '25.12.3', '26.4.3')).not.toContain('automatically');
	});
});
