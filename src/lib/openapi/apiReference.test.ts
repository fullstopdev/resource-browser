import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPathBrowserData } from './pathBrowser';
import { buildApiSections, curlForAction, findAction, parseEdaPath } from './apiReference';

const RELEASE = 'static/openapi/26.8.2';
const manifest = JSON.parse(readFileSync(`${RELEASE}/manifest.json`, 'utf8')) as Array<{
	id: string;
	file: string;
}>;
const crds = new Map<string, string>(
	(
		JSON.parse(readFileSync('static/resources/26.8.2/manifest.json', 'utf8')) as Array<{
			name: string;
			kind?: string;
		}>
	).map((c) => [c.name, c.kind ?? ''])
);

function sectionsFor(id: string) {
	const entry = manifest.find((e) => e.id === id)!;
	const spec = JSON.parse(readFileSync(`${RELEASE}/${entry.file}`, 'utf8'));
	const ops = buildPathBrowserData(spec).tagGroups.flatMap((g) => g.operations);
	return buildApiSections(ops, { kindFor: (plural, group) => crds.get(`${plural}.${group}`) });
}

describe('parseEdaPath', () => {
	it('reads namespaced item and sub-resource paths', () => {
		expect(
			parseEdaPath(
				'/apps/services.eda.nokia.com/v2/namespaces/{namespace}/bridgedomains/{name}/_revs'
			)
		).toMatchObject({
			prefix: 'apps',
			plural: 'bridgedomains',
			namespaced: true,
			named: true,
			sub: '_revs'
		});
		expect(parseEdaPath('/workflows/v1/oam.eda.nokia.com/v1/pings')).toMatchObject({
			prefix: 'workflows',
			plural: 'pings',
			namespaced: false
		});
	});

	it('ignores API discovery and core paths', () => {
		expect(parseEdaPath('/apps/services.eda.nokia.com/v2')).toBeNull();
		expect(parseEdaPath('/apps/services.eda.nokia.com/v2/_ui/{pathname}')).toBeNull();
		expect(parseEdaPath('/core/query/v1/eql')).toBeNull();
	});
});

describe('buildApiSections', () => {
	it('turns the Services API into resources with plain-language actions', () => {
		const sections = sectionsFor('services.eda.nokia.com/v2');
		const bd = sections.find((s) => s.title === 'BridgeDomain')!;
		expect(bd).toMatchObject({ type: 'resource', plural: 'bridgedomains', scope: 'Namespaced' });
		expect(bd.actions.map((a) => a.label)).toEqual([
			'List in namespace',
			'List in all namespaces',
			'Get',
			'Revision history',
			'Intent targets',
			'Deleted instances',
			'Create',
			'Replace',
			'Patch',
			'Delete',
			'Delete all in namespace',
			'Topology'
		]);
		expect(bd.actions.find((a) => a.key === 'create')!.title).toBe('Create a BridgeDomain');
		expect(
			sections.find((s) => s.title === 'IRBInterface')!.actions.find((a) => a.key === 'get')!.title
		).toBe('Get an IRBInterface');
		expect(sections.at(-1)!.type).toBe('discovery');
	});

	it('labels cluster-scoped resources without namespaces', () => {
		const topology = sectionsFor('topologies.eda.nokia.com/v1').find(
			(s) => s.title === 'Topology'
		)!;
		expect(topology.scope).toBe('Cluster');
		expect(topology.actions.map((a) => a.label)).toContain('List');
		expect(topology.actions.map((a) => a.label)).toContain('Delete all');
	});

	it('gives workflows run, logs, input and terminate actions', () => {
		const ping = sectionsFor('oam.eda.nokia.com/v1').find((s) => s.title === 'Ping')!;
		expect(ping.type).toBe('workflow');
		expect(ping.actions.map((a) => a.label)).toEqual(
			expect.arrayContaining([
				'Run',
				'Get run',
				'Logs',
				'Artifacts',
				'Get artifact',
				'Submit input',
				'Terminate'
			])
		);
	});

	it('groups the platform API by section, Query first', () => {
		const sections = sectionsFor('core');
		expect(sections.every((s) => s.type === 'platform')).toBe(true);
		expect(sections[0]!.title).toBe('Query (EQL & NQL)');
		expect(sections.map((s) => s.title)).toContain('Transactions');
		const total = sections.reduce((n, s) => n + s.actions.length, 0);
		expect(total).toBeGreaterThan(150);
	});

	it('finds an action by operationId and builds a ready-to-run curl', () => {
		const sections = sectionsFor('services.eda.nokia.com/v2');
		const hit = findAction(sections, 'createServicesEdaNokiaComV2NamespaceBridgedomains')!;
		expect(hit.section.title).toBe('BridgeDomain');
		const curl = curlForAction(hit.action, hit.section);
		expect(curl).toContain('curl -X POST');
		expect(curl).toContain('Authorization: Bearer $TOKEN');
		expect(curl).toContain('-d @my-bridge-domain.json');
		expect(curl).toContain('/apps/services.eda.nokia.com/v2/namespaces/eda/bridgedomains"');
	});

	it('covers every operation of every 26.8.2 spec exactly once', () => {
		for (const entry of manifest) {
			const spec = JSON.parse(readFileSync(`${RELEASE}/${entry.file}`, 'utf8'));
			const ops = buildPathBrowserData(spec).tagGroups.flatMap((g) => g.operations);
			const actions = buildApiSections(ops).flatMap((s) => s.actions);
			expect(actions.length, entry.id).toBe(ops.length);
		}
	});
});
