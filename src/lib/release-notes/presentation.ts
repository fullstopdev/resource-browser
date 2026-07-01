import { enumValueDelta, isSchemaMetadataPath } from '$lib/comparison/fieldChangeClassifier';
import { HIGH_RISK_CHANGE_TYPES } from './constants';
import type { ReleaseTone } from './constants';
import type {
	DeprecatedItem,
	FieldChange,
	FieldChangeType,
	ModifiedResource,
	NewResource,
	ReleaseNotes,
	ReleaseNotesEntry
} from './types';

export type OperationalArea =
	| 'BGP'
	| 'EVPN'
	| 'Interfaces'
	| 'Topology'
	| 'Policies'
	| 'Platform'
	| 'Other';

export type ListSortMode = 'kind-asc' | 'kind-desc' | 'severity' | 'change-type';

export type TextSegment = { text: string; match: boolean };

const FIELD_LABELS: Record<string, string> = {
	addressfamily: 'BGP address-family declaration',
	peeras: 'BGP peer autonomous system',
	localas: 'local BGP autonomous system',
	holdtime: 'BGP session hold timer',
	keepalive: 'BGP keepalive interval',
	neighbors: 'BGP neighbor set',
	neighborset: 'BGP neighbor set',
	routereflector: 'route reflector role',
	evpn: 'EVPN service instance',
	vni: 'VXLAN network identifier',
	esi: 'Ethernet segment identifier',
	interface: 'interface binding',
	interfaces: 'interface bindings',
	interfaceselectors: 'interface selector rules',
	port: 'port assignment',
	ethernet: 'Ethernet port settings',
	lag: 'link aggregation group',
	breakout: 'port breakout mode',
	topology: 'fabric topology reference',
	fabric: 'fabric membership',
	node: 'node placement',
	site: 'site association',
	link: 'inter-switch link',
	policy: 'routing or forwarding policy',
	routepolicy: 'route policy',
	prefix: 'IP prefix match',
	filter: 'route filter',
	community: 'BGP community',
	extendedcommunity: 'BGP extended community',
	rd: 'route distinguisher',
	rt: 'route target',
	vrf: 'VRF instance',
	vlan: 'VLAN identifier',
	subnet: 'IP subnet',
	asn: 'autonomous system number'
};

const CHANGE_TYPE_ORDER: Record<FieldChangeType, number> = {
	required_added: 0,
	removed: 1,
	enum_removed: 2,
	enum_changed: 3,
	type_change: 4,
	default_changed: 5,
	enum_added: 6,
	added: 7,
	optional_added: 8
};

function camelToWords(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[-_]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^./, (c) => c.toUpperCase());
}

function leafSegment(field: string): string {
	const segments = field.split('.');
	return segments[segments.length - 1] ?? field;
}

export function humanizeFieldPath(field: string): string {
	const normalized = field.replace(/^spec\./, '').replace(/^status\./, 'status.');
	const leaf = leafSegment(normalized);
	const leafLower = leaf.toLowerCase();

	if (FIELD_LABELS[leafLower]) return FIELD_LABELS[leafLower];
	if (leafLower.startsWith('x-kubernetes-')) {
		return 'Kubernetes schema validation rule';
	}

	const words = camelToWords(leaf);
	if (normalized.startsWith('status.')) {
		return `Operational status — ${words}`;
	}
	return words;
}

export function isPresentationMetadataField(field: string): boolean {
	if (field.includes('x-kubernetes-')) return true;
	return isSchemaMetadataPath(field);
}

export function partitionFieldChanges(changes: FieldChange[]): {
	operational: FieldChange[];
	metadata: FieldChange[];
} {
	const operational: FieldChange[] = [];
	const metadata: FieldChange[] = [];
	for (const change of changes) {
		if (isPresentationMetadataField(change.field)) metadata.push(change);
		else operational.push(change);
	}
	return { operational, metadata };
}

export function inferOperationalArea(kind: string, group?: string): OperationalArea {
	const haystack = `${kind} ${group ?? ''}`.toLowerCase();

	if (/bgp|peer|neighbor|community|aspath|autonomous.?system/.test(haystack)) return 'BGP';
	if (/evpn|vxlan|esi|vni|ethernet.?segment/.test(haystack)) return 'EVPN';
	if (/interface|port|ethernet|lag|breakout|subinterface/.test(haystack)) return 'Interfaces';
	if (/topology|fabric|link|node|site|leaf|spine/.test(haystack)) return 'Topology';
	if (/policy|route|prefix|filter|acl|rt\b|rd\b|vrf|routing/.test(haystack)) return 'Policies';
	if (/core\.eda|bootstrap|engine|platform|cluster|init/.test(haystack)) return 'Platform';

	return 'Other';
}

const OPERATIONAL_AREA_ORDER: OperationalArea[] = [
	'BGP',
	'EVPN',
	'Interfaces',
	'Topology',
	'Policies',
	'Platform',
	'Other'
];

export function groupModifiedByOperationalArea(
	resources: ModifiedResource[]
): Array<{ area: OperationalArea; resources: ModifiedResource[] }> {
	const buckets = new Map<OperationalArea, ModifiedResource[]>();

	for (const resource of resources) {
		const area = inferOperationalArea(resource.kind, resource.apiVersion?.split('/')[0]);
		const list = buckets.get(area) ?? [];
		list.push(resource);
		buckets.set(area, list);
	}

	return OPERATIONAL_AREA_ORDER.filter((area) => buckets.has(area)).map((area) => ({
		area,
		resources: buckets.get(area)!.sort((a, b) => a.kind.localeCompare(b.kind))
	}));
}

export function displayNetworkBehavior(change: FieldChange, kind: string): string {
	const label = humanizeFieldPath(change.field);
	const delta = change.changeType.startsWith('enum')
		? enumValueDelta(change.before, change.after)
		: null;

	switch (change.changeType) {
		case 'required_added':
			return `Manifests without ${label} will fail reconciliation — existing ${kind} objects need this field before apply.`;
		case 'removed':
			return `Remove ${label} from ${kind} manifests before upgrade; stale values block controller sync.`;
		case 'type_change':
			return `${label} on ${kind} changed structure — validate configured values against the target release schema.`;
		case 'enum_removed': {
			const removed = delta?.removed.join(', ') ?? 'value(s)';
			return `${label} on ${kind} dropped allowed value(s): ${removed} — confirm running config still matches the enum.`;
		}
		case 'enum_added': {
			const added = delta?.added.join(', ') ?? 'value(s)';
			return `${label} on ${kind} gained allowed value(s): ${added}; existing manifests stay valid until you adopt the new option(s).`;
		}
		case 'enum_changed': {
			const added = delta?.added.join(', ') ?? 'none';
			const removed = delta?.removed.join(', ') ?? 'none';
			return `${label} on ${kind} allowed values changed — added: ${added}; removed: ${removed}. Review manifests using removed values.`;
		}
		case 'default_changed':
			return `Default for ${label} on ${kind} shifted; objects omitting this field may behave differently post-upgrade.`;
		case 'optional_added':
		case 'added':
			return `New optional ${label} on ${kind}; existing manifests stay valid until you adopt the field.`;
		default:
			return change.networkBehavior || `Review ${label} on ${kind} before rolling this release to production.`;
	}
}

const WARNING_CHANGE_TYPES = new Set<FieldChangeType>([
	'type_change',
	'enum_changed',
	'default_changed'
]);

export function changeTypeLabel(changeType: FieldChangeType): string {
	return changeType.replace(/_/g, ' ');
}

export function changeTypeBadgeClass(changeType: FieldChangeType): string {
	if (WARNING_CHANGE_TYPES.has(changeType)) {
		return 'release-notes-change-badge release-notes-change-badge--warning';
	}
	if (HIGH_RISK_CHANGE_TYPES.has(changeType)) {
		return 'release-notes-change-badge release-notes-change-badge--breaking';
	}
	return 'release-notes-change-badge release-notes-change-badge--safe';
}

export function inferReleaseTone(fromVer: string, toVer: string): ReleaseTone {
	const fromMajor = parseInt(fromVer.split('.')[0], 10);
	const toMajor = parseInt(toVer.split('.')[0], 10);
	if (fromMajor !== toMajor) return 'high';
	if (fromVer.split('.')[1] !== toVer.split('.')[1]) return 'medium';
	return 'low';
}

export function countOperationalChanges(notes: ReleaseNotes): number {
	return notes.modifiedResources.reduce((total, resource) => {
		const { operational } = partitionFieldChanges(resource.changes);
		return total + operational.length;
	}, 0);
}

export function highlightSegments(text: string, query: string): TextSegment[] {
	const q = query.trim();
	if (!q) return [{ text, match: false }];

	const lowerText = text.toLowerCase();
	const lowerQ = q.toLowerCase();
	const segments: TextSegment[] = [];
	let cursor = 0;

	while (cursor < text.length) {
		const idx = lowerText.indexOf(lowerQ, cursor);
		if (idx === -1) {
			segments.push({ text: text.slice(cursor), match: false });
			break;
		}
		if (idx > cursor) {
			segments.push({ text: text.slice(cursor, idx), match: false });
		}
		segments.push({ text: text.slice(idx, idx + q.length), match: true });
		cursor = idx + q.length;
	}

	return segments.length > 0 ? segments : [{ text, match: false }];
}

export function sortFieldChanges(changes: FieldChange[], sort: ListSortMode): FieldChange[] {
	const sorted = [...changes];
	switch (sort) {
		case 'kind-desc':
		case 'kind-asc':
			return sorted.sort((a, b) => a.field.localeCompare(b.field));
		case 'severity':
			return sorted.sort(
				(a, b) =>
					(CHANGE_TYPE_ORDER[a.changeType] ?? 99) - (CHANGE_TYPE_ORDER[b.changeType] ?? 99) ||
					a.field.localeCompare(b.field)
			);
		case 'change-type':
			return sorted.sort(
				(a, b) =>
					a.changeType.localeCompare(b.changeType) || a.field.localeCompare(b.field)
			);
		default:
			return sorted;
	}
}

export function sortDeprecatedItems(items: DeprecatedItem[], sort: ListSortMode): DeprecatedItem[] {
	const sorted = [...items];
	switch (sort) {
		case 'kind-desc':
			return sorted.sort((a, b) => b.kind.localeCompare(a.kind));
		case 'severity':
			return sorted.sort(
				(a, b) =>
					(b.deprecatedVersions.filter((v) => v.newInRelease).length || 0) -
						(a.deprecatedVersions.filter((v) => v.newInRelease).length || 0) ||
					a.kind.localeCompare(b.kind)
			);
		case 'change-type':
		case 'kind-asc':
		default:
			return sorted.sort((a, b) => a.kind.localeCompare(b.kind));
	}
}

export type GroupedNewResource = {
	kind: string;
	group: string;
	crdName?: string;
	apiVersions: Array<{ apiVersion: string; description: string }>;
	description: string;
};

export function deriveGroupFromApiVersion(apiVersion: string): string {
	const slash = apiVersion.indexOf('/');
	return slash > 0 ? apiVersion.slice(0, slash) : apiVersion;
}

export function groupNewResourcesByKind(items: NewResource[]): GroupedNewResource[] {
	const map = new Map<string, GroupedNewResource>();

	for (const item of items) {
		const group = item.group ?? deriveGroupFromApiVersion(item.apiVersion);
		const existing = map.get(item.kind);

		if (existing) {
			if (!existing.apiVersions.some((v) => v.apiVersion === item.apiVersion)) {
				existing.apiVersions.push({
					apiVersion: item.apiVersion,
					description: item.description
				});
			}
			if (item.crdName && !existing.crdName) existing.crdName = item.crdName;
			if (item.group && existing.group !== item.group) {
				existing.group = item.group;
			}
		} else {
			map.set(item.kind, {
				kind: item.kind,
				group,
				crdName: item.crdName,
				apiVersions: [{ apiVersion: item.apiVersion, description: item.description }],
				description: item.description
			});
		}
	}

	return Array.from(map.values()).map((g) => {
		const uniqueDescriptions = [...new Set(g.apiVersions.map((v) => v.description))];
		return {
			...g,
			description: uniqueDescriptions.length === 1 ? uniqueDescriptions[0] : uniqueDescriptions[0],
			apiVersions: [...g.apiVersions].sort((a, b) => a.apiVersion.localeCompare(b.apiVersion))
		};
	});
}

function sortGroupedNewResources(
	items: GroupedNewResource[],
	sort: ListSortMode
): GroupedNewResource[] {
	const sorted = [...items];
	switch (sort) {
		case 'kind-desc':
			return sorted.sort((a, b) => b.kind.localeCompare(a.kind));
		case 'change-type':
			return sorted.sort(
				(a, b) =>
					(a.apiVersions[0]?.apiVersion ?? '').localeCompare(b.apiVersions[0]?.apiVersion ?? '') ||
					a.kind.localeCompare(b.kind)
			);
		case 'severity':
		case 'kind-asc':
		default:
			return sorted.sort((a, b) => a.kind.localeCompare(b.kind));
	}
}

export function groupNewResourcesByOperationalArea(
	items: GroupedNewResource[],
	sort: ListSortMode = 'kind-asc'
): Array<{ area: OperationalArea; resources: GroupedNewResource[] }> {
	const sorted = sortGroupedNewResources(items, sort);
	const buckets = new Map<OperationalArea, GroupedNewResource[]>();

	for (const item of sorted) {
		const area = inferOperationalArea(item.kind, item.group);
		const list = buckets.get(area) ?? [];
		list.push(item);
		buckets.set(area, list);
	}

	return OPERATIONAL_AREA_ORDER.filter((area) => buckets.has(area)).map((area) => ({
		area,
		resources: buckets.get(area)!
	}));
}

export function catalogBrowseHref(release: string, crdName?: string): string {
	const params = new URLSearchParams({ browse: 'true', release });
	if (crdName) params.set('resource', crdName);
	return `/?${params.toString()}`;
}

export function comparisonPageHref(fromVer: string, toVer: string): string {
	return `/comparison?sr=${encodeURIComponent(fromVer)}&tr=${encodeURIComponent(toVer)}`;
}

export function validateYamlHref(release: string): string {
	return `/validate-yaml?release=${encodeURIComponent(release)}`;
}

export function specSearchHref(release: string): string {
	return `/spec-search?release=${encodeURIComponent(release)}`;
}

export function dependencyMapHref(release: string): string {
	return `/dependency-map?release=${encodeURIComponent(release)}`;
}

export type ReleaseQuickAction = {
	id: string;
	label: string;
	href: string;
};

export function releaseQuickActions(entry: ReleaseNotesEntry): ReleaseQuickAction[] {
	const { fromVer, toVer } = entry;
	return [
		{ id: 'browse', label: 'Browse catalog', href: catalogBrowseHref(toVer) },
		{ id: 'compare', label: 'Compare releases', href: comparisonPageHref(fromVer, toVer) },
		{ id: 'validate', label: 'Validate YAML', href: validateYamlHref(toVer) },
		{ id: 'spec', label: 'Spec search', href: specSearchHref(toVer) },
		{ id: 'dep-map', label: 'Dependency map', href: dependencyMapHref(toVer) }
	];
}

export function toneDotClass(tone: 'low' | 'medium' | 'high'): string {
	if (tone === 'high') return 'bg-red-500';
	if (tone === 'medium') return 'bg-amber-500';
	return 'bg-emerald-500';
}

export function sortNewResources(items: NewResource[], sort: ListSortMode): NewResource[] {
	const sorted = [...items];
	switch (sort) {
		case 'kind-desc':
			return sorted.sort((a, b) => b.kind.localeCompare(a.kind));
		case 'change-type':
			return sorted.sort((a, b) => a.apiVersion.localeCompare(b.apiVersion));
		case 'severity':
		case 'kind-asc':
		default:
			return sorted.sort((a, b) => a.kind.localeCompare(b.kind));
	}
}

export function filterModifiedResources(
	resources: ModifiedResource[],
	query: string
): ModifiedResource[] {
	const q = query.trim().toLowerCase();
	if (!q) return resources;
	return resources
		.map((r) => ({
			...r,
			changes: r.changes.filter((c) => {
				const label = humanizeFieldPath(c.field);
				const behavior = displayNetworkBehavior(c, r.kind);
				return (
					r.kind.toLowerCase().includes(q) ||
					c.field.toLowerCase().includes(q) ||
					c.changeType.toLowerCase().includes(q) ||
					label.toLowerCase().includes(q) ||
					behavior.toLowerCase().includes(q) ||
					c.before.toLowerCase().includes(q) ||
					c.after.toLowerCase().includes(q)
				);
			})
		}))
		.filter((r) => r.changes.length > 0);
}

export function groupModifiedByKind(resources: ModifiedResource[]): ModifiedResource[] {
	return [...resources].sort((a, b) => a.kind.localeCompare(b.kind));
}

export function filterNewResources<
	T extends { kind: string; apiVersion: string; description?: string; group?: string; crdName?: string }
>(items: T[], query: string): T[] {
	const q = query.trim().toLowerCase();
	if (!q) return items;
	return items.filter(
		(r) =>
			r.kind.toLowerCase().includes(q) ||
			r.apiVersion.toLowerCase().includes(q) ||
			deriveGroupFromApiVersion(r.apiVersion).toLowerCase().includes(q) ||
			(r.group?.toLowerCase().includes(q) ?? false) ||
			(r.crdName?.toLowerCase().includes(q) ?? false) ||
			(r.description?.toLowerCase().includes(q) ?? false)
	);
}

export function filterDeprecatedItems(items: DeprecatedItem[], query: string): DeprecatedItem[] {
	const q = query.trim().toLowerCase();
	if (!q) return items;
	return items.filter(
		(d) =>
			d.kind.toLowerCase().includes(q) ||
			d.group.toLowerCase().includes(q) ||
			d.crdName.toLowerCase().includes(q) ||
			(d.recommendedApiVersion?.toLowerCase().includes(q) ?? false) ||
			d.deprecatedVersions.some((v) => v.version.toLowerCase().includes(q))
	);
}

export function changeRowKey(kind: string, field: string, index: number): string {
	return `${kind}::${field}::${index}`;
}

export function statSparkHeights(values: number[]): number[] {
	const max = Math.max(...values, 1);
	return values.map((v) => Math.max(8, Math.round((v / max) * 100)));
}
