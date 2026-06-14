import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStaticYaml } from '$lib/yaml/safeYaml';
import { describe, expect, it } from 'vitest';
import type { CrdResource } from '$lib/structure';
import {
	buildCatalogFromManifest,
	getKindIndex,
	getGvkIndex,
	inferSchemaLinks,
	mergeGraphLinks
} from './inferEdges';
import { collapseVisualLinks } from './visualLinks';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = JSON.parse(
	readFileSync(join(root, 'static/resources/26.4.2/manifest.json'), 'utf8')
) as CrdResource[];

const FABRIC_ID = 'fabrics.fabrics.eda.nokia.com';

const fabricYaml = readFileSync(
	join(root, 'static/resources/26.4.2/fabrics.fabrics.eda.nokia.com/v1.yaml'),
	'utf8'
);
const fabricSchema = loadStaticYaml(fabricYaml) as {
	schema?: { openAPIV3Schema?: { properties?: { spec?: unknown; status?: unknown } } };
};

describe('collapseVisualLinks', () => {
	it('collapses Fabric→Policy to one visual edge with aggregated fieldPaths', () => {
		const catalog = buildCatalogFromManifest(manifest);
		const kindIndex = getKindIndex(catalog);
		const gvkIndex = getGvkIndex(catalog);
		const links = mergeGraphLinks(
			inferSchemaLinks(
				FABRIC_ID,
				'fabrics.eda.nokia.com',
				fabricSchema.schema?.openAPIV3Schema,
				undefined,
				kindIndex,
				catalog,
				gvkIndex
			)
		);

		const policyLinks = links.filter((link) => link.target.includes('policys'));
		expect(policyLinks.length).toBeGreaterThan(1);

		const visual = collapseVisualLinks(policyLinks);
		expect(visual).toHaveLength(1);
		expect(visual[0]?.refCount).toBe(policyLinks.length);
		expect(visual[0]?.fieldPaths?.length).toBe(policyLinks.length);
		expect(new Set(visual[0]?.fieldPaths)).toEqual(new Set(policyLinks.map((link) => link.field)));
	});

	it('keeps bidirectional pairs as separate visual edges', () => {
		const visual = collapseVisualLinks([
			{
				id: 'a|b|references|spec.foo',
				source: 'a',
				target: 'b',
				rel: 'references',
				field: 'spec.foo'
			},
			{
				id: 'b|a|references|spec.bar',
				source: 'b',
				target: 'a',
				rel: 'references',
				field: 'spec.bar'
			}
		]);

		expect(visual).toHaveLength(2);
	});

	it('returns single links unchanged without aggregation metadata', () => {
		const link = {
			id: 'a|b|references|spec.foo',
			source: 'a',
			target: 'b',
			rel: 'references' as const,
			field: 'spec.foo'
		};

		expect(collapseVisualLinks([link])).toEqual([link]);
	});

	it('merges same-direction duplicates regardless of relation', () => {
		const visual = collapseVisualLinks([
			{
				id: 'a|b|references|spec.foo',
				source: 'a',
				target: 'b',
				rel: 'references',
				field: 'spec.foo'
			},
			{
				id: 'a|b|appliesTo|spec.bar',
				source: 'a',
				target: 'b',
				rel: 'appliesTo',
				field: 'spec.bar'
			}
		]);

		expect(visual).toHaveLength(1);
		expect(visual[0]?.refCount).toBe(2);
		expect(visual[0]?.relations).toEqual(['references', 'appliesTo']);
		expect(visual[0]?.rel).toBe('appliesTo');
	});
});
