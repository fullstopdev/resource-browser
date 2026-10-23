import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixAllBundle } from './fixAllBundle';
import { validateBundle } from './index';
import { buildSkeletonYaml } from './schemaSkeleton';
import { compareReleaseValidation } from './upgradeCheck';
import { migrateDocumentText, planScalarWraps } from './versionMigration';

const RELEASE = 'resources/26.8.2';

async function specOf(crd: string, version: string): Promise<unknown> {
	const doc = yaml.load(await readFile(`static/${RELEASE}/${crd}/${version}.yaml`, 'utf8')) as {
		schema: { openAPIV3Schema: { properties: { spec: unknown } } };
	};
	return doc.schema.openAPIV3Schema.properties.spec;
}

function stubStaticFetch() {
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
}

async function validateOn(folder: string, label: string, yamlInput: string) {
	const manifest = JSON.parse(await readFile(`static/${folder}/manifest.json`, 'utf8'));
	return validateBundle({ yamlInput, releaseFolder: folder, releaseLabel: label, manifest });
}

const BD_V1 = `apiVersion: services.eda.nokia.com/v1
kind: BridgeDomain
metadata:
  name: bd-blue
  namespace: eda
spec:
  # keep this comment
  type: EVPNVXLAN
  macLearning: true
  evi: 100
`;

describe('migrateDocumentText', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('moves BridgeDomain v1 → v2: apiVersion, macLearning wrapped, comments kept', async () => {
		const target = await specOf('bridgedomains.services.eda.nokia.com', 'v2');
		const result = migrateDocumentText(BD_V1, {
			toApiVersion: 'services.eda.nokia.com/v2',
			targetSpecSchema: target
		});

		expect(result.yaml).toContain('apiVersion: services.eda.nokia.com/v2');
		expect(result.yaml).toContain('  macLearning:\n    enabled: true');
		expect(result.yaml).toContain('# keep this comment');
		expect(result.changes).toEqual([
			'apiVersion services.eda.nokia.com/v1 → services.eda.nokia.com/v2',
			'spec.macLearning → spec.macLearning.enabled'
		]);

		stubStaticFetch();
		const after = await validateOn(RELEASE, 'EDA 26.8.2', result.yaml);
		expect(after.issues.filter((i) => i.severity === 'error' || i.severity === 'warning')).toEqual(
			[]
		);
	});

	it('wraps scalars inside list items (VirtualNetwork bridgeDomains)', async () => {
		const target = await specOf('virtualnetworks.services.eda.nokia.com', 'v2');
		const plan = planScalarWraps(
			{ bridgeDomains: [{ name: 'a', spec: { macLearning: false } }] },
			target
		);
		expect(plan.wraps).toEqual([
			{ path: 'spec.bridgeDomains.0.spec.macLearning', property: 'enabled' }
		]);
	});

	it('leaves ambiguous scalar→object changes for review', () => {
		const target = {
			type: 'object',
			properties: {
				x: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } }
			}
		};
		expect(planScalarWraps({ x: 'v' }, target)).toEqual({ wraps: [], unresolved: ['spec.x'] });
	});
});

describe('compareReleaseValidation', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('reports what breaks when the bundle moves to a newer release', async () => {
		stubStaticFetch();
		// Artifact v1 gains a required field (checksumEnabled) between 26.4.2 and 26.8.2.
		const oldSpec = yaml.load(
			await readFile('static/resources/26.4.2/artifacts.artifacts.eda.nokia.com/v1.yaml', 'utf8')
		) as { schema: { openAPIV3Schema: { properties: { spec: unknown } } } };
		const doc = buildSkeletonYaml({
			apiVersion: 'artifacts.eda.nokia.com/v1',
			kind: 'Artifact',
			specSchema: oldSpec.schema.openAPIV3Schema.properties.spec
		});
		const current = await validateOn('resources/26.4.2', 'EDA 26.4.2', doc);
		const target = await validateOn(RELEASE, 'EDA 26.8.2', doc);
		const report = compareReleaseValidation(current.issues, target.issues, {
			from: '26.4.2',
			to: '26.8.2'
		});

		expect(report.breaking.map((i) => i.message).join('\n')).toContain('checksumEnabled');
		expect(report.breaking.every((i) => !current.issues.some((c) => c.message === i.message))).toBe(
			true
		);
	});

	it('ignores line numbers and release names when matching issues', () => {
		const a = {
			id: '1',
			severity: 'error' as const,
			category: 'schema' as const,
			docIndex: 1,
			fieldPath: 'spec.x',
			message: 'spec.x is required (Line 6, column 1) in release EDA 26.4.2'
		};
		const b = { ...a, message: 'spec.x is required (Line 9, column 1) in release EDA 26.8.2' };
		const report = compareReleaseValidation([a], [b], { from: 'a', to: 'b' });
		expect(report.breaking).toEqual([]);
		expect(report.resolved).toEqual([]);
	});
});

describe('full migration with the regular fixes', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('migrates a deprecated doc and clears all issues', async () => {
		stubStaticFetch();
		const target = await specOf('bridgedomains.services.eda.nokia.com', 'v2');
		const migrated = migrateDocumentText(BD_V1, {
			toApiVersion: 'services.eda.nokia.com/v2',
			targetSpecSchema: target
		});
		const first = await validateOn(RELEASE, 'EDA 26.8.2', migrated.yaml);
		const fixed = await fixAllBundle(migrated.yaml, first.issues, {
			releaseFolder: RELEASE,
			manifest: JSON.parse(await readFile(`static/${RELEASE}/manifest.json`, 'utf8')),
			revalidateIssues: async (y) =>
				(await validateOn(RELEASE, 'EDA 26.8.2', y)).issues.filter((i) => i.severity !== 'info')
		});
		const after = await validateOn(RELEASE, 'EDA 26.8.2', fixed.yaml);
		expect(after.issues.filter((i) => i.severity === 'error')).toEqual([]);
	});
});
