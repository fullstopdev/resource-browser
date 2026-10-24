import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { apiCategory, groupApisByCategory, resourcePath, searchApiIndex } from './apiCategories';

describe('apiCategory', () => {
	it('puts every API of every synced release in a real category', () => {
		for (const rel of readdirSync('static/openapi', { withFileTypes: true })) {
			if (!rel.isDirectory()) continue;
			let index: { apis: Array<{ group: string; platform: boolean }> };
			try {
				index = JSON.parse(readFileSync(`static/openapi/${rel.name}/api-index.json`, 'utf8'));
			} catch {
				continue;
			}
			const other = index.apis.filter((a) => apiCategory(a) === 'other').map((a) => a.group);
			expect(other, `uncategorised APIs in ${rel.name}`).toEqual([]);
		}
	});

	it('groups in category order with the platform first', () => {
		const groups = groupApisByCategory([
			{ group: 'protocols.eda.nokia.com' },
			{ group: 'core', platform: true },
			{ group: 'fabrics.eda.nokia.com' }
		]);
		expect(groups.map((g) => g.category.id)).toEqual(['platform', 'fabric', 'routing']);
	});
});

describe('resourcePath', () => {
	it('derives a collection path that exists in the 26.8.2 specs', () => {
		const dir = 'static/openapi/26.8.2';
		const index = JSON.parse(readFileSync(`${dir}/api-index.json`, 'utf8'));
		const paths = new Set<string>();
		const walk = (d: string) => {
			for (const e of readdirSync(d, { withFileTypes: true })) {
				if (e.isDirectory()) walk(`${d}/${e.name}`);
				else if (e.name.endsWith('.json')) {
					const spec = JSON.parse(readFileSync(`${d}/${e.name}`, 'utf8'));
					for (const p of Object.keys(spec.paths ?? {})) paths.add(p);
				}
			}
		};
		walk(`${dir}/apps`);
		const missing: string[] = [];
		for (const api of index.apis) {
			if (api.platform) continue;
			for (const s of api.sections) {
				const p = resourcePath(api, s);
				if (!paths.has(p)) missing.push(p);
			}
		}
		expect(missing).toEqual([]);
	});
});

describe('searchApiIndex', () => {
	const apis = [
		{
			id: 'protocols',
			title: 'Protocols',
			group: 'protocols.eda.nokia.com',
			version: 'v2',
			platform: false,
			sections: [
				{ key: 'defaultbgppeers', type: 'resource', title: 'DefaultBGPPeer', actions: 12 },
				{ key: 'bgppeers', type: 'resource', title: 'BGPPeer', actions: 12 },
				{ key: 'bgpgroups', type: 'resource', title: 'BGPGroup', actions: 12 }
			]
		}
	];

	it('ranks the exact kind, then prefixes, then substrings', () => {
		expect(searchApiIndex(apis, 'bgppeer').map((h) => h.title)).toEqual([
			'BGPPeer',
			'DefaultBGPPeer'
		]);
		expect(searchApiIndex(apis, 'bgp')[0]!.title).toBe('BGPGroup');
		expect(searchApiIndex(apis, 'bgp')[0]!.category).toBe('routing');
	});

	it('returns nothing for an empty query', () => {
		expect(searchApiIndex(apis, '  ')).toEqual([]);
	});
});

describe('CRD API groups', () => {
	it('puts every CRD group of every release in a real category', () => {
		for (const rel of readdirSync('static/resources', { withFileTypes: true })) {
			if (!rel.isDirectory()) continue;
			let manifest: Array<{ name: string; group?: string; versions?: unknown[] }>;
			try {
				manifest = JSON.parse(readFileSync(`static/resources/${rel.name}/manifest.json`, 'utf8'));
			} catch {
				continue;
			}
			const other = [
				...new Set(
					manifest
						.map((c) => c.group || c.name.split('.').slice(1).join('.'))
						// An entry with no group at all (25.12.1 lists a bare "resources") is shown under
						// Other in the catalog; every real group needs a category.
						.filter((group) => group && apiCategory({ group }) === 'other')
				)
			];
			expect(other, `uncategorised CRD groups in ${rel.name}`).toEqual([]);
		}
	});
});
