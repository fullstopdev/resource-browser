import { describe, expect, it } from 'vitest';
import { applySuggestedFix } from './applyIssueFix';
import type { BundleIssue } from './types';

describe('applySuggestedFix', () => {
	it('replaces apiVersion on the matching line', () => {
		const yaml = `apiVersion: Topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: lab
  namespace: eda
`;

		const issue: BundleIssue = {
			id: 'test-1',
			severity: 'error',
			category: 'schema',
			message: 'Invalid apiVersion',
			docIndex: 1,
			line: 1,
			fieldPath: '/apiVersion',
			suggestedFix: { field: 'apiVersion', value: 'topologies.eda.nokia.com/v1', line: 1 }
		};

		const updated = applySuggestedFix(yaml, issue);
		expect(updated).toContain('apiVersion: topologies.eda.nokia.com/v1');
		expect(updated).not.toContain('Topologies.eda.nokia.com');
	});

	it('replaces kind case on the matching line', () => {
		const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: topology
metadata:
  name: lab
  namespace: eda
`;

		const issue: BundleIssue = {
			id: 'test-2',
			severity: 'error',
			category: 'schema',
			message: 'Invalid kind',
			docIndex: 1,
			line: 2,
			fieldPath: 'kind',
			suggestedFix: { field: 'kind', value: 'Topology', line: 2 }
		};

		const updated = applySuggestedFix(yaml, issue);
		expect(updated).toContain('kind: Topology');
	});

	it('replaces metadata.name underscores', () => {
		const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: my_topology
  namespace: eda
`;

		const issue: BundleIssue = {
			id: 'test-3',
			severity: 'error',
			category: 'kubernetes',
			message: 'invalid metadata.name',
			docIndex: 1,
			line: 4,
			fieldPath: 'metadata.name',
			suggestedFix: { field: 'metadata.name', value: 'my-topology', line: 4 }
		};

		const updated = applySuggestedFix(yaml, issue);
		expect(updated).toContain('name: my-topology');
	});

	it('renames a misspelled YAML key on the matching line', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  spines:
    systemPoolIPV6: systemipv6-pool
`;

		const issue: BundleIssue = {
			id: 'test-4',
			severity: 'warning',
			category: 'schema',
			message: 'Misspelled field',
			docIndex: 1,
			line: 7,
			fieldPath: 'spec.spines.systemPoolIPV6',
			suggestedFix: {
				action: 'renameKey',
				field: 'systemPoolIPV6',
				value: 'systemPoolIPv6',
				line: 7
			}
		};

		const updated = applySuggestedFix(yaml, issue);
		expect(updated).toContain('systemPoolIPv6: systemipv6-pool');
		expect(updated).not.toContain('systemPoolIPV6:');
	});

	it('renames protocol to protocols without changing list content', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  bgp:
    protocol:
    - EBGP
`;

		const issue: BundleIssue = {
			id: 'test-5',
			severity: 'warning',
			category: 'schema',
			message: 'Misspelled field',
			docIndex: 1,
			line: 7,
			fieldPath: 'spec.bgp.protocol',
			suggestedFix: {
				action: 'renameKey',
				field: 'protocol',
				value: 'protocols',
				line: 7
			}
		};

		const updated = applySuggestedFix(yaml, issue);
		expect(updated).toContain('protocols:');
		expect(updated).not.toContain('protocol:');
		expect(updated).toContain('- EBGP');
		expect(updated).not.toContain('OSPF');
		expect(updated).not.toContain('ISIS');
	});

	it('renames underlay protocol after overlay already has protocol key', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  overlayProtocol:
    protocol: IBGP
  underlayProtocol:
    protocol:
    - EBGP
`;

		const issue: BundleIssue = {
			id: 'underlay-protocol',
			severity: 'warning',
			category: 'schema',
			message: 'Misspelled field',
			docIndex: 1,
			fieldPath: 'spec.underlayProtocol.protocol',
			suggestedFix: {
				action: 'renameKey',
				field: 'protocol',
				value: 'protocols'
			}
		};

		const updated = applySuggestedFix(yaml, issue);
		expect(updated).toMatch(/underlayProtocol:[\s\S]*?protocols:\s*\n\s+- EBGP/);
		expect(updated).toMatch(/overlayProtocol:[\s\S]*?protocol: IBGP/);
		expect(updated).not.toMatch(/underlayProtocol:[\s\S]*?\n\s+protocol:/);
	});

	it('renames duplicate keys at different paths independently', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  systemPoolIPV6: root-pool
  spines:
    systemPoolIPV4: systemipv4-pool
    systemPoolIPV6: systemipv6-pool
`;

		const issueV4: BundleIssue = {
			id: 'dup-v4',
			severity: 'warning',
			category: 'schema',
			message: 'Misspelled field',
			docIndex: 1,
			line: 99,
			fieldPath: 'spec.spines.systemPoolIPV4',
			suggestedFix: {
				action: 'renameKey',
				field: 'systemPoolIPV4',
				value: 'systemPoolIPv4',
				line: 99
			}
		};

		const issueV6: BundleIssue = {
			id: 'dup-v6',
			severity: 'warning',
			category: 'schema',
			message: 'Misspelled field',
			docIndex: 1,
			line: 99,
			fieldPath: 'spec.spines.systemPoolIPV6',
			suggestedFix: {
				action: 'renameKey',
				field: 'systemPoolIPV6',
				value: 'systemPoolIPv6',
				line: 99
			}
		};

		let updated = applySuggestedFix(yaml, issueV4);
		expect(updated).toBeTruthy();
		updated = applySuggestedFix(updated!, issueV6);
		expect(updated).toContain('systemPoolIPv4: systemipv4-pool');
		expect(updated).toContain('systemPoolIPv6: systemipv6-pool');
		expect(updated).toContain('systemPoolIPV6: root-pool');
		expect(updated).not.toMatch(/systemPoolIPV4:/);
	});

	it('renames a misspelled YAML key using fieldPath when line is stale', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  spines:
    systemPoolIPV6: systemipv6-pool
`;

		const issue: BundleIssue = {
			id: 'test-6',
			severity: 'warning',
			category: 'schema',
			message: 'Misspelled field',
			docIndex: 1,
			line: 99,
			fieldPath: 'spec.spines.systemPoolIPV6',
			suggestedFix: {
				action: 'renameKey',
				field: 'systemPoolIPV6',
				value: 'systemPoolIPv6',
				line: 99
			}
		};

		const updated = applySuggestedFix(yaml, issue);
		expect(updated).toContain('systemPoolIPv6: systemipv6-pool');
		expect(updated).not.toContain('systemPoolIPV6:');
	});

	it('renames misspelled keys when YAML has leading blank lines', () => {
		const yaml = `\n\napiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: test
spec:
  systemPoolIPV6: pool-a
  borderLeafs:
    systemPoolIPV6: pool-b
`;

		const rootIssue: BundleIssue = {
			id: 'leading-root',
			severity: 'warning',
			category: 'schema',
			message: 'Misspelled field',
			docIndex: 1,
			fieldPath: 'spec.systemPoolIPV6',
			suggestedFix: {
				action: 'renameKey',
				field: 'systemPoolIPV6',
				value: 'systemPoolIPv6'
			}
		};

		const nestedIssue: BundleIssue = {
			...rootIssue,
			id: 'leading-nested',
			fieldPath: 'spec.borderLeafs.systemPoolIPV6'
		};

		let updated = applySuggestedFix(yaml, rootIssue);
		expect(updated).toContain('systemPoolIPv6: pool-a');
		expect(updated).toContain('systemPoolIPV6: pool-b');

		updated = applySuggestedFix(updated!, nestedIssue);
		expect(updated).toContain('systemPoolIPv6: pool-b');
		expect(updated).not.toMatch(/systemPoolIPV6:/);
	});

	it('fixes both root and nested systemPoolIPV6 in user-reported YAML', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: test
spec:
  systemPoolIPV6: pool-a
  borderLeafs:
    systemPoolIPV6: pool-b
`;

		const makeIssue = (fieldPath: string): BundleIssue => ({
			id: fieldPath,
			severity: 'warning',
			category: 'schema',
			message: 'Misspelled field',
			docIndex: 1,
			fieldPath,
			suggestedFix: {
				action: 'renameKey',
				field: 'systemPoolIPV6',
				value: 'systemPoolIPv6'
			}
		});

		let updated = applySuggestedFix(yaml, makeIssue('spec.systemPoolIPV6'));
		updated = applySuggestedFix(updated!, makeIssue('spec.borderLeafs.systemPoolIPV6'));
		expect(updated).toContain('systemPoolIPv6: pool-a');
		expect(updated).toContain('systemPoolIPv6: pool-b');
		expect(updated).not.toMatch(/systemPoolIPV6:/);
	});

	it('skips addField when protocols key already exists', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  underlayProtocol:
    protocols: []
    bgp: {}
`;
		const issue: BundleIssue = {
			id: 'dup-protocols',
			severity: 'error',
			category: 'schema',
			message: 'spec.underlayProtocol.protocols is required',
			docIndex: 1,
			fieldPath: 'spec.underlayProtocol.protocols',
			suggestedFix: {
				action: 'addField',
				field: 'protocols',
				value: '[]'
			}
		};
		expect(applySuggestedFix(yaml, issue)).toBeNull();
	});
});
