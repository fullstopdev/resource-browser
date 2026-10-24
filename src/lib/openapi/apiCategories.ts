/**
 * Categories for the EDA application APIs and CRD API groups, so the API reference and the CRD
 * catalog can be browsed by area (fabric, routing, telemetry, …) instead of one long list.
 * Keyed by the first label of the API group: `protocols.eda.nokia.com` → `protocols`.
 */
export type ApiCategoryId =
	| 'platform'
	| 'fabric'
	| 'routing'
	| 'services'
	| 'telemetry'
	| 'alerts'
	| 'integrations'
	| 'access'
	| 'system'
	| 'other';

export type ApiCategory = {
	id: ApiCategoryId;
	title: string;
	blurb: string;
	/** 24×24 stroke icon path. */
	icon: string;
};

export const API_CATEGORIES: ApiCategory[] = [
	{
		id: 'platform',
		title: 'Core platform',
		blurb: 'The EDA API server (/core: queries, transactions, alarms, users) and core resources.',
		icon: 'M4 5h16v5H4zM4 14h16v5H4zM8 7.5h.01M8 16.5h.01'
	},
	{
		id: 'fabric',
		title: 'Fabric and topology',
		blurb: 'Fabrics, nodes, links, interfaces, OS images.',
		icon: 'M5 4h4v4H5zM15 4h4v4h-4zM10 16h4v4h-4zM7 8v3h10V8M12 11v5'
	},
	{
		id: 'routing',
		title: 'Routing and protocols',
		blurb: 'BGP, OSPF, IS-IS, MPLS, policies, QoS, OAM.',
		icon: 'M4 18h5l6-12h5M17 3l3 3-3 3M4 6h5'
	},
	{
		id: 'services',
		title: 'Services',
		blurb: 'Bridge domains, VLANs, routers, IRBs, segmentation.',
		icon: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5'
	},
	{
		id: 'telemetry',
		title: 'Telemetry and export',
		blurb: 'Exporters, importers, logging, flow sampling, SNMP.',
		icon: 'M3 12h4l3-7 4 14 3-7h4'
	},
	{
		id: 'alerts',
		title: 'Alerts and notifications',
		blurb: 'Notifiers, pagers, Discord, ServiceNow.',
		icon: 'M6 16v-5a6 6 0 1112 0v5l2 2H4l2-2zM10 20a2 2 0 004 0'
	},
	{
		id: 'integrations',
		title: 'Integrations',
		blurb: 'Cloud Connect, VMware, Nutanix, NSX, Git, NetBox, AI.',
		icon: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 10-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 105.7 5.7l1-1'
	},
	{
		id: 'access',
		title: 'Access and security',
		blurb: 'AAA, keychains, certificates, management servers.',
		icon: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9 12l2 2 4-4'
	},
	{
		id: 'system',
		title: 'System and apps',
		blurb: 'Configuration, app store, bootstrap, environment, support.',
		icon: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4'
	},
	{
		id: 'other',
		title: 'Other',
		blurb: 'APIs not in a category yet.',
		icon: 'M12 5v.01M12 12v.01M12 19v.01'
	}
];

const BY_PREFIX: Record<string, ApiCategoryId> = {
	fabrics: 'fabric',
	topologies: 'fabric',
	interfaces: 'fabric',
	os: 'fabric',
	components: 'fabric',
	siteinfo: 'fabric',
	cx: 'fabric',
	timing: 'fabric',

	routing: 'routing',
	routingpolicies: 'routing',
	protocols: 'routing',
	mpls: 'routing',
	qos: 'routing',
	oam: 'routing',
	filters: 'routing',

	services: 'services',
	microsegmentation: 'services',

	influxdb: 'telemetry',
	kafka: 'telemetry',
	kafkaimporter: 'telemetry',
	nats: 'telemetry',
	natsimporter: 'telemetry',
	otlp: 'telemetry',
	prom: 'telemetry',
	remotewrite: 'telemetry',
	stdout: 'telemetry',
	logging: 'telemetry',
	flowsampling: 'telemetry',
	snmp: 'telemetry',
	platformmetrics: 'telemetry',

	notifiers: 'alerts',
	pagers: 'alerts',
	discord: 'alerts',
	snow: 'alerts',

	connect: 'integrations',
	nutanix: 'integrations',
	nsx: 'integrations',
	vmware: 'integrations',
	'openstack-client-provider': 'integrations',
	'k8s-client-provider': 'integrations',
	netbox: 'integrations',
	tpi: 'integrations',
	github: 'integrations',
	gitlab: 'integrations',
	ai: 'integrations',
	aifabrics: 'integrations',

	aaa: 'access',
	security: 'access',
	certcheck: 'access',
	certchecker: 'access',
	management: 'access',

	core: 'platform',
	coreext: 'platform',
	config: 'system',
	appstore: 'system',
	support: 'system',
	environment: 'system',
	bootstrap: 'system',
	artifacts: 'system',
	test: 'system',
	system: 'system'
};

export function apiCategory(api: { group: string; platform?: boolean }): ApiCategoryId {
	// The API server spec (`/core`) has no group.
	if (api.platform) return 'platform';
	return BY_PREFIX[api.group.split('.')[0] ?? ''] ?? 'other';
}

export function isApiCategory(id: string): id is ApiCategoryId {
	return API_CATEGORIES.some((c) => c.id === id);
}

/** APIs grouped by category, in category order, skipping empty categories. */
export function groupApisByCategory<A extends { group: string; platform?: boolean }>(
	apis: A[]
): Array<{ category: ApiCategory; apis: A[] }> {
	return API_CATEGORIES.map((category) => ({
		category,
		apis: apis.filter((a) => apiCategory(a) === category.id)
	})).filter((g) => g.apis.length > 0);
}

type IndexApi = {
	id: string;
	title: string;
	group: string;
	version: string;
	platform: boolean;
	sections: Array<{ key: string; type: string; title: string; scope?: string; actions: number }>;
};

/**
 * The collection path for a resource or workflow, as the spec has it:
 * `/apps/protocols.eda.nokia.com/v2/namespaces/{namespace}/bgppeers`.
 */
export function resourcePath(api: IndexApi, section: IndexApi['sections'][number]): string {
	if (api.platform) return '/core/…';
	const base =
		section.type === 'workflow'
			? `/workflows/v1/${api.group}/${api.version}`
			: `/apps/${api.group}/${api.version}`;
	return `${base}${section.scope === 'Namespaced' ? '/namespaces/{namespace}' : ''}/${section.key}`;
}

export type ApiSearchHit = {
	apiId: string;
	apiTitle: string;
	category: ApiCategoryId;
	key: string;
	title: string;
	type: string;
	scope?: string;
};

/**
 * Resources and workflows matching `query`: exact kind first, then prefix, then substring, then
 * everything in an API whose name or group matches.
 */
export function searchApiIndex(apis: IndexApi[], query: string, limit = 12): ApiSearchHit[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	const out: Array<ApiSearchHit & { rank: number }> = [];
	for (const api of apis) {
		const apiMatch = `${api.title} ${api.group}`.toLowerCase().includes(q);
		for (const s of api.sections) {
			const t = s.title.toLowerCase();
			const rank = t === q ? 0 : t.startsWith(q) ? 1 : t.includes(q) ? 2 : apiMatch ? 3 : -1;
			if (rank < 0) continue;
			out.push({
				apiId: api.id,
				apiTitle: api.title,
				category: apiCategory(api),
				key: s.key,
				title: s.title,
				type: s.type,
				scope: s.scope,
				rank
			});
		}
	}
	return out
		.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title))
		.slice(0, limit)
		.map(({ rank: _rank, ...hit }) => hit);
}

/** Resources that people look up most, for the "Popular" shortcuts. */
export const POPULAR_RESOURCES = [
	'BGPPeer',
	'DefaultInterface',
	'Interface',
	'BridgeDomain',
	'VLAN',
	'Fabric',
	'TopoNode',
	'RoutedInterface',
	'Router',
	'IRBInterface'
];
