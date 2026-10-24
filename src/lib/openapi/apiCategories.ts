/**
 * Categories for the EDA application APIs, so the API reference can be browsed by area
 * (fabric, routing, telemetry, …) instead of one alphabetical list of 55 APIs.
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

export type ApiCategory = { id: ApiCategoryId; title: string; blurb: string };

export const API_CATEGORIES: ApiCategory[] = [
	{ id: 'platform', title: 'Platform', blurb: 'The /core API: queries, transactions, alarms, users.' },
	{ id: 'fabric', title: 'Fabric and topology', blurb: 'Fabrics, nodes, links, interfaces.' },
	{ id: 'routing', title: 'Routing and protocols', blurb: 'BGP, OSPF, IS-IS, MPLS, policies, QoS.' },
	{ id: 'services', title: 'Services', blurb: 'Bridge domains, VLANs, routers, segmentation.' },
	{ id: 'telemetry', title: 'Telemetry and export', blurb: 'Exporters, importers, logging, SNMP.' },
	{ id: 'alerts', title: 'Alerts and notifications', blurb: 'Notifiers, pagers, incident tools.' },
	{ id: 'integrations', title: 'Integrations', blurb: 'Clouds, hypervisors, Git, NetBox, AI.' },
	{ id: 'access', title: 'Access and security', blurb: 'AAA, keychains, certificates, management.' },
	{ id: 'system', title: 'System and apps', blurb: 'Core resources, app store, bootstrap.' },
	{ id: 'other', title: 'Other', blurb: 'APIs not in a category yet.' }
];

const BY_PREFIX: Record<string, ApiCategoryId> = {
	fabrics: 'fabric',
	topologies: 'fabric',
	interfaces: 'fabric',
	os: 'fabric',
	components: 'fabric',
	siteinfo: 'fabric',
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
	github: 'integrations',
	gitlab: 'integrations',
	ai: 'integrations',
	aifabrics: 'integrations',

	aaa: 'access',
	security: 'access',
	certcheck: 'access',
	certchecker: 'access',
	management: 'access',

	core: 'system',
	coreext: 'system',
	config: 'system',
	appstore: 'system',
	support: 'system',
	environment: 'system',
	bootstrap: 'system',
	system: 'system'
};

export function apiCategory(api: { group: string; platform?: boolean }): ApiCategoryId {
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
