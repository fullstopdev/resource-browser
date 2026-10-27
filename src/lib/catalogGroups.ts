/**
 * The CRD catalog's data: every CRD of a release by API group, the groups by category (the same
 * categories as the API reference), and the filter behind the catalog's search and sidebar.
 * Groups come from the release's own CRD list, so they follow whatever a release ships.
 */
import { API_CATEGORIES, apiCategory, type ApiCategory } from '$lib/openapi/apiCategories';
import { displayGroup, displayKind } from '$lib/resourceSearch';
import type { CrdResource } from '$lib/structure';

export type CatalogGroup = {
	/** `protocols.eda.nokia.com`, or '' for entries without a group. */
	group: string;
	/** `protocols` */
	short: string;
	/** `Protocols`, from the release's API titles when known. */
	title: string;
	category: ApiCategory;
	resources: CrdResource[];
};

export type CatalogFilter = {
	query: string;
	type: 'all' | 'config' | 'state';
	/** Category id, or '' for all. Ignored while searching. */
	category: string;
	/** API group, or '' for all. Ignored while searching. */
	group: string;
};

const OTHER = API_CATEGORIES.find((c) => c.id === 'other')!;

/** `protocols.eda.nokia.com` → `protocols` */
export const shortGroup = (group: string) => group.replace(/\.eda\.nokia\.com$/, '');

export function groupTitle(group: string, titles: Record<string, string> = {}): string {
	if (!group) return 'No API group';
	if (titles[group]) return titles[group]!;
	const first = group.split('.')[0] ?? group;
	return first.charAt(0).toUpperCase() + first.slice(1);
}

export function isStateCrd(res: CrdResource): boolean {
	return res.name.toLowerCase().includes('states');
}

/**
 * Every CRD by API group, in category order, then A–Z by short name; CRDs A–Z. Entries without a
 * group or without versions are kept (under Other).
 */
export function buildCatalogGroups(
	resources: CrdResource[],
	titles: Record<string, string> = {}
): CatalogGroup[] {
	const byGroup = new Map<string, CrdResource[]>();
	for (const res of resources) {
		const g = displayGroup(res);
		byGroup.set(g, [...(byGroup.get(g) ?? []), res]);
	}
	const order = (c: ApiCategory) => API_CATEGORIES.indexOf(c);
	return [...byGroup]
		.map(([group, list]) => {
			const id = group ? apiCategory({ group }) : 'other';
			return {
				group,
				short: group ? shortGroup(group) : 'other',
				title: groupTitle(group, titles),
				category: API_CATEGORIES.find((c) => c.id === id) ?? OTHER,
				resources: [...list].sort((a, b) => displayKind(a).localeCompare(displayKind(b)))
			};
		})
		.sort((a, b) => order(a.category) - order(b.category) || a.short.localeCompare(b.short));
}

/** Categories that have groups in this release, each with its groups. */
export function catalogCategories(
	groups: CatalogGroup[]
): Array<{ category: ApiCategory; groups: CatalogGroup[]; crds: number }> {
	return API_CATEGORIES.map((category) => {
		const list = groups.filter((g) => g.category.id === category.id);
		return { category, groups: list, crds: list.reduce((n, g) => n + g.resources.length, 0) };
	}).filter((c) => c.groups.length > 0);
}

/**
 * The groups to show, each with its matching CRDs. A search covers every CRD of the release
 * (kind, CRD name, group, group title; every word must match); otherwise the category or group
 * selection applies. The Config / State filter always applies.
 */
export function filterCatalog(groups: CatalogGroup[], filter: CatalogFilter): CatalogGroup[] {
	const terms = filter.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	const searching = terms.length > 0;
	return groups
		.filter(
			(g) =>
				searching ||
				(filter.group
					? g.group === filter.group
					: !filter.category || g.category.id === filter.category)
		)
		.map((g) => ({
			...g,
			resources: g.resources.filter((res) => {
				if (filter.type === 'state' && !isStateCrd(res)) return false;
				if (filter.type === 'config' && isStateCrd(res)) return false;
				if (!searching) return true;
				const haystack = `${res.name} ${displayKind(res)} ${g.group} ${g.title}`.toLowerCase();
				return terms.every((t) => haystack.includes(t));
			})
		}))
		.filter((g) => g.resources.length > 0);
}
