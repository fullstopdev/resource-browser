import { describe, expect, it } from 'vitest';
import {
	extractDocumentYaml,
	inferManifestIdentity,
	replaceDocumentInBundle,
	validateAiFixApply,
	isParseIssue
} from './replaceDocument';

const doc1 = `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: topo-a
spec:
  type: evpn`;

const doc2 = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: fabric-b
spec:
  os: SRL`;

const bundle = `${doc1}\n---\n${doc2}`;

describe('replaceDocumentInBundle', () => {
	it('replaces document 2 in a multi-doc bundle', () => {
		const fixed = doc2.replace('os: SRL', 'os: srl');
		const updated = replaceDocumentInBundle(bundle, 2, fixed);
		expect(updated).toContain('name: topo-a');
		expect(updated).toContain('os: srl');
		expect(updated).not.toContain('os: SRL');
	});

	it('replaces the only document in a single-doc bundle', () => {
		const fixed = doc1.replace('type: evpn', 'type: EVPN');
		const updated = replaceDocumentInBundle(doc1, 1, fixed);
		expect(updated).toBe(fixed);
	});

	it('returns null for out-of-range docIndex', () => {
		expect(replaceDocumentInBundle(bundle, 3, doc1)).toBeNull();
	});
});

describe('extractDocumentYaml with broken YAML', () => {
	it('returns raw section when document does not parse', () => {
		const broken = `apiVersion: x
kind Fabric
---
apiVersion: y
kind: Topology`;
		expect(extractDocumentYaml(broken, 1)).toContain('kind Fabric');
		expect(extractDocumentYaml(broken, 2)).toContain('kind: Topology');
	});

	it('replaces broken document in bundle', () => {
		const broken = `apiVersion: x
kind Fabric
---
${doc2}`;
		const fixedDoc1 = `apiVersion: x
kind: Fabric`;
		const updated = replaceDocumentInBundle(broken, 1, fixedDoc1);
		expect(updated).toContain('kind: Fabric');
		expect(updated).toContain('fabric-b');
	});
});

describe('inferManifestIdentity', () => {
	it('reads kind and group from partial yaml', () => {
		const id = inferManifestIdentity(`apiVersion: fabrics.eda.nokia.com/v1\nkind: Fabric\n`);
		expect(id.kind).toBe('Fabric');
		expect(id.group).toBe('fabrics.eda.nokia.com');
	});
});

describe('isParseIssue', () => {
	it('detects parse issue ids', () => {
		expect(isParseIssue({ id: 'parse-1', message: 'x' })).toBe(true);
	});
});

describe('validateAiFixApply', () => {
	it('allows spec-only changes', () => {
		const fixed = doc2.replace('os: SRL', 'os: srl');
		expect(validateAiFixApply(doc2, fixed, { id: 'schema-1', message: 'enum value', fieldPath: 'spec.os' }).ok).toBe(
			true
		);
	});

	it('allows parse fixes when original YAML is invalid', () => {
		const broken = `apiVersion: fabrics.eda.nokia.com/v1
kind Fabric
metadata:
  name: demo`;
		const fixed = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: demo`;
		expect(
			validateAiFixApply(broken, fixed, {
				id: 'parse-1',
				message: 'YAML parsing error: bad indentation'
			}).ok
		).toBe(true);
	});

	it('rejects kind change when issue is not about kind', () => {
		const fixed = doc2.replace('kind: Fabric', 'kind: Topology');
		const result = validateAiFixApply(doc2, fixed, {
			id: 'schema-1',
			message: 'invalid enum',
			fieldPath: 'spec.os'
		});
		expect(result.ok).toBe(false);
	});
});
