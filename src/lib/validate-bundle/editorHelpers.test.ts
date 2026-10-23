import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { purgeLegacyDraft } from './draftStorage';
import { explainIssueFromSchema } from './issueExplain';
import { parseBundleResources } from './parser';

const RELEASE_FOLDER = 'resources/26.8.2';

async function realSpecSchema(crd: string, version: string): Promise<unknown> {
	const text = await readFile(`static/${RELEASE_FOLDER}/${crd}/${version}.yaml`, 'utf8');
	const doc = yaml.load(text) as { schema: { openAPIV3Schema: { properties: { spec: unknown } } } };
	return doc.schema.openAPIV3Schema.properties.spec;
}

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

describe('purgeLegacyDraft', () => {
	it('removes a draft saved by the old autosave, and never throws', () => {
		const data = new Map([['validate-yaml:draft:v1', '{"yaml":"secret"}']]);
		const storage = {
			removeItem: (k: string) => void data.delete(k)
		} as unknown as Storage;
		purgeLegacyDraft(storage);
		expect(data.size).toBe(0);

		const blocked = {
			removeItem: () => {
				throw new Error('blocked');
			}
		} as unknown as Storage;
		expect(() => purgeLegacyDraft(blocked)).not.toThrow();
	});
});
