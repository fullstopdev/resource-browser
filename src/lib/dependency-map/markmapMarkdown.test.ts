import { describe, expect, it } from 'vitest';
import {
	buildIntentMarkmapMarkdown,
	getIntentMarkmapStats,
	isIntentDependencyLink,
	isMapTopologyDependsOnLink,
	isMapTopologyLink,
	isMapTopologyRequiredByLink,
	isSchemaIntentRelation,
	isTopologyLayoutLink
} from './markmapMarkdown';
import type { DependencyGraph } from './types';

const graph: DependencyGraph = {
	releaseFolder: 'resources/26.4.2',
	generatedAt: '2026-01-01',
	nodes: [
		{ id: 'topologies.topologies.eda.nokia.com', kind: 'Topology', group: 'topologies.eda.nokia.com', type: 'config', version: 'v1', shortName: 'topologies' },
		{ id: 'routers.services.eda.nokia.com', kind: 'Router', group: 'services.eda.nokia.com', type: 'config', version: 'v1', shortName: 'routers' },
		{ id: 'alarmoverlays.topologies.eda.nokia.com', kind: 'AlarmOverlay', group: 'topologies.eda.nokia.com', type: 'config', version: 'v1', shortName: 'alarmoverlays' }
	],
	links: [
		{
			id: 'l1',
			source: 'topologies.topologies.eda.nokia.com',
			target: 'routers.services.eda.nokia.com',
			rel: 'references',
			field: 'spec.router',
			edgeClass: 'intentDependency',
			edgeSource: 'semantic'
		},
		{
			id: 'l2',
			source: 'alarmoverlays.topologies.eda.nokia.com',
			target: 'topologies.topologies.eda.nokia.com',
			rel: 'observes',
			field: 'spec.topology',
			edgeClass: 'intentDependency',
			edgeSource: 'catalog'
		},
		{
			id: 'l3',
			source: 'topologies.topologies.eda.nokia.com',
			target: 'routers.services.eda.nokia.com',
			rel: 'references',
			field: 'spec.explicitRef',
			edgeClass: 'hardRef',
			edgeSource: 'explicit'
		},
		{
			id: 'l4',
			source: 'topologies.topologies.eda.nokia.com',
			target: 'deployments.apps.eda.nokia.com',
			rel: 'deploys',
			edgeClass: 'intentDependency',
			edgeSource: 'catalog'
		},
		{
			id: 'l5',
			source: 'topologies.topologies.eda.nokia.com',
			target: 'policys.routingpolicies.eda.nokia.com',
			rel: 'appliesTo',
			field: 'spec.policy',
			edgeClass: 'intentDependency',
			edgeSource: 'semantic'
		}
	]
};

describe('isSchemaIntentRelation', () => {
	it('allows schema and lifecycle intent relations', () => {
		expect(isSchemaIntentRelation('references')).toBe(true);
		expect(isSchemaIntentRelation('observes')).toBe(true);
		expect(isSchemaIntentRelation('orchestrates')).toBe(true);
	});

	it('excludes operational catalog pairings and structural noise', () => {
		expect(isSchemaIntentRelation('deploys')).toBe(false);
		expect(isSchemaIntentRelation('appliesTo')).toBe(false);
		expect(isSchemaIntentRelation('member')).toBe(false);
		expect(isSchemaIntentRelation('memberOf')).toBe(false);
	});
});

describe('isIntentDependencyLink', () => {
	it('includes semantic and catalog intent edges', () => {
		expect(isIntentDependencyLink(graph.links[0])).toBe(true);
		expect(isIntentDependencyLink(graph.links[1])).toBe(true);
	});

	it('excludes hardRef edges', () => {
		expect(isIntentDependencyLink(graph.links[2])).toBe(false);
	});

	it('excludes deploys and appliesTo operational edges', () => {
		expect(isIntentDependencyLink(graph.links[3]!)).toBe(false);
		expect(isIntentDependencyLink(graph.links[4]!)).toBe(false);
	});
});

describe('isMapTopologyLink', () => {
	it('includes hardRef and filtered intent edges', () => {
		expect(isMapTopologyLink(graph.links[0])).toBe(true);
		expect(isMapTopologyLink(graph.links[1])).toBe(true);
		expect(isMapTopologyLink(graph.links[2])).toBe(true);
	});

	it('excludes deploys and appliesTo even when hardRef', () => {
		expect(isMapTopologyLink(graph.links[3]!)).toBe(false);
		expect(isMapTopologyLink(graph.links[4]!)).toBe(false);
	});
});

describe('isMapTopologyRequiredByLink', () => {
	it('includes appliesTo consumers for the left column', () => {
		expect(isMapTopologyRequiredByLink(graph.links[4]!)).toBe(true);
	});

	it('still excludes deploys', () => {
		expect(isMapTopologyRequiredByLink(graph.links[3]!)).toBe(false);
	});
});

describe('isMapTopologyDependsOnLink', () => {
	it('includes appliesTo prerequisites for the right column', () => {
		expect(isMapTopologyDependsOnLink(graph.links[4]!)).toBe(true);
	});

	it('still excludes deploys', () => {
		expect(isMapTopologyDependsOnLink(graph.links[3]!)).toBe(false);
	});

	it('includes ordinary map topology links', () => {
		expect(isMapTopologyDependsOnLink(graph.links[0]!)).toBe(true);
		expect(isMapTopologyDependsOnLink(graph.links[2]!)).toBe(true);
	});
});

describe('isTopologyLayoutLink', () => {
	it('includes appliesTo required-by links excluded from isMapTopologyLink', () => {
		expect(isMapTopologyLink(graph.links[4]!)).toBe(false);
		expect(isTopologyLayoutLink(graph.links[4]!)).toBe(true);
	});

	it('includes ordinary map topology links', () => {
		expect(isTopologyLayoutLink(graph.links[0]!)).toBe(true);
	});
});

describe('buildIntentMarkmapMarkdown', () => {
	it('builds markdown with focus kind, frontmatter, and bullet hierarchy', () => {
		const md = buildIntentMarkmapMarkdown(graph, 'topologies.topologies.eda.nokia.com');
		expect(md).toContain('---');
		expect(md).toContain('markmap:');
		expect(md).toContain('color:');
		expect(md).toContain('# Topology');
		expect(md).toContain('- **Uses upstream** (1)');
		expect(md).toContain('- **Schema reference** (1)');
		expect(md).toContain('- Router');
		expect(md).toContain('- **Consumers** (1)');
		expect(md).toContain('- **Watches state** (1)');
		expect(md).toContain('- AlarmOverlay');
		expect(md).not.toContain('explicitRef');
		expect(md).not.toContain('## Uses upstream');
	});

	it('filters by depSearch', () => {
		const md = buildIntentMarkmapMarkdown(graph, 'topologies.topologies.eda.nokia.com', {
			depSearch: 'alarm'
		});
		expect(md).toContain('AlarmOverlay');
		expect(md).not.toContain('- Router');
	});
});

describe('getIntentMarkmapStats', () => {
	it('returns dependency counts for focus node', () => {
		const stats = getIntentMarkmapStats(graph, 'topologies.topologies.eda.nokia.com');
		expect(stats.dependsOn).toBe(1);
		expect(stats.requiredBy).toBe(1);
		expect(stats.hasData).toBe(true);
	});
});
