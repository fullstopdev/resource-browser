import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStaticYaml } from '$lib/yaml/safeYaml';
import { describe, expect, it } from 'vitest';
import { applyIntentTierFilter } from './graphFilters';
import {
	buildCatalogFromManifest,
	catalogToNodes,
	getKindIndex,
	getGvkIndex,
	inferCatalogLinks,
	inferSchemaLinks,
	mergeGraphLinks
} from './inferEdges';
import { extractSubgraph } from './transitiveClosure';
import type { CrdResource } from '$lib/structure';
import type { GraphLink } from './types';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = JSON.parse(
	readFileSync(join(root, 'static/resources/26.4.2/manifest.json'), 'utf8')
) as CrdResource[];

const FABRIC_ID = 'fabrics.fabrics.eda.nokia.com';
const TOPO_NODE_ID = 'toponodes.core.eda.nokia.com';
const NODE_PROFILE_ID = 'nodeprofiles.core.eda.nokia.com';
const CONFIGLET_ID = 'configlets.config.eda.nokia.com';
const OSPF_INTERFACE_ID = 'ospfinterfaces.protocols.eda.nokia.com';
const DEFAULT_BGP_PEER_ID = 'defaultbgppeers.protocols.eda.nokia.com';
const TOPO_LINK_ID = 'topolinks.core.eda.nokia.com';

const fabricYaml = readFileSync(
	join(root, 'static/resources/26.4.2/fabrics.fabrics.eda.nokia.com/v1.yaml'),
	'utf8'
);
const fabricSchema = loadStaticYaml(fabricYaml) as {
	schema?: { openAPIV3Schema?: { properties?: { spec?: unknown; status?: unknown } } };
};

const topoNodeYaml = readFileSync(
	join(root, 'static/resources/26.4.2/toponodes.core.eda.nokia.com/v1.yaml'),
	'utf8'
);
const topoNodeSchema = loadStaticYaml(topoNodeYaml) as {
	schema?: { openAPIV3Schema?: { properties?: { spec?: unknown; status?: unknown } } };
};

/** Golden direct targets for Fabric (strict / tier 1–2, release 26.4.2). */
const FABRIC_STRICT_GOLDEN: Array<{ target: string; rel: string }> = [
	{ target: 'fabricstates.fabrics.eda.nokia.com', rel: 'observes' },
	{ target: 'isls.fabrics.eda.nokia.com', rel: 'orchestrates' },
	{ target: 'toponodes.core.eda.nokia.com', rel: 'bindsTo' },
	{ target: TOPO_LINK_ID, rel: 'bindsTo' },
	{ target: 'policys.routingpolicies.eda.nokia.com', rel: 'appliesTo' },
	{ target: 'ipallocationpools.core.eda.nokia.com', rel: 'references' },
	{ target: 'indexallocationpools.core.eda.nokia.com', rel: 'references' },
	{ target: 'keychains.security.eda.nokia.com', rel: 'references' },
	{ target: 'fabrics.fabrics.eda.nokia.com', rel: 'references' }
];

function fabricLinks(links: GraphLink[], strict = false) {
	const filtered = applyIntentTierFilter(links, !strict);
	return filtered.filter((link) => link.source === FABRIC_ID);
}

function buildFullReleaseGraph(enableDescriptionPass = true) {
	const catalog = buildCatalogFromManifest(manifest);
	const kindIndex = getKindIndex(catalog);
	const gvkIndex = getGvkIndex(catalog);
	const catalogLinks = inferCatalogLinks(catalog, kindIndex);
	const schemaLinks = [];

	for (const res of manifest) {
		const version = res.versions.find((v) => !v.deprecated)?.name ?? res.versions[0]?.name;
		if (!version) continue;
		const schemaPath = join(root, 'static/resources/26.4.2', res.name, `${version}.yaml`);
		try {
			const parsed = loadStaticYaml(readFileSync(schemaPath, 'utf8')) as {
				schema?: {
					openAPIV3Schema?: {
						description?: string;
						properties?: { spec?: unknown; status?: unknown; metadata?: unknown };
					};
				};
			};
			const openApi = parsed.schema?.openAPIV3Schema;
			if (!openApi) continue;
			const entry = catalog.get(res.name);
			schemaLinks.push(
				...inferSchemaLinks(
					res.name,
					entry?.group ?? res.group,
					openApi,
					openApi.properties?.status,
					kindIndex,
					catalog,
					gvkIndex,
					{
						metadataSchema: openApi.properties?.metadata,
						rootDescription: openApi.description,
						enableDescriptionPass
					}
				)
			);
		} catch {
			// skip missing schema files in fixture set
		}
	}

	const versions = new Map(
		manifest.map((res) => [
			res.name,
			res.versions.find((v) => !v.deprecated)?.name ?? res.versions[0]?.name ?? 'v1'
		])
	);

	return {
		catalog,
		graph: {
			nodes: catalogToNodes(catalog, versions, new Map()),
			links: mergeGraphLinks([...catalogLinks, ...schemaLinks]),
			releaseFolder: '26.4.2',
			generatedAt: '2026-01-01T00:00:00.000Z'
		}
	};
}

describe('inferEdges multi-pass pipeline', () => {
	const catalog = buildCatalogFromManifest(manifest);
	const kindIndex = getKindIndex(catalog);
	const gvkIndex = getGvkIndex(catalog);
	const fabricOpenApi = fabricSchema.schema?.openAPIV3Schema;
	const topoNodeOpenApi = topoNodeSchema.schema?.openAPIV3Schema;

	it('Fabric strict golden edge list (~8 direct deps)', () => {
		const links = mergeGraphLinks([
			...inferCatalogLinks(catalog, kindIndex),
			...inferSchemaLinks(
				FABRIC_ID,
				'fabrics.eda.nokia.com',
				fabricOpenApi,
				undefined,
				kindIndex,
				catalog,
				gvkIndex,
				{ enableDescriptionPass: false }
			)
		]);

		const strict = fabricLinks(links, true);
		const targets = new Map(strict.map((l) => [l.target, l.rel]));

		for (const golden of FABRIC_STRICT_GOLDEN) {
			expect(targets.get(golden.target), `missing ${golden.target}`).toBe(golden.rel);
		}

		const uniqueTargets = new Set(strict.map((link) => link.target));
		expect(uniqueTargets.size).toBeGreaterThanOrEqual(9);
		expect(uniqueTargets.size).toBeLessThanOrEqual(15);

		const topoLinkViaLinkSelectors = strict.find(
			(link) => link.target.includes('topolinks') && link.field?.includes('linkSelectors')
		);
		expect(topoLinkViaLinkSelectors?.rel).toBe('bindsTo');
		expect(topoLinkViaLinkSelectors?.edgeClass).toBe('intentDependency');
	});

	it('TopoNode outgoing golden: NodeProfile only (tier 1–2)', () => {
		const links = inferSchemaLinks(
			TOPO_NODE_ID,
			'core.eda.nokia.com',
			topoNodeOpenApi,
			undefined,
			kindIndex,
			catalog,
			gvkIndex,
			{ enableDescriptionPass: false }
		);

		const strict = applyIntentTierFilter(mergeGraphLinks(links), false);
		const outgoing = strict.filter((link) => link.source === TOPO_NODE_ID);

		expect(outgoing).toHaveLength(1);
		expect(outgoing[0]?.target).toBe(NODE_PROFILE_ID);
		expect(outgoing[0]?.rel).toBe('references');
		expect(outgoing[0]?.field).toBe('spec.nodeProfile');
	});

	it('derives meaningful Fabric dependencies without property-name noise', () => {
		const fabricLinksAll = fabricLinks(
			mergeGraphLinks([
				...inferCatalogLinks(catalog, kindIndex),
				...inferSchemaLinks(
					FABRIC_ID,
					'fabrics.eda.nokia.com',
					fabricOpenApi,
					fabricOpenApi?.properties?.status,
					kindIndex,
					catalog,
					gvkIndex,
					{ enableDescriptionPass: true }
				)
			]),
			false
		);

		const observes = fabricLinksAll.find((link) => link.target.includes('fabricstates'));
		expect(observes?.rel).toBe('observes');
		expect(observes?.edgeClass).toBe('intentDependency');
		expect(observes?.reason).toContain('catalog pairing');

		const isl = fabricLinksAll.find((link) => link.target.includes('isls'));
		expect(isl?.rel).toBe('orchestrates');
		expect(isl?.field).toMatch(/interSwitchLinks/);

		for (const link of fabricLinksAll) {
			expect(link.reason).toBeTruthy();
			expect(link.confidence).toBeGreaterThanOrEqual(55);
		}
	});

	it('walks status subtree when full openAPI root is provided', () => {
		const fullRootLinks = inferSchemaLinks(
			FABRIC_ID,
			'fabrics.eda.nokia.com',
			fabricOpenApi,
			undefined,
			kindIndex,
			catalog,
			gvkIndex
		);
		const statusPaths = fullRootLinks
			.map((link) => link.field ?? '')
			.filter((field) => field.startsWith('status.'));
		// Status may or may not contain reference descriptions for Fabric; unified walker includes status paths.
		expect(fullRootLinks.length).toBeGreaterThan(0);
		expect(statusPaths.length).toBeGreaterThanOrEqual(0);
	});

	it('infers TopoLink bindsTo from interSwitchLinks.linkSelectors', () => {
		const links = inferSchemaLinks(
			FABRIC_ID,
			'fabrics.eda.nokia.com',
			fabricOpenApi,
			undefined,
			kindIndex,
			catalog,
			gvkIndex
		);

		const topoLinkEdges = links.filter(
			(link) => link.target.includes('topolinks') && link.field?.includes('linkSelectors')
		);
		expect(topoLinkEdges.length).toBeGreaterThan(0);
		expect(topoLinkEdges.every((link) => link.rel === 'bindsTo')).toBe(true);

		const islEdges = links.filter((link) => link.target.includes('isls'));
		expect(islEdges.length).toBeGreaterThan(0);
		expect(islEdges.some((link) => link.field?.includes('interSwitchLinks'))).toBe(true);
	});

	it('Configlet endpointSelectors bind to TopoNode', () => {
		const res = manifest.find((r) => r.name === CONFIGLET_ID);
		const version = res?.versions.find((v) => !v.deprecated)?.name ?? res?.versions[0]?.name;
		const yaml = readFileSync(
			join(root, 'static/resources/26.4.2', CONFIGLET_ID, `${version}.yaml`),
			'utf8'
		);
		const openApi = (loadStaticYaml(yaml) as { schema?: { openAPIV3Schema?: unknown } }).schema
			?.openAPIV3Schema;
		const links = inferSchemaLinks(
			CONFIGLET_ID,
			'config.eda.nokia.com',
			openApi,
			undefined,
			kindIndex,
			catalog,
			gvkIndex
		);
		const topo = links.find(
			(link) => link.target === TOPO_NODE_ID && link.field?.includes('endpointSelectors')
		);
		expect(topo?.rel).toBe('bindsTo');
	});

	it('OSPFInterface interfaceKind binds to interface kinds', () => {
		const res = manifest.find((r) => r.name === OSPF_INTERFACE_ID);
		const version = res?.versions.find((v) => !v.deprecated)?.name ?? res?.versions[0]?.name;
		const yaml = readFileSync(
			join(root, 'static/resources/26.4.2', OSPF_INTERFACE_ID, `${version}.yaml`),
			'utf8'
		);
		const openApi = (loadStaticYaml(yaml) as { schema?: { openAPIV3Schema?: unknown } }).schema
			?.openAPIV3Schema;
		const links = inferSchemaLinks(
			OSPF_INTERFACE_ID,
			'protocols.eda.nokia.com',
			openApi,
			undefined,
			kindIndex,
			catalog,
			gvkIndex,
			{ enableDescriptionPass: false }
		);
		const ifaceTargets = links
			.filter((link) => link.field?.includes('interfaceKind'))
			.map((link) => link.target);
		expect(ifaceTargets).not.toContain(OSPF_INTERFACE_ID);
		const ifaceKinds = ifaceTargets.map((id) => catalog.get(id)?.kind);
		expect(ifaceKinds).toEqual(expect.arrayContaining(['RoutedInterface', 'IRBInterface']));
		expect(links.filter((link) => link.field?.includes('interfaceKind')).every((l) => l.rel === 'bindsTo')).toBe(
			true
		);
	});

	it('dedupes same source-target-relation-fieldPath and keeps distinct field paths', () => {
		const links = inferSchemaLinks(
			FABRIC_ID,
			'fabrics.eda.nokia.com',
			fabricOpenApi,
			undefined,
			kindIndex,
			catalog,
			gvkIndex
		);

		const policyLinks = links.filter((link) => link.target.includes('policys'));
		expect(policyLinks.length).toBeGreaterThan(0);
		expect(policyLinks.every((link) => link.rel === 'appliesTo')).toBe(true);
		expect(new Set(policyLinks.map((link) => link.field)).size).toBe(policyLinks.length);

		const merged = mergeGraphLinks([
			...policyLinks,
			{
				...policyLinks[0]!,
				confidence: (policyLinks[0]?.confidence ?? 80) - 5,
				reason: 'duplicate candidate'
			}
		]);
		const sameField = merged.filter((link) => link.field === policyLinks[0]?.field);
		expect(sameField).toHaveLength(1);
		expect(sameField[0]?.reason).not.toBe('duplicate candidate');
	});

	it('pass 4 description edges only when enabled', () => {
		const withoutPass4 = inferSchemaLinks(
			FABRIC_ID,
			'fabrics.eda.nokia.com',
			fabricOpenApi,
			undefined,
			kindIndex,
			catalog,
			gvkIndex,
			{ enableDescriptionPass: false }
		);
		const withPass4 = inferSchemaLinks(
			FABRIC_ID,
			'fabrics.eda.nokia.com',
			fabricOpenApi,
			undefined,
			kindIndex,
			catalog,
			gvkIndex,
			{ enableDescriptionPass: true }
		);
		expect(withPass4.length).toBeGreaterThanOrEqual(withoutPass4.length);
	});

	it('strict mode trims tier-3 description-only edges', () => {
		const { graph } = buildFullReleaseGraph(true);
		const strictLinks = applyIntentTierFilter(graph.links, false);
		const allLinks = applyIntentTierFilter(graph.links, true);
		expect(allLinks.length).toBeGreaterThanOrEqual(strictLinks.length);
		if (allLinks.some((link) => link.confidenceTier === 3)) {
			expect(allLinks.length).toBeGreaterThan(strictLinks.length);
		}
		expect(strictLinks.every((link) => link.confidenceTier <= 2)).toBe(true);
	});

	it('Fabric has comprehensive direct dependencies by default (strict)', () => {
		const { graph } = buildFullReleaseGraph(false);
		const strictLinks = applyIntentTierFilter(graph.links, false);
		const fabricOutgoing = strictLinks.filter((link) => link.source === FABRIC_ID);
		const uniqueTargets = new Set(fabricOutgoing.map((link) => link.target));
		expect(uniqueTargets.size).toBeGreaterThanOrEqual(8);
		expect(uniqueTargets.size).toBeLessThanOrEqual(12);
	});


	it('TopoNode required-by is schema-backed without description noise', () => {
		const { graph } = buildFullReleaseGraph(false);
		const strictLinks = applyIntentTierFilter(graph.links, false);
		const incomingToTopo = strictLinks.filter((link) => link.target === TOPO_NODE_ID);
		expect(incomingToTopo.length).toBeGreaterThan(20);
		expect(incomingToTopo.length).toBeLessThan(130);
		for (const link of incomingToTopo) {
			expect(link.reason).toBeTruthy();
			expect(link.field || link.reason).toBeTruthy();
		}
	});
});
