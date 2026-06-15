import { describe, expect, it } from 'vitest';
import { bundleIssuesToMarkers } from './yamlMarkers';
import type { BundleIssue } from './types';

describe('bundleIssuesToMarkers', () => {
	const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: topo-1
  namespace: eda
spec:
  overlays: []
`;

	it('maps issues with line numbers to markers', () => {
		const issues: BundleIssue[] = [
			{
				id: 'e1',
				severity: 'error',
				category: 'schema',
				message: 'Missing required field',
				line: 7
			}
		];

		const markers = bundleIssuesToMarkers(yaml, issues);
		expect(markers).toHaveLength(1);
		expect(markers[0]!.startLineNumber).toBe(7);
		expect(markers[0]!.severity).toBe('error');
		expect(markers[0]!.message).toBe('Missing required field');
	});

	it('resolves fieldPath to line when line is missing', () => {
		const issues: BundleIssue[] = [
			{
				id: 'e2',
				severity: 'warning',
				category: 'kubernetes',
				message: 'Invalid name',
				docIndex: 1,
				fieldPath: 'metadata.name'
			}
		];

		const markers = bundleIssuesToMarkers(yaml, issues);
		expect(markers).toHaveLength(1);
		expect(markers[0]!.startLineNumber).toBe(4);
		expect(markers[0]!.severity).toBe('warning');
		expect(markers[0]!.source).toBe('kubernetes');
	});

	it('skips issues without resolvable line', () => {
		const issues: BundleIssue[] = [
			{
				id: 'e3',
				severity: 'error',
				category: 'schema',
				message: 'Unknown'
			}
		];
		expect(bundleIssuesToMarkers(yaml, issues)).toHaveLength(0);
	});
});
