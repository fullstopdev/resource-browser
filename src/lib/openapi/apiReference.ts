/**
 * Turns an EDA OpenAPI spec into what a network engineer looks for: resources (BridgeDomain,
 * BGPPeer, Ping…) and what can be done with each (List, Create, Get, Replace, Patch, Delete,
 * Revision history…), plus the platform API's sections. Pure: used by the API Explorer and by
 * scripts/build-openapi-index.ts.
 *
 * EDA application APIs follow a fixed shape:
 *   /apps/<group>/<version>[/namespaces/{namespace}]/<plural>[/_deleted][/{name}[/_revs|_targets|_topology]]
 *   /workflows/v1/<group>/<version>[/namespaces/{namespace}]/<plural>[/{name}[/_input|_logs|…]]
 */
import type { HttpMethod, OpenApiOperation } from './pathBrowser';

export type ApiSectionType = 'resource' | 'workflow' | 'platform' | 'discovery';
export type ApiActionGroup = 'Read' | 'Write' | 'Run' | 'Other';

export interface ApiAction {
	/** Stable key within the section, e.g. `create`, `get`, `revisions`. */
	key: string;
	label: string;
	group: ApiActionGroup;
	/** Sentence for the action panel heading, e.g. "Create a BridgeDomain". */
	title: string;
	operation: OpenApiOperation;
}

export interface ApiSection {
	/** URL key: the plural for resources and workflows, the tag for platform sections. */
	key: string;
	type: ApiSectionType;
	title: string;
	plural?: string;
	group?: string;
	version?: string;
	scope?: 'Namespaced' | 'Cluster';
	actions: ApiAction[];
}

/** Platform (core) tag → section title; unknown tags fall back to the tag name without "core". */
const PLATFORM_TITLES: Record<string, string> = {
	coreQuery: 'Query (EQL & NQL)',
	coreTransaction: 'Transactions',
	coreAlarms: 'Alarms',
	coreAdmin: 'Administration',
	coreAbout: 'Cluster status',
	coreAccess: 'Access',
	coreAutoComplete: 'Autocomplete',
	coreBranch: 'Branches',
	coreTopology: 'Topology',
	coreStore: 'App store',
	coreNodeconfig: 'Node configuration',
	coreI18n: 'Translations',
	coreDB: 'Database',
	coreFeatures: 'Features',
	coreWorkflows: 'Workflows',
	coreChat: 'Chat'
};

export function platformSectionTitle(tag: string): string {
	if (PLATFORM_TITLES[tag]) return PLATFORM_TITLES[tag];
	const rest = tag.startsWith('core') && tag.length > 4 ? tag.slice(4) : tag;
	return rest.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Parsed EDA app/workflow path, or null for anything else (core paths, API discovery). */
export interface EdaPathShape {
	prefix: 'apps' | 'workflows';
	group: string;
	version: string;
	namespaced: boolean;
	plural: string;
	deletedList: boolean;
	named: boolean;
	sub?: string;
	subNamed: boolean;
}

export function parseEdaPath(path: string): EdaPathShape | null {
	const m =
		/^\/(apps|workflows\/v1)\/([^/]+)\/([^/]+)(\/namespaces\/\{namespace\})?\/([a-z0-9-]+)(\/_deleted)?(\/\{name\})?(?:\/(_[a-z]+)(\/\{[^}]+\})?)?$/.exec(
			path
		);
	if (!m || m[5] === 'namespaces' || m[5].startsWith('_')) return null;
	return {
		prefix: m[1] === 'apps' ? 'apps' : 'workflows',
		group: m[2]!,
		version: m[3]!,
		namespaced: Boolean(m[4]),
		plural: m[5]!,
		deletedList: Boolean(m[6]),
		named: Boolean(m[7]),
		sub: m[8],
		subNamed: Boolean(m[9])
	};
}

type ActionDef = { key: string; label: string; group: ApiActionGroup; verb: string };

/** What an EDA endpoint does, in plain words. `clusterOnly`: the resource has no namespaced paths. */
function resourceAction(
	method: HttpMethod,
	shape: EdaPathShape,
	clusterOnly: boolean
): ActionDef | null {
	const { namespaced, named, sub, deletedList } = shape;
	if (shape.prefix === 'workflows') {
		if (!named && !sub) {
			if (method === 'post') return { key: 'run', label: 'Run', group: 'Run', verb: 'Run a' };
			if (method === 'get')
				return namespaced
					? { key: 'list', label: 'List runs in namespace', group: 'Read', verb: 'List' }
					: { key: 'listAll', label: 'List runs in all namespaces', group: 'Read', verb: 'List' };
			return null;
		}
		if (named && !sub) {
			if (method === 'get') return { key: 'get', label: 'Get run', group: 'Read', verb: 'Get a' };
			if (method === 'delete')
				return { key: 'delete', label: 'Delete run', group: 'Write', verb: 'Delete a' };
		}
		if (sub === '_logs')
			return { key: 'logs', label: 'Logs', group: 'Read', verb: 'Read the logs of a' };
		if (sub === '_artifacts')
			return shape.subNamed
				? { key: 'artifact', label: 'Get artifact', group: 'Read', verb: 'Get an artifact of a' }
				: { key: 'artifacts', label: 'Artifacts', group: 'Read', verb: 'List the artifacts of a' };
		if (sub === '_input')
			return method === 'put'
				? { key: 'submitInput', label: 'Submit input', group: 'Run', verb: 'Submit input to a' }
				: {
						key: 'input',
						label: 'Pending input',
						group: 'Read',
						verb: 'Read the input requested by a'
					};
		if (sub === '_terminate')
			return { key: 'terminate', label: 'Terminate', group: 'Run', verb: 'Terminate a' };
		return null;
	}

	if (!named && !sub && !deletedList) {
		const scoped = namespaced ? ' in namespace' : clusterOnly ? '' : ' in all namespaces';
		if (method === 'get')
			return {
				key: namespaced || clusterOnly ? 'list' : 'listAll',
				label: `List${scoped}`,
				group: 'Read',
				verb: 'List'
			};
		if (method === 'post')
			return { key: 'create', label: 'Create', group: 'Write', verb: 'Create a' };
		if (method === 'delete')
			return { key: 'deleteAll', label: `Delete all${scoped}`, group: 'Write', verb: 'Delete all' };
		return null;
	}
	if (deletedList && method === 'get')
		return { key: 'deleted', label: 'Deleted instances', group: 'Read', verb: 'List deleted' };
	if (named && !sub) {
		if (method === 'get') return { key: 'get', label: 'Get', group: 'Read', verb: 'Get a' };
		if (method === 'put')
			return { key: 'replace', label: 'Replace', group: 'Write', verb: 'Replace a' };
		if (method === 'patch')
			return { key: 'patch', label: 'Patch', group: 'Write', verb: 'Patch a' };
		if (method === 'delete')
			return { key: 'delete', label: 'Delete', group: 'Write', verb: 'Delete a' };
	}
	if (sub === '_revs')
		return {
			key: 'revisions',
			label: 'Revision history',
			group: 'Read',
			verb: 'Get the revision history of a'
		};
	if (sub === '_targets')
		return {
			key: 'targets',
			label: 'Intent targets',
			group: 'Read',
			verb: 'Get the intent targets of a'
		};
	if (sub === '_topology')
		return { key: 'topology', label: 'Topology', group: 'Other', verb: 'Get the topology of a' };
	return null;
}

const ACTION_ORDER = [
	'list',
	'listAll',
	'get',
	'revisions',
	'targets',
	'deleted',
	'logs',
	'artifacts',
	'artifact',
	'input',
	'create',
	'replace',
	'patch',
	'delete',
	'deleteAll',
	'run',
	'submitInput',
	'terminate',
	'topology'
];
const GROUP_ORDER: ApiActionGroup[] = ['Read', 'Write', 'Run', 'Other'];

function sortActions(actions: ApiAction[]): ApiAction[] {
	return actions.sort(
		(a, b) =>
			GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
			ACTION_ORDER.indexOf(a.key) - ACTION_ORDER.indexOf(b.key) ||
			a.label.localeCompare(b.label)
	);
}

/** `BridgeDomain` from summaries like "…instances of BridgeDomain…" / "Read the specified Ping." */
function kindFromSummaries(ops: OpenApiOperation[]): string | undefined {
	for (const op of ops) {
		const text = `${op.summary} ${op.description}`;
		const m =
			/instances of ([A-Z][A-Za-z0-9]*)/.exec(text) ??
			/specified (?:namespaced |non-namespaced )?([A-Z][A-Za-z0-9]*)/.exec(text) ??
			/(?:Delete|Terminate) an? ([A-Z][A-Za-z0-9]*) workflow/.exec(text);
		if (m) return m[1];
	}
	return undefined;
}

function humanize(text: string): string {
	const spaced = text
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[_-]+/g, ' ')
		.trim();
	return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Short label for a platform operation: its summary up to the first period, else the operationId. */
function platformLabel(op: OpenApiOperation): string {
	const summary = op.summary.trim().replace(/\.$/, '');
	if (summary) {
		const first = summary.split(/\.\s/)[0]!;
		return first.length > 70 ? `${first.slice(0, 67)}…` : first;
	}
	return op.operationId ? humanize(op.operationId) : `${op.method.toUpperCase()} ${op.path}`;
}

/** Same label twice in a section (two "Query request…" endpoints): add the path's last segment. */
function disambiguate(actions: ApiAction[]): ApiAction[] {
	const counts = new Map<string, number>();
	for (const a of actions) counts.set(a.label, (counts.get(a.label) ?? 0) + 1);
	return actions.map((a) => {
		if ((counts.get(a.label) ?? 0) < 2) return a;
		const tail =
			a.operation.path
				.split('/')
				.filter((p) => p && !p.startsWith('{'))
				.pop() ?? '';
		const label = `${a.label} (${a.operation.method.toUpperCase()} ${tail})`;
		return { ...a, label, title: label };
	});
}

export interface BuildApiSectionsOptions {
	/** Kind for `<plural>.<group>` (from the CRD manifest); falls back to the summaries. */
	kindFor?: (plural: string, group: string) => string | undefined;
}

/** Sections (resources, workflows, platform sections, API discovery) for one spec's operations. */
export function buildApiSections(
	operations: OpenApiOperation[],
	options: BuildApiSectionsOptions = {}
): ApiSection[] {
	const byResource = new Map<
		string,
		{ shape: EdaPathShape; ops: Array<[OpenApiOperation, EdaPathShape]> }
	>();
	const platform = new Map<string, OpenApiOperation[]>();
	const discovery: OpenApiOperation[] = [];

	for (const op of operations) {
		const shape = parseEdaPath(op.path);
		if (shape) {
			const key = `${shape.prefix}:${shape.plural}`;
			const entry = byResource.get(key) ?? { shape, ops: [] };
			entry.ops.push([op, shape]);
			byResource.set(key, entry);
		} else if (op.path.startsWith('/apps/') || op.path.startsWith('/workflows/')) {
			discovery.push(op);
		} else {
			const tag = op.tags[0] ?? 'other';
			platform.set(tag, [...(platform.get(tag) ?? []), op]);
		}
	}

	const sections: ApiSection[] = [];

	for (const { shape, ops } of byResource.values()) {
		const kind =
			options.kindFor?.(shape.plural, shape.group) ??
			kindFromSummaries(ops.map(([op]) => op)) ??
			humanize(shape.plural);
		const clusterOnly = !ops.some(([, s]) => s.namespaced);
		const actions: ApiAction[] = [];
		const seen = new Set<string>();
		for (const [op, s] of ops) {
			const def = resourceAction(op.method, s, clusterOnly);
			const key = def ? def.key : `${op.method}:${op.path}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const label = def?.label ?? platformLabel(op);
			actions.push({
				key,
				label,
				group: def?.group ?? 'Other',
				title: def
					? `${def.verb} ${kind}${/^List|^Delete all/.test(def.verb) ? ' resources' : ''}`.replace(
							/ a ([AEIOU])/,
							' an $1'
						)
					: label,
				operation: op
			});
		}
		sections.push({
			key: shape.plural,
			type: shape.prefix === 'workflows' ? 'workflow' : 'resource',
			title: kind,
			plural: shape.plural,
			group: shape.group,
			version: shape.version,
			scope: clusterOnly ? 'Cluster' : 'Namespaced',
			actions: sortActions(actions)
		});
	}
	sections.sort((a, b) =>
		a.type === b.type ? a.title.localeCompare(b.title) : a.type === 'resource' ? -1 : 1
	);

	const platformSections = [...platform.entries()]
		.map(([tag, ops]): ApiSection => ({
			key: tag,
			type: 'platform',
			title: platformSectionTitle(tag),
			actions: disambiguate(
				ops.map((op) => {
					const label = platformLabel(op);
					return {
						key: op.operationId || `${op.method}:${op.path}`,
						label,
						group: op.method === 'get' ? 'Read' : 'Write',
						title: label,
						operation: op
					};
				})
			)
		}))
		.sort((a, b) =>
			a.key === 'coreQuery' ? -1 : b.key === 'coreQuery' ? 1 : a.title.localeCompare(b.title)
		);

	const result = [...platformSections, ...sections];
	if (discovery.length > 0) {
		result.push({
			key: '_discovery',
			type: 'discovery',
			title: 'API discovery',
			actions: discovery.map((op) => ({
				key: op.operationId || `${op.method}:${op.path}`,
				label: op.path.includes('/_ui/')
					? 'UI extension'
					: op.path.split('/').length <= 3
						? 'API versions'
						: 'Resources in this API',
				group: 'Read',
				title: op.summary || 'API discovery',
				operation: op
			}))
		});
	}
	return result;
}

/** The section and action holding an operation (deep links by `#operationId`). */
export function findAction(
	sections: ApiSection[],
	operationIdOrKey: string
): { section: ApiSection; action: ApiAction } | null {
	for (const section of sections) {
		for (const action of section.actions) {
			if (
				action.operation.operationId === operationIdOrKey ||
				action.operation.id === operationIdOrKey
			) {
				return { section, action };
			}
		}
	}
	return null;
}

/** Example values an engineer can paste: namespace `eda`, a name derived from the kind. */
export function exampleName(kind: string): string {
	return `my-${kind.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`;
}

/**
 * A curl for an action: token header unless public, path parameters filled with examples,
 * required query parameters as shell variables, and a JSON body file for writes.
 */
export function curlForAction(action: ApiAction, section: ApiSection): string {
	const op = action.operation;
	const name = exampleName(section.type === 'platform' ? 'resource' : section.title);
	const path = op.path.replace(/\{([^}]+)\}/g, (_, param: string) =>
		param === 'namespace'
			? 'eda'
			: param === 'name'
				? name
				: `$${param.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
	);
	const query = op.parameters
		.filter((p) => p.in === 'query' && p.required)
		.map((p) => `${p.name}=$${p.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`)
		.join('&');
	const lines = [`curl -X ${op.method.toUpperCase()}`];
	if (!op.security.isPublic) lines.push(`  -H "Authorization: Bearer $TOKEN"`);
	if (op.requestBody) {
		const file = section.type === 'platform' ? 'body.json' : `${name}.json`;
		lines.push(`  -H "Content-Type: application/json" -d @${file}`);
	}
	lines.push(`  "https://$EDA_HOST${path}${query ? `?${query}` : ''}"`);
	return lines.join(' \\\n');
}

/** `Services` from "Services Application APIs."; the platform API keeps a fixed name. */
export function apiShortTitle(title: string, id: string): string {
	if (id === 'core') return 'Platform API';
	return (
		title
			.replace(/\s*Application APIs\.?$/i, '')
			.replace(/\.$/, '')
			.trim() || id
	);
}

/** static/openapi/<release>/api-index.json (scripts/build-openapi-index.ts). */
export interface ApiIndex {
	release: string;
	apis: Array<{
		id: string;
		title: string;
		group: string;
		version: string;
		platform: boolean;
		operationCount: number;
		sections: Array<{
			key: string;
			type: ApiSectionType;
			title: string;
			scope?: 'Namespaced' | 'Cluster';
			actions: number;
		}>;
	}>;
}
