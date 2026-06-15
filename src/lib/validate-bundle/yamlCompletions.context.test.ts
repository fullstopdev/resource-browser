import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findManifestEntry } from '$lib/manifest/lookup';
import { EXAMPLE_BUNDLE_YAML } from './exampleBundle';
import { parseBundleResources } from './parser';
import {
	buildYamlCompletionContext,
	buildYamlCompletions,
	schemaKeyForResource,
	type YamlCompletionContext
} from './yamlCompletions';

const RELEASE_FOLDER = 'resources/26.4.2';
const MANIFEST = JSON.parse(
	readFileSync(resolve(process.cwd(), 'static/resources/26.4.2/manifest.json'), 'utf8')
);

const mockFetch = async (input: RequestInfo | URL) => {
	const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
	const path = resolve(process.cwd(), 'static', url.replace(/^\//, ''));
	const text = readFileSync(path, 'utf8');
	return { ok: true, text: async () => text } as Response;
};

describe('buildYamlCompletionContext (e2e)', () => {
	it('loads Fabric schema with a key matching schemaKeyForResource lookup', async () => {
		const fabricYaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab-fabric
  namespace: eda
spec:
  `;
		const parsed = parseBundleResources(fabricYaml);
		const ctx = await buildYamlCompletionContext(
			parsed.resources,
			RELEASE_FOLDER,
			MANIFEST,
			mockFetch
		);

		const resource = parsed.resources[0]!;
		const key = schemaKeyForResource(
			{ manifest: MANIFEST, releaseFolder: RELEASE_FOLDER },
			resource
		)!;
		expect(ctx.schemas.has(key)).toBe(true);
		expect(ctx.schemas.get(key)?.spec).toBeDefined();

		const line = fabricYaml.split('\n').length;
		const labels = buildYamlCompletions(fabricYaml, line, 3, ctx).map((i) => i.label);
		expect(labels).toContain('leafs');
		expect(labels).toContain('underlayProtocol');
	});

	it('loads Topology schema for the example bundle document', async () => {
		const parsed = parseBundleResources(EXAMPLE_BUNDLE_YAML);
		const ctx = await buildYamlCompletionContext(
			parsed.resources,
			RELEASE_FOLDER,
			MANIFEST,
			mockFetch
		);

		const resource = parsed.resources[0]!;
		const entry = findManifestEntry(MANIFEST, resource.kind, resource.group);
		expect(entry?.name).toBe('topologies.topologies.eda.nokia.com');

		const key = schemaKeyForResource(
			{ manifest: MANIFEST, releaseFolder: RELEASE_FOLDER },
			resource
		)!;
		expect(ctx.schemas.get(key)?.spec).toBeDefined();

		const docYaml = EXAMPLE_BUNDLE_YAML.split('---')[0]!;
		const lines = docYaml.split('\n');
		const specIdx = lines.findIndex((l) => l.trim() === 'spec:');
		const yaml = `${lines.slice(0, specIdx + 1).join('\n')}\n  `;
		const line = yaml.split('\n').length;
		const labels = buildYamlCompletions(yaml, line, 3, ctx).map((i) => i.label);

		expect(labels.length).toBeGreaterThan(0);
		expect(labels).toContain('enabled');
	});

	it('returns no spec suggestions until schemas are present in context', () => {
		const fabricYaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab-fabric
  namespace: eda
spec:
  `;
		const parsed = parseBundleResources(fabricYaml);
		const ctxWithoutSchemas: YamlCompletionContext = {
			releaseFolder: RELEASE_FOLDER,
			manifest: MANIFEST,
			resources: parsed.resources,
			schemas: new Map()
		};
		const line = fabricYaml.split('\n').length;
		expect(buildYamlCompletions(fabricYaml, line, 3, ctxWithoutSchemas)).toEqual([]);
	});
});
