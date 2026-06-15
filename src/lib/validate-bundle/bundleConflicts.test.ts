import { describe, expect, it } from 'vitest';
import { detectBundleConflicts } from './bundleConflicts';
import type { BundleResource } from './types';

function resource(partial: Partial<BundleResource> & Pick<BundleResource, 'docIndex'>): BundleResource {
	return {
		id: 'eda/default/Topology/demo',
		kind: 'Topology',
		apiVersion: 'topologies.eda.nokia.com/v1',
		group: 'topologies.eda.nokia.com',
		version: 'v1',
		name: 'demo',
		namespace: 'eda',
		data: {},
		doc: { data: {}, rawText: '', startLine: 0, index: partial.docIndex },
		...partial
	};
}

describe('detectBundleConflicts', () => {
	it('flags duplicate kind/name/namespace', () => {
		const conflicts = detectBundleConflicts([
			resource({ docIndex: 0, name: 'dup' }),
			resource({ docIndex: 1, name: 'dup' })
		]);
		expect(conflicts.some((c) => c.type === 'duplicate-resource')).toBe(true);
	});
});
