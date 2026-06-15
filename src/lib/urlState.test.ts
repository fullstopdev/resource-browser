import { describe, expect, it } from 'vitest';
import type { CrdResource, EdaRelease } from '$lib/structure';
import {
	buildCatalogPath,
	buildCatalogCrdPath,
	buildComparisonPath,
	buildDependencyMapFocusPath,
	buildSpecSearchPath,
	catalogBrowseFromParams,
	crdParamForResource,
	normalizeSpecSearchVersion,
	parseCatalogParams,
	parseComparisonParams,
	parseDependencyMapParams,
	parseSpecSearchParams,
	resolveCrdFromParam,
	resolveReleaseName
} from './urlState';

const releases: EdaRelease[] = [
	{ name: '26.4.2', label: 'EDA 26.4.2', folder: 'resources', default: true },
	{ name: '26.3.1', label: 'EDA 26.3.1', folder: 'resources-26.3.1' }
];

const resources: CrdResource[] = [
	{
		name: 'networkinstances.eda.nokia.com',
		kind: 'NetworkInstance',
		group: 'eda.nokia.com',
		versions: [{ name: 'v1', deprecated: false, appVersion: '' }]
	},
	{
		name: 'topologies.eda.nokia.com',
		kind: 'Topology',
		group: 'eda.nokia.com',
		versions: [{ name: 'v1alpha1', deprecated: false, appVersion: '' }]
	}
];

describe('resolveReleaseName', () => {
	it('returns matching release or fallback', () => {
		expect(resolveReleaseName(releases, '26.4.2')).toBe('26.4.2');
		expect(resolveReleaseName(releases, 'missing', releases[0])).toBe('26.4.2');
	});
});

describe('resolveCrdFromParam', () => {
	it('matches FQDN, kind, and short name', () => {
		expect(resolveCrdFromParam(resources, 'networkinstances.eda.nokia.com')?.kind).toBe(
			'NetworkInstance'
		);
		expect(resolveCrdFromParam(resources, 'NetworkInstance')?.name).toBe(
			'networkinstances.eda.nokia.com'
		);
		expect(resolveCrdFromParam(resources, 'networkinstances')?.kind).toBe('NetworkInstance');
		expect(resolveCrdFromParam(resources, 'missing')).toBeNull();
	});
});

describe('catalog URL helpers', () => {
	it('parses legacy and new params', () => {
		expect(
			parseCatalogParams(new URLSearchParams('release=26.4.2&crd=NetworkInstance&version=v1'))
		).toEqual({
			release: '26.4.2',
			crd: 'NetworkInstance',
			version: 'v1',
			browse: undefined
		});
		expect(
			parseCatalogParams(new URLSearchParams('browse=true&release=26.4.2&resource=Topology'))
		).toEqual({
			release: '26.4.2',
			crd: 'Topology',
			version: undefined,
			browse: true
		});
	});

	it('builds shareable catalog URLs without browse flag', () => {
		expect(
			buildCatalogPath({ release: '26.4.2', crd: 'NetworkInstance', version: 'v1' })
		).toBe('/?release=26.4.2&crd=NetworkInstance&version=v1');
	});

	it('builds catalog CRD modal links from kind or name', () => {
		expect(
			buildCatalogCrdPath({ release: '26.4.2', kind: 'Fabric', version: 'v1alpha1' })
		).toBe('/?release=26.4.2&crd=Fabric&version=v1alpha1');
		expect(
			buildCatalogCrdPath({
				release: '26.4.2',
				name: 'fabrics.eda.nokia.com',
				version: 'v1alpha1'
			})
		).toBe('/?release=26.4.2&crd=fabrics.eda.nokia.com&version=v1alpha1');
	});

	it('detects browse mode from release or crd', () => {
		expect(catalogBrowseFromParams(new URLSearchParams('release=26.4.2'))).toBe(true);
		expect(catalogBrowseFromParams(new URLSearchParams('crd=Topology'))).toBe(true);
		expect(catalogBrowseFromParams(new URLSearchParams('browse=true'))).toBe(true);
		expect(catalogBrowseFromParams(new URLSearchParams(''))).toBe(false);
	});

	it('prefers kind in crd param', () => {
		expect(crdParamForResource(resources[0])).toBe('NetworkInstance');
	});
});

describe('dependency map URL helpers', () => {
	it('builds focus links with resource and group params', () => {
		expect(
			buildDependencyMapFocusPath({
				release: '26.4.2',
				name: 'policys.routingpolicies.eda.nokia.com',
				kind: 'Policy',
				group: 'routingpolicies.eda.nokia.com'
			})
		).toBe(
			'/dependency-map?release=26.4.2&resource=policys.routingpolicies.eda.nokia.com&group=routingpolicies.eda.nokia.com'
		);
	});

	it('parses legacy focus param as resource', () => {
		expect(
			parseDependencyMapParams(
				new URLSearchParams('release=26.4.2&focus=interfaces.interfaces.eda.nokia.com')
			)
		).toEqual({
			release: '26.4.2',
			resource: 'interfaces.interfaces.eda.nokia.com',
			group: undefined
		});
	});
});

describe('comparison URL helpers', () => {
	it('round-trips release pair params', () => {
		const parsed = parseComparisonParams(
			new URLSearchParams('sr=26.4.2&sv=v1&tr=26.3.1&tv=v1alpha1')
		);
		expect(buildComparisonPath(parsed)).toBe(
			'/comparison?sr=26.4.2&sv=v1&tr=26.3.1&tv=v1alpha1'
		);
	});
});

describe('spec search URL helpers', () => {
	it('omits empty version and keeps query', () => {
		expect(buildSpecSearchPath({ release: '26.4.2', query: 'vlan' })).toBe(
			'/spec-search?release=26.4.2&q=vlan'
		);
		expect(buildSpecSearchPath({ release: '26.4.2', version: '*', query: 'admin' })).toBe(
			'/spec-search?release=26.4.2&version=*&q=admin'
		);
	});

	it('parses spec search params', () => {
		expect(parseSpecSearchParams(new URLSearchParams('release=26.4.2&q=multihoming'))).toEqual({
			release: '26.4.2',
			version: undefined,
			query: 'multihoming'
		});
	});

	it('normalizes invalid version to latest-per-crd', () => {
		expect(normalizeSpecSearchVersion('v9', ['v1', 'v2'])).toBe('');
		expect(normalizeSpecSearchVersion('*', ['v1'])).toBe('*');
		expect(normalizeSpecSearchVersion('v1', ['v1'])).toBe('v1');
	});
});
