import { describe, expect, it } from 'vitest';
import {
	findManifestEntry,
	findManifestEntryCaseInsensitive,
	findManifestEntryCaseMismatch,
	findManifestEntryGroupCaseMismatch,
	findManifestEntryKindCaseMismatchInsensitive,
	findManifestEntriesByKind,
	normalizeKind,
	formatCrdNotFoundMessage,
	formatInvalidApiVersionMessage,
	formatKindCaseMismatchMessage,
	kindMatchesManifestName
} from './lookup';
import type { ManifestEntry } from '$lib/yaml-validation/types';

const topologyManifest: ManifestEntry[] = [
	{
		name: 'topologies.topologies.eda.nokia.com',
		kind: 'Topology',
		group: 'topologies.eda.nokia.com',
		versions: [{ name: 'v1' }]
	}
];

describe('manifest lookup', () => {
	it('matches kind and group case-sensitively', () => {
		expect(findManifestEntry(topologyManifest, 'Topology', 'topologies.eda.nokia.com')).toBeDefined();
		expect(findManifestEntry(topologyManifest, 'topology', 'topologies.eda.nokia.com')).toBeUndefined();
	});

	it('detects case-only kind mismatches for a matching group', () => {
		const mismatch = findManifestEntryCaseMismatch(
			topologyManifest,
			'topology',
			'topologies.eda.nokia.com'
		);
		expect(mismatch?.kind).toBe('Topology');
		expect(formatKindCaseMismatchMessage('Topology', 'topology')).toBe(
			`Invalid kind: 'topology' must be 'Topology' (Kubernetes kinds are case-sensitive).`
		);
	});

	it('detects case-only group mismatches for a matching kind', () => {
		const mismatch = findManifestEntryGroupCaseMismatch(
			topologyManifest,
			'Topology',
			'Topologies.eda.nokia.com'
		);
		expect(mismatch?.group).toBe('topologies.eda.nokia.com');
	});

	it('detects kind case mismatches when group matches case-insensitively', () => {
		const mismatch = findManifestEntryKindCaseMismatchInsensitive(
			topologyManifest,
			'topology',
			'Topologies.eda.nokia.com'
		);
		expect(mismatch?.kind).toBe('Topology');
	});

	it('finds a unique case-insensitive manifest entry', () => {
		const entry = findManifestEntryCaseInsensitive(
			topologyManifest,
			'topology',
			'Topologies.eda.nokia.com'
		);
		expect(entry?.kind).toBe('Topology');
		expect(entry?.group).toBe('topologies.eda.nokia.com');
	});

	it('formats apiVersion mismatch messages with suggested value', () => {
		expect(
			formatInvalidApiVersionMessage(
				'Topologies.eda.nokia.com/v1',
				'topologies.eda.nokia.com/v1',
				'Topology'
			)
		).toBe(
			`Invalid apiVersion: 'Topologies.eda.nokia.com/v1' is not defined for this release. Use 'topologies.eda.nokia.com/v1' for kind Topology.`
		);
	});

	it('normalizes user kind input to manifest canonical casing (case only)', () => {
		expect(normalizeKind('topology', topologyManifest, 'topologies.eda.nokia.com')).toBe('Topology');
		expect(normalizeKind('routerinterconnect', topologyManifest)).toBeUndefined();
	});

	it('does not normalize plural kinds to singular', () => {
		const manifest: ManifestEntry[] = [
			{
				name: 'routerinterconnects.services.eda.nokia.com',
				kind: 'RouterInterconnect',
				group: 'services.eda.nokia.com',
				versions: [{ name: 'v2' }]
			}
		];
		expect(normalizeKind('RouterInterconnects', manifest, 'services.eda.nokia.com')).toBeUndefined();
		expect(findManifestEntry(manifest, 'RouterInterconnects', 'services.eda.nokia.com')).toBeUndefined();
		expect(findManifestEntry(manifest, 'RouterInterconnect', 'services.eda.nokia.com')).toBe(manifest[0]);
		const mismatch = findManifestEntryCaseMismatch(
			manifest,
			'RouterInterconnects',
			'services.eda.nokia.com'
		);
		expect(mismatch?.kind).toBe('RouterInterconnect');
		expect(formatKindCaseMismatchMessage('RouterInterconnect', 'RouterInterconnects')).toBe(
			`Invalid kind: 'RouterInterconnects' must be 'RouterInterconnect' (Kubernetes kinds are case-sensitive).`
		);
	});

	it('matches YAML kind to manifest entries with empty kind via plural CRD name', () => {
		const manifest: ManifestEntry[] = [
			{
				name: 'routerinterconnects.services.eda.nokia.com',
				group: 'services.eda.nokia.com',
				kind: '',
				versions: [{ name: 'v2' }]
			}
		];
		expect(kindMatchesManifestName('routerinterconnects.services.eda.nokia.com', 'RouterInterconnect')).toBe(
			true
		);
		expect(findManifestEntry(manifest, 'RouterInterconnect', 'services.eda.nokia.com')).toBe(manifest[0]);
		expect(findManifestEntriesByKind(manifest, 'RouterInterconnect')).toEqual([manifest[0]]);
	});

	it('suggests available apiVersions in CRD-not-found messages', () => {
		expect(
			formatCrdNotFoundMessage('services.eda.nokia.com/v1', 'RouterInterconnect', [
				'services.eda.nokia.com/v2'
			])
		).toContain('Available apiVersions for this kind: services.eda.nokia.com/v2');
	});
});
