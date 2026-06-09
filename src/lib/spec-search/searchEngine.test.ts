import { describe, expect, it } from 'vitest';
import { ALL_VERSIONS_SCOPE, buildSearchWorkQueue } from './searchEngine';
import type { ManifestResource } from '$lib/manifest';

const sampleManifest: ManifestResource[] = [
	{
		name: 'vlans.services.eda.nokia.com',
		kind: 'Vlan',
		group: 'services.eda.nokia.com',
		versions: [
			{ name: 'v1alpha1', deprecated: true, appVersion: '' },
			{ name: 'v1', deprecated: false, appVersion: '' },
			{ name: 'v2', deprecated: false, appVersion: '' }
		]
	},
	{
		name: 'vlanstates.services.eda.nokia.com',
		kind: 'VlanState',
		group: 'services.eda.nokia.com',
		versions: [{ name: 'v1', deprecated: false, appVersion: '' }]
	}
];

describe('buildSearchWorkQueue', () => {
	it('defaults to latest version per CRD when version is empty', () => {
		const queue = buildSearchWorkQueue(sampleManifest, '');
		expect(queue).toHaveLength(1);
		expect(queue[0].res.name).toBe('vlans.services.eda.nokia.com');
		expect(queue[0].ver).toBe('v2');
	});

	it('skips *states resources', () => {
		const queue = buildSearchWorkQueue(sampleManifest, '');
		expect(queue.some((w) => w.res.name.includes('states'))).toBe(false);
	});

	it('honors an explicit version filter', () => {
		const queue = buildSearchWorkQueue(sampleManifest, 'v1alpha1');
		expect(queue).toHaveLength(1);
		expect(queue[0].ver).toBe('v1alpha1');
	});

	it('scans all versions only with the all-versions scope', () => {
		const queue = buildSearchWorkQueue(sampleManifest, ALL_VERSIONS_SCOPE);
		expect(queue).toHaveLength(3);
		expect(queue.map((w) => w.ver).sort()).toEqual(['v1', 'v1alpha1', 'v2']);
	});
});
