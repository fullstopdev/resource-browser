import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateBundle } from './index';
import type { ManifestEntry } from '$lib/yaml-validation/types';

const manifest: ManifestEntry[] = [
	{
		name: 'configlets.config.eda.nokia.com',
		kind: 'Configlet',
		group: 'config.eda.nokia.com',
		versions: [{ name: 'v1' }]
	},
	{
		name: 'topologies.topologies.eda.nokia.com',
		kind: 'Topology',
		group: 'topologies.eda.nokia.com',
		versions: [{ name: 'v1' }]
	}
];

describe('validateBundle error accumulation', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('reports issues from all three documents', async () => {
		const yaml = `metadata:
  name: doc-one
spec:
  enabled: True
---
metadata:
  name: doc-two
spec:
  enabled: False
---
metadata:
  name: doc-three
spec:
  enabled: TRUE
`;

		const result = await validateBundle({
			yamlInput: yaml,
			releaseFolder: 'resources/26.4.2',
			releaseLabel: 'EDA 26.4.2',
			manifest
		});

		expect(result.valid).toBe(false);
		expect(result.summary.resourceCount).toBe(3);

		const booleanIssues = result.issues.filter((i) => i.message.includes('lowercase true or false'));
		expect(booleanIssues.length).toBe(3);

		const namespaceIssues = result.issues.filter(
			(i) => i.category === 'kubernetes' && i.message.includes('metadata.namespace')
		);
		expect(namespaceIssues.length).toBe(3);

		const apiVersionIssues = result.issues.filter(
			(i) => i.category === 'kubernetes' && i.message.includes("Missing required 'apiVersion'")
		);
		expect(apiVersionIssues.length).toBe(3);

		const kindIssues = result.issues.filter(
			(i) => i.category === 'kubernetes' && i.message.includes("Missing required 'kind'")
		);
		expect(kindIssues.length).toBe(3);

		expect(result.issues.length).toBeGreaterThanOrEqual(12);
	});

	it('reports unknown CRD kinds instead of treating the bundle as valid', async () => {
		const yaml = `apiVersion: config.eda.nokia.com/v1
kind: NotARealKind
metadata:
  name: test-resource
  namespace: eda
spec: {}
`;

		const result = await validateBundle({
			yamlInput: yaml,
			releaseFolder: 'resources/26.4.2',
			releaseLabel: 'EDA 26.4.2',
			manifest
		});

		expect(result.valid).toBe(false);
		expect(
			result.issues.some(
				(i) =>
					i.severity === 'error' &&
					i.message.includes("kind 'NotARealKind' is not supported for apiVersion")
			)
		).toBe(true);
	});

	it('rejects lowercase kind in bundle validation', async () => {
		const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: topology
metadata:
  name: test-topology
  namespace: eda
spec:
  operatingSystem: srl
`;

		const result = await validateBundle({
			yamlInput: yaml,
			releaseFolder: 'resources/26.4.2',
			releaseLabel: 'EDA 26.4.2',
			manifest
		});

		expect(result.valid).toBe(false);
		expect(
			result.issues.some(
				(i) =>
					i.severity === 'error' &&
					i.message.includes(
						`Invalid kind: 'topology' must be 'Topology' (Kubernetes kinds are case-sensitive).`
					)
			)
		).toBe(true);
	});

	it('reports nested unknown spec fields in documents after the first', async () => {
		const topologySchema = `schema:
  openAPIV3Schema:
    properties:
      spec:
        type: object
        properties:
          operatingSystem:
            type: string
          spines:
            type: object
            properties:
              systemPoolIPv4:
                type: string
    required:
      - spec`;

		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = typeof input === 'string' ? input : input.toString();
				if (url.includes('/topologies.topologies.eda.nokia.com/v1.yaml')) {
					return new Response(topologySchema, { status: 200 });
				}
				return new Response(null, { status: 404 });
			})
		);

		const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: topo-one
  namespace: eda
spec:
  operatingSystem: srl
  spines:
    systemPoolIPv4: pool-a
    unknownInDocOne: x
---
apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: topo-two
  namespace: eda
spec:
  operatingSystem: srl
  spines:
    systemPoolIPv4: pool-b
    unknownInDocTwo: y
`;

		const result = await validateBundle({
			yamlInput: yaml,
			releaseFolder: 'resources/26.4.2',
			releaseLabel: 'EDA 26.4.2',
			manifest
		});

		const doc2Nested = result.issues.filter(
			(i) =>
				i.docIndex === 2 &&
				i.category === 'schema' &&
				i.fieldPath === 'spec.spines.unknownInDocTwo'
		);
		expect(doc2Nested).toHaveLength(1);
	});

	it('errors when apiVersion group is invalid for a known kind', async () => {
		const yaml = `apiVersion: topologi.eda.nokia.com/v1
kind: Topology
metadata:
  name: test-topology
  namespace: eda
spec: {}
`;

		const result = await validateBundle({
			yamlInput: yaml,
			releaseFolder: 'resources/26.4.2',
			releaseLabel: 'EDA 26.4.2',
			manifest
		});

		expect(result.valid).toBe(false);
		expect(
			result.issues.some(
				(i) =>
					i.severity === 'error' &&
					i.message.includes(`Invalid apiVersion: 'topologi.eda.nokia.com/v1'`)
			)
		).toBe(true);
		const apiIssue = result.issues.find((i) => i.message.includes('Invalid apiVersion:'));
		expect(apiIssue?.suggestedFix?.value).toBe('topologies.eda.nokia.com/v1');
	});

	it('validates each document against the apiVersion it declares, not the latest', async () => {
		const versionedManifest: ManifestEntry[] = [
			{
				name: 'widgets.demo.eda.nokia.com',
				kind: 'Widget',
				group: 'demo.eda.nokia.com',
				versions: [{ name: 'v1alpha1', deprecated: true }, { name: 'v1' }]
			}
		];
		const schemaFor = (field: string) => `schema:
  openAPIV3Schema:
    properties:
      spec:
        type: object
        required: [${field}]
        properties:
          ${field}:
            type: string
    required:
      - spec`;
		const requested: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = typeof input === 'string' ? input : input.toString();
				requested.push(url);
				if (url.endsWith('/widgets.demo.eda.nokia.com/v1alpha1.yaml')) {
					return new Response(schemaFor('oldField'), { status: 200 });
				}
				if (url.endsWith('/widgets.demo.eda.nokia.com/v1.yaml')) {
					return new Response(schemaFor('newField'), { status: 200 });
				}
				return new Response(null, { status: 404 });
			})
		);

		const result = await validateBundle({
			yamlInput: `apiVersion: demo.eda.nokia.com/v1alpha1
kind: Widget
metadata:
  name: legacy
  namespace: eda
spec:
  oldField: kept
`,
			releaseFolder: 'resources/test-declared-version',
			releaseLabel: 'EDA test',
			manifest: versionedManifest
		});

		expect(requested.some((u) => u.endsWith('/v1alpha1.yaml'))).toBe(true);
		const schemaIssues = result.issues.filter((i) => i.category === 'schema');
		// Deprecation is still reported, but the v1 schema (newField) must not be applied.
		expect(schemaIssues.some((i) => i.message.includes('deprecated'))).toBe(true);
		expect(schemaIssues.some((i) => i.message.includes('oldField'))).toBe(false);
		expect(schemaIssues.some((i) => i.message.includes('newField'))).toBe(false);
	});

	it('numbers schema issue ids uniquely within a run', async () => {
		const result = await validateBundle({
			yamlInput: `apiVersion: config.eda.nokia.com/v1
kind: NotARealKind
metadata:
  name: a
  namespace: eda
---
apiVersion: config.eda.nokia.com/v1
kind: AlsoNotReal
metadata:
  name: b
  namespace: eda
`,
			releaseFolder: 'resources/26.4.2',
			releaseLabel: 'EDA 26.4.2',
			manifest
		});
		const ids = result.issues.map((i) => i.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
