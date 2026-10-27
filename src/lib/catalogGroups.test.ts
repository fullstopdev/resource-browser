import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCatalogGroups, catalogCategories, filterCatalog } from './catalogGroups';
import type { CrdResource } from './structure';

const manifest = (release: string) =>
	JSON.parse(readFileSync(`static/resources/${release}/manifest.json`, 'utf8')) as CrdResource[];

const all = { query: '', type: 'all' as const, category: '', group: '' };
const kinds = (groups: ReturnType<typeof filterCatalog>) =>
	groups.flatMap((g) => g.resources.map((r) => r.kind));

describe('catalog groups', () => {
	const groups = buildCatalogGroups(manifest('26.8.2'));

	it('keeps every CRD, grouped by API group and categorised', () => {
		expect(groups.reduce((n, g) => n + g.resources.length, 0)).toBe(358);
		expect(groups.find((g) => g.short === 'protocols')?.category.id).toBe('routing');
		expect(groups.every((g) => g.category.id !== 'other')).toBe(true);
	});

	it('searches with the whole query, not just its first letter', () => {
		const bgp = kinds(filterCatalog(groups, { ...all, query: 'bgp' }));
		expect(bgp).toContain('BGPPeer');
		expect(bgp).not.toContain('Backend');
		expect(bgp.length).toBeLessThan(15);
		expect(kinds(filterCatalog(groups, { ...all, query: 'bgp peer' }))).toEqual(
			expect.arrayContaining(['BGPPeer', 'DefaultBGPPeer'])
		);
	});

	it('searches every group even with a group selected', () => {
		const hits = kinds(
			filterCatalog(groups, { ...all, query: 'accountingpolicy', group: 'protocols.eda.nokia.com' })
		);
		expect(hits).toContain('AccountingPolicy');
	});

	it('narrows to a category or a group when not searching', () => {
		const routing = filterCatalog(groups, { ...all, category: 'routing' });
		expect(routing.map((g) => g.short)).toContain('protocols');
		expect(routing.map((g) => g.short)).not.toContain('aaa');
		const aaa = filterCatalog(groups, { ...all, group: 'aaa.eda.nokia.com' });
		expect(aaa).toHaveLength(1);
	});

	it('filters config and state CRDs', () => {
		const state = kinds(filterCatalog(groups, { ...all, type: 'state' }));
		expect(state.every((k) => k.endsWith('State'))).toBe(true);
	});

	it('lists the categories that have groups', () => {
		const cats = catalogCategories(groups);
		expect(cats[0]!.category.id).toBe('platform');
		expect(cats.reduce((n, c) => n + c.crds, 0)).toBe(358);
	});

	it('shows entries without versions or a group under Other', () => {
		const old = buildCatalogGroups(manifest('25.12.1'));
		const other = old.find((g) => g.group === '');
		expect(other?.category.id).toBe('other');
		expect(other?.resources.map((r) => r.name)).toContain('resources');
	});
});
