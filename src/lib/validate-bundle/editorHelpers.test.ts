import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDraft, loadDraft, saveDraft } from './draftStorage';
import { validateBundle } from './index';
import { explainIssueFromSchema } from './issueExplain';
import { parseBundleResources } from './parser';
import { buildSkeletonYaml } from './schemaSkeleton';

const RELEASE_FOLDER = 'resources/26.8.2';

async function realSpecSchema(crd: string, version: string): Promise<unknown> {
	const text = await readFile(`static/${RELEASE_FOLDER}/${crd}/${version}.yaml`, 'utf8');
	const doc = yaml.load(text) as { schema: { openAPIV3Schema: { properties: { spec: unknown } } } };
	return doc.schema.openAPIV3Schema.properties.spec;
}

describe('buildSkeletonYaml', () => {
	afterEach(() => vi.unstubAllGlobals());

	it.each([
		['toponodes.core.eda.nokia.com', 'core.eda.nokia.com/v1', 'TopoNode'],
		['interfaces.interfaces.eda.nokia.com', 'interfaces.eda.nokia.com/v1', 'Interface'],
		['topologies.topologies.eda.nokia.com', 'topologies.eda.nokia.com/v1', 'Topology']
	])('%s skeleton has every required field', async (crd, apiVersion, kind) => {
		const specSchema = await realSpecSchema(crd, apiVersion.split('/')[1]!);
		const skeleton = buildSkeletonYaml({ apiVersion, kind, specSchema });
		expect(skeleton).toContain(`kind: ${kind}`);

		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				try {
					return new Response(await readFile(`static${String(input)}`, 'utf8'));
				} catch {
					return new Response(null, { status: 404 });
				}
			})
		);
		const manifest = JSON.parse(await readFile(`static/${RELEASE_FOLDER}/manifest.json`, 'utf8'));
		const result = await validateBundle({
			yamlInput: skeleton,
			releaseFolder: RELEASE_FOLDER,
			releaseLabel: 'EDA 26.8.2',
			manifest
		});
		expect(result.issues.filter((i) => /is required|Missing required/i.test(i.message))).toEqual(
			[]
		);
	});
});

describe('explainIssueFromSchema', () => {
	it('lists type, allowed values and default, or the allowed fields for unknown ones', async () => {
		const specSchema = await realSpecSchema('toponodes.core.eda.nokia.com', 'v1');
		const parsed = parseBundleResources(
			'apiVersion: core.eda.nokia.com/v1\nkind: TopoNode\nmetadata:\n  name: n\n  namespace: eda\nspec:\n  operatingSystem: SRL\n'
		);
		if (!parsed.ok) throw new Error('parse failed');
		const ctx = {
			resources: parsed.resources,
			schemas: new Map([
				[`/${RELEASE_FOLDER}/toponodes.core.eda.nokia.com/v1.yaml`, { spec: specSchema } as never]
			]),
			releaseFolder: RELEASE_FOLDER,
			manifest: [
				{
					name: 'toponodes.core.eda.nokia.com',
					kind: 'TopoNode',
					group: 'core.eda.nokia.com',
					versions: [{ name: 'v1' }]
				}
			]
		};

		const os = explainIssueFromSchema({ fieldPath: 'spec.operatingSystem', docIndex: 1 }, ctx);
		const facts = Object.fromEntries(os!.facts.map((f) => [f.label, f.value]));
		expect(facts.Type).toBe('string');
		expect(facts['Allowed values']).toContain('srl');
		expect(facts.Default).toBe('"srl"');
		expect(facts.Required).toBe('yes');

		const unknown = explainIssueFromSchema({ fieldPath: 'spec.hostname', docIndex: 1 }, ctx);
		expect(unknown!.facts[0]!.label).toBe('Not in schema');
		expect(unknown!.facts[1]!.value).toContain('operatingSystem');
	});
});

describe('draftStorage', () => {
	function memoryStorage(): Storage {
		const data = new Map<string, string>();
		return {
			getItem: (k) => data.get(k) ?? null,
			setItem: (k, v) => void data.set(k, v),
			removeItem: (k) => void data.delete(k),
			clear: () => data.clear(),
			key: () => null,
			length: 0
		};
	}

	it('saves, loads and clears a draft', () => {
		const storage = memoryStorage();
		saveDraft({ yaml: 'kind: X', release: '26.8.2' }, storage);
		expect(loadDraft(storage)).toMatchObject({ yaml: 'kind: X', release: '26.8.2' });
		clearDraft(storage);
		expect(loadDraft(storage)).toBeNull();
	});

	it('never throws when storage is blocked', () => {
		const blocked = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
			removeItem: () => {
				throw new Error('blocked');
			}
		} as unknown as Storage;
		expect(loadDraft(blocked)).toBeNull();
		expect(() => saveDraft({ yaml: 'x' }, blocked)).not.toThrow();
		expect(() => clearDraft(blocked)).not.toThrow();
	});
});
