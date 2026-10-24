import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { apiCategory, groupApisByCategory } from './apiCategories';

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
