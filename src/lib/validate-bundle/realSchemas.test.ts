import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_BUNDLE_YAML } from './exampleBundle';
import { applySuggestedFix } from './applyIssueFix';
import { fixAllBundle } from './fixAllBundle';
import { validateBundle } from './index';

const RELEASE_FOLDER = 'resources/26.8.2';

/** Serve schema fetches from static/, like the deployed site. */
function stubStaticFetch() {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input.toString();
			const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]!;
			try {
				return new Response(await readFile(`static${path}`, 'utf8'), { status: 200 });
			} catch {
				return new Response(null, { status: 404 });
			}
		})
	);
}

async function validate(yamlInput: string) {
	const manifest = JSON.parse(await readFile(`static/${RELEASE_FOLDER}/manifest.json`, 'utf8'));
	return validateBundle({
		yamlInput,
		releaseFolder: RELEASE_FOLDER,
		releaseLabel: 'EDA 26.8.2',
		manifest
	});
}

describe('validation against the real 26.8.2 schemas', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('reports no errors for the built-in example bundle', async () => {
		stubStaticFetch();
		const result = await validate(EXAMPLE_BUNDLE_YAML);
		expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
	});

	it('flags a real enum mistake with a readable message', async () => {
		stubStaticFetch();
		const result = await validate(
			EXAMPLE_BUNDLE_YAML.replace('operatingSystem: srl', 'operatingSystem: SRL')
		);
		const issue = result.issues.find((i) => i.fieldPath?.includes('operatingSystem'));
		expect(issue?.severity).toBe('error');
		expect(issue?.message).toContain("value 'SRL' is invalid; must be one of:");
	});
});

describe('one-click fixes for misspelled keys (real 26.8.2 schemas, no AI)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const topology = (spec: string) =>
		// Topology is cluster-scoped: no metadata.namespace.
		`apiVersion: topologies.eda.nokia.com/v1\nkind: Topology\nmetadata:\n  name: lab-topology\nspec:\n${spec}`;

	const cases: Array<[string, string, string]> = [
		[
			'overlay → overlays (required field misspelled)',
			topology(
				'  enabled: true\n  uiName: Lab Topology\n  overlay:\n    - enabled: true\n      key: default\n'
			),
			'  overlays:'
		],
		[
			'enable → enabled inside a list item',
			topology('  enabled: true\n  overlays:\n    - enable: true\n      key: default\n'),
			'    - enabled: true'
		],
		[
			'interfaces → interface on the first line of a list item',
			'apiVersion: interfaces.eda.nokia.com/v1\nkind: Interface\nmetadata:\n  name: e1\n  namespace: eda\nspec:\n  members:\n    - interfaces: ethernet-1-1\n      node: leaf-01\n',
			'    - interface: ethernet-1-1'
		],
		[
			'misspelled key in the second document',
			`${EXAMPLE_BUNDLE_YAML.split('---')[1]!.trim()}\n---\n${topology('  enabled: true\n  overlay:\n    - enabled: true\n      key: default\n')}`,
			'  overlays:'
		]
	];

	it.each(cases)('%s', async (_, yaml, expectedLine) => {
		stubStaticFetch();
		const first = await validate(yaml);
		const errors = first.issues.filter((i) => i.severity === 'error');
		// Reported once, with a fix that actually applies.
		expect(errors).toHaveLength(1);
		const fixed = applySuggestedFix(yaml, errors[0]!);
		expect(fixed).not.toBeNull();

		const all = await fixAllBundle(yaml, first.issues, {
			releaseFolder: RELEASE_FOLDER,
			manifest: JSON.parse(await readFile(`static/${RELEASE_FOLDER}/manifest.json`, 'utf8')),
			revalidateIssues: async (y) => (await validate(y)).issues.filter((i) => i.severity !== 'info')
		});
		expect(all.yaml).toContain(expectedLine);
		const after = await validate(all.yaml);
		expect(after.issues.filter((i) => i.severity === 'error' || i.severity === 'warning')).toEqual(
			[]
		);
	});
});
