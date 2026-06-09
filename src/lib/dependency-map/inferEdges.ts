import type { CrdResource } from '$lib/structure';
import type { ConfidenceTier, EdgeRecord, EdgeSource, GraphLink, GraphNode, InferencePass, LinkRelation, NodeType } from './types';

type CatalogEntry = {
	id: string;
	kind: string;
	group: string;
	type: NodeType;
	description?: string;
};

type PendingEdge = EdgeRecord & { field?: string };

export type { EdgeRecord, InferencePass };

const STOP_KINDS = new Set([
	'API',
	'Node',
	'Object',
	'REST',
	'Schema',
	'Server',
	'String',
	'Type',
	'Value',
	'CamelCase',
	'Default',
	'Router',
	'Interface',
	'Resource'
]);

const REL_PRIORITY: Record<LinkRelation, number> = {
	observes: 100,
	deploys: 100,
	orchestrates: 90,
	extends: 85,
	bindsTo: 80,
	appliesTo: 78,
	member: 70,
	memberOf: 70,
	references: 60
};

const SOURCE_PRIORITY: Record<EdgeSource, number> = {
	catalog: 4,
	explicit: 3,
	semantic: 2,
	inferred: 1
};

const PASS_PRIORITY: Record<InferencePass, number> = {
	1: 4,
	2: 3,
	3: 2,
	4: 1
};

const MIN_CONFIDENCE = 55;

const REFERENCE_FIELD_PATTERN = /(?:Ref|Refs|Reference|resourceRef)$/i;

/** Pass 2: explicit "Reference to Kind" in field descriptions. */
const EXPLICIT_REF_DESCRIPTION = /Reference to (?:a|an|the)\s+([A-Z][A-Za-z0-9]+)/;

/** Pass 4: conservative kind mention in spec field descriptions. */
const DESCRIPTION_KIND_PATTERNS: Array<{
	regex: RegExp;
	rel: LinkRelation | ((kind: string, description: string) => LinkRelation);
	confidence: number;
	reason: (kind: string) => string;
}> = [
	{
		regex: /Reference to (?:a|an|the)\s+([A-Z][A-Za-z0-9]+)/g,
		rel: (kind, desc) =>
			kind === 'Policy' && /route|policy|evaluat/i.test(desc) ? 'appliesTo' : 'references',
		confidence: 72,
		reason: (kind) => `Description references ${kind}`
	},
	{
		regex: /creating an?\s+([A-Z][A-Za-z0-9]+)\s+resource/gi,
		rel: 'orchestrates',
		confidence: 70,
		reason: (kind) => `Description orchestrates creation of ${kind}`
	}
];

/** Pass 3: whitelisted EDA semantic patterns — never generic *Selector → kind. */
const SEMANTIC_FIELD_PATTERNS: Array<{
	propPattern: RegExp;
	pathPattern?: RegExp;
	kind: string;
	relation: LinkRelation;
	confidence: number;
	reason: string;
	requireTopoNodeInDescription?: boolean;
}> = [
	{
		propPattern: /^interSwitchLinks$/i,
		kind: 'ISL',
		relation: 'orchestrates',
		confidence: 92,
		reason: 'interSwitchLinks orchestrates ISL resources'
	},
	{
		propPattern: /^linkSelectors$/i,
		pathPattern: /interSwitchLinks/i,
		kind: 'ISL',
		relation: 'orchestrates',
		confidence: 88,
		reason: 'linkSelectors under interSwitchLinks orchestrate ISL (not TopoLink)'
	},
	{
		propPattern: /^fabricSelectors$/i,
		kind: 'Fabric',
		relation: 'references',
		confidence: 90,
		reason: 'fabricSelectors reference peer Fabric instances'
	},
	{
		propPattern: /^nodeProfile$/i,
		kind: 'NodeProfile',
		relation: 'references',
		confidence: 95,
		reason: 'nodeProfile references NodeProfile'
	},
	{
		propPattern: /^asnPool$/i,
		kind: 'IndexAllocationPool',
		relation: 'references',
		confidence: 90,
		reason: 'asnPool references IndexAllocationPool'
	},
	{
		propPattern: /^(poolIPv4|poolIPv6|systemPoolIPv4|systemPoolIPv6)$/i,
		kind: 'IPAllocationPool',
		relation: 'references',
		confidence: 90,
		reason: 'IP pool field references IPAllocationPool'
	},
	{
		propPattern: /^keychain$/i,
		kind: 'Keychain',
		relation: 'references',
		confidence: 88,
		reason: 'keychain references Keychain resource'
	},
	{
		propPattern: /^(exportPolicy|importPolicy|exportPolicies|importPolicies)$/i,
		kind: 'Policy',
		relation: 'appliesTo',
		confidence: 88,
		reason: 'routing policy field applies Policy'
	},
	{
		propPattern: /NodeSelectors?$/i,
		kind: 'TopoNode',
		relation: 'bindsTo',
		confidence: 85,
		reason: 'node selector binds to TopoNode',
		requireTopoNodeInDescription: true
	}
];

const TOPO_NODE_IN_DESCRIPTION = /toponode/i;
const ISL_FROM_LINK_SELECTORS = /creating an?\s+ISL\b/i;

function shortResourceName(name: string): string {
	return name.split('.')[0] ?? name;
}

export function classifyNodeType(name: string, kind: string): NodeType {
	const lower = name.toLowerCase();
	const short = shortResourceName(lower);
	if (kind.endsWith('State') || short.endsWith('states') || lower.includes('.states.')) {
		return 'state';
	}
	if (kind.endsWith('Deployment') || short.endsWith('deployments')) {
		return 'config';
	}
	return 'config';
}

function normalizeKindKey(kind: string): string {
	return kind.replace(/\s+/g, '').toLowerCase();
}

function kindLookupKeys(kind: string): string[] {
	const key = normalizeKindKey(kind);
	const keys = new Set<string>([key]);
	if (key.endsWith('ies') && key.length > 4) {
		keys.add(`${key.slice(0, -3)}y`);
	}
	if (key.endsWith('s') && key.length > 2) {
		keys.add(key.slice(0, -1));
	}
	if (!key.endsWith('s')) {
		keys.add(`${key}s`);
	}
	return [...keys];
}

function buildKindIndex(catalog: Map<string, CatalogEntry>): Map<string, string[]> {
	const index = new Map<string, string[]>();
	for (const entry of catalog.values()) {
		const kind = entry.kind || shortResourceName(entry.id);
		for (const key of kindLookupKeys(kind)) {
			const list = index.get(key) ?? [];
			if (!list.includes(entry.id)) list.push(entry.id);
			index.set(key, list);
		}
	}
	return index;
}

function resolveKindTarget(
	kind: string,
	sourceGroup: string,
	kindIndex: Map<string, string[]>,
	catalog: Map<string, CatalogEntry>
): string | null {
	if (STOP_KINDS.has(kind)) return null;

	const candidates = new Set<string>();
	for (const key of kindLookupKeys(kind)) {
		for (const id of kindIndex.get(key) ?? []) {
			candidates.add(id);
		}
	}
	if (candidates.size === 0) return null;

	const list = [...candidates];
	if (list.length === 1) return list[0];

	const sameGroup = list.filter((id) => catalog.get(id)?.group === sourceGroup);
	if (sameGroup.length === 1) return sameGroup[0];

	const sourceShort = normalizeKindKey(kind);
	const exactKind = list.filter((id) => {
		const entry = catalog.get(id);
		if (!entry) return false;
		const entryKind = entry.kind || shortResourceName(entry.id);
		return kindLookupKeys(entryKind).includes(sourceShort);
	});
	if (exactKind.length === 1) return exactKind[0];

	return list[0] ?? null;
}

function resolveNameSibling(
	sourceName: string,
	fromSuffix: string,
	toSuffix: string,
	catalog: Map<string, CatalogEntry>
): string | null {
	const short = shortResourceName(sourceName);
	if (!short.endsWith(fromSuffix)) return null;
	const rest = sourceName.slice(short.length);
	const targetShort = short.slice(0, -fromSuffix.length) + toSuffix;
	const targetName = targetShort + rest;
	return catalog.has(targetName) ? targetName : null;
}

function stemToKind(propName: string): string | null {
	const stem = propName.replace(REFERENCE_FIELD_PATTERN, '');
	if (!stem || stem === propName) return null;
	return stem.charAt(0).toUpperCase() + stem.slice(1);
}

function resolveRel(
	rel: LinkRelation | ((kind: string, description: string) => LinkRelation),
	kind: string,
	description: string
): LinkRelation {
	return typeof rel === 'function' ? rel(kind, description) : rel;
}

function isPeerFabricSelfEdge(sourceId: string, targetId: string, fieldPath: string, reason: string): boolean {
	return (
		targetId === sourceId &&
		(fieldPath.includes('fabricSelectors') || /peer Fabric|connecting multiple Fabrics/i.test(reason))
	);
}

function shouldSkipPass4(propName: string, fieldPath: string, description: string): boolean {
	if (/^linkSelectors$/i.test(propName) && /interSwitchLinks/i.test(fieldPath)) {
		return true;
	}
	if (/Selectors?$/i.test(propName) && ISL_FROM_LINK_SELECTORS.test(description)) {
		return true;
	}
	return false;
}

function edgeFromRecord(record: EdgeRecord): PendingEdge {
	return { ...record, field: record.fieldPath };
}

function addEdge(edges: EdgeRecord[], edge: EdgeRecord, allowSelf = false): void {
	if (edge.source === edge.target && !allowSelf) return;
	if (edge.confidence < MIN_CONFIDENCE) return;
	edges.push(edge);
}

/** Pass 1: catalog config/state and deployment pairings. */
export function inferCatalogEdges(
	catalog: Map<string, CatalogEntry>,
	kindIndex: Map<string, string[]>
): EdgeRecord[] {
	const edges: EdgeRecord[] = [];

	for (const entry of catalog.values()) {
		if (entry.type === 'state') {
			let configId: string | null = null;
			if (entry.kind.endsWith('State')) {
				const configKind = entry.kind.slice(0, -5);
				configId = resolveKindTarget(configKind, entry.group, kindIndex, catalog);
			}
			if (!configId) {
				configId =
					resolveNameSibling(entry.id, 'states', 's', catalog) ??
					resolveNameSibling(entry.id, 'states', '', catalog);
			}
			if (configId) {
				addEdge(edges, {
					source: configId,
					target: entry.id,
					relation: 'observes',
					fieldPath: '',
					reason: 'Config/state catalog pairing',
					confidence: 100,
					pass: 1,
					edgeSource: 'catalog',
					confidenceTier: 1
				});
			}
		}

		if (entry.kind.endsWith('Deployment') || shortResourceName(entry.id).endsWith('deployments')) {
			let targetId: string | null = null;
			if (entry.kind.endsWith('Deployment')) {
				const targetKind = entry.kind.slice(0, -10);
				targetId = resolveKindTarget(targetKind, entry.group, kindIndex, catalog);
			}
			if (!targetId) {
				targetId =
					resolveNameSibling(entry.id, 'deployments', 's', catalog) ??
					resolveNameSibling(entry.id, 'deployments', '', catalog);
			}
			if (targetId) {
				addEdge(edges, {
					source: entry.id,
					target: targetId,
					relation: 'deploys',
					fieldPath: '',
					reason: 'Deployment catalog pairing',
					confidence: 100,
					pass: 1,
					edgeSource: 'catalog',
					confidenceTier: 1
				});
			}
		}
	}

	return edges;
}

function resolveTargetAndRecord(
	edges: EdgeRecord[],
	sourceId: string,
	sourceGroup: string,
	kind: string,
	partial: Omit<EdgeRecord, 'source' | 'target'>,
	kindIndex: Map<string, string[]>,
	catalog: Map<string, CatalogEntry>
): void {
	const targetId = resolveKindTarget(kind, sourceGroup, kindIndex, catalog);
	if (!targetId) return;
	const isPeerFabric = isPeerFabricSelfEdge(sourceId, targetId, partial.fieldPath, partial.reason);
	if (targetId === sourceId && !isPeerFabric) return;
	addEdge(
		edges,
		{
			source: sourceId,
			target: targetId,
			...partial
		},
		isPeerFabric
	);
}

function extractPass2RefEdge(
	propName: string,
	description: string | undefined,
	fieldPath: string,
	node: Record<string, unknown> | undefined
): Omit<EdgeRecord, 'source' | 'target'> | null {
	if (!REFERENCE_FIELD_PATTERN.test(propName)) return null;

	let kind: string | null = null;
	let reason = '';

	if (description) {
		const match = description.match(EXPLICIT_REF_DESCRIPTION);
		if (match?.[1] && !STOP_KINDS.has(match[1])) {
			kind = match[1];
			reason = `Explicit ref: ${description.trim().slice(0, 80)}`;
		}
	}

	if (!kind) {
		const stemKind = stemToKind(propName);
		if (stemKind && !STOP_KINDS.has(stemKind)) {
			kind = stemKind;
			reason = `Ref field stem ${propName} → ${stemKind}`;
		}
	}

	const editable = node?.['x-editable'];
	if (!kind && typeof editable === 'object' && editable !== null) {
		const editableKind = (editable as Record<string, unknown>).kind;
		if (typeof editableKind === 'string') {
			kind = editableKind;
			reason = `x-editable kind ${editableKind}`;
		}
	}

	if (!kind) return null;

	const rel: LinkRelation =
		kind === 'Policy' && description && /route|policy|evaluat/i.test(description)
			? 'appliesTo'
			: 'references';

	return {
		relation: rel,
		fieldPath,
		confidence: description ? 94 : 88,
		reason: `${reason} (${fieldPath})`,
		pass: 2,
		edgeSource: 'explicit',
		confidenceTier: 1
	};
}

function extractPass3SemanticEdge(
	propName: string,
	description: string | undefined,
	fieldPath: string
): (Omit<EdgeRecord, 'source' | 'target'> & { kind: string }) | null {
	for (const pattern of SEMANTIC_FIELD_PATTERNS) {
		if (!pattern.propPattern.test(propName)) continue;
		if (pattern.pathPattern && !pattern.pathPattern.test(fieldPath)) continue;
		if (pattern.requireTopoNodeInDescription) {
			if (!description || !TOPO_NODE_IN_DESCRIPTION.test(description)) continue;
		}
		return {
			kind: pattern.kind,
			relation: pattern.relation,
			fieldPath,
			confidence: pattern.confidence,
			reason: `${pattern.reason} (${fieldPath})`,
			pass: 3,
			edgeSource: 'semantic',
			confidenceTier: 2
		};
	}
	return null;
}

function extractPass4DescriptionEdges(
	propName: string,
	description: string | undefined,
	fieldPath: string
): Array<Omit<EdgeRecord, 'source' | 'target'>> {
	if (!description || !fieldPath.startsWith('spec')) return [];
	if (shouldSkipPass4(propName, fieldPath, description)) return [];
	if (REFERENCE_FIELD_PATTERN.test(propName)) return [];

	const results: Array<Omit<EdgeRecord, 'source' | 'target'>> = [];
	const seen = new Set<string>();

	for (const pattern of DESCRIPTION_KIND_PATTERNS) {
		for (const match of description.matchAll(pattern.regex)) {
			const kind = match[1];
			if (!kind || kind.length < 2 || STOP_KINDS.has(kind)) continue;
			const rel = resolveRel(pattern.rel, kind, description);
			const dedupe = `${kind}|${rel}`;
			if (seen.has(dedupe)) continue;
			seen.add(dedupe);
			results.push({
				relation: rel,
				fieldPath,
				confidence: pattern.confidence,
				reason: `${pattern.reason(kind)} (${fieldPath})`,
				pass: 4,
				edgeSource: 'inferred',
				confidenceTier: 3
			});
		}
	}

	return results;
}

type SpecProperty = {
	name: string;
	description?: string;
	path: string;
	node?: Record<string, unknown>;
};

function collectSpecProperties(schema: unknown, path = 'spec'): SpecProperty[] {
	const properties: SpecProperty[] = [];
	if (!schema || typeof schema !== 'object') return properties;

	const walk = (node: unknown, currentPath: string) => {
		if (!node || typeof node !== 'object') return;
		const n = node as Record<string, unknown>;

		if (n.properties && typeof n.properties === 'object') {
			for (const [key, val] of Object.entries(n.properties as Record<string, unknown>)) {
				const child = val as Record<string, unknown> | undefined;
				const childPath = `${currentPath}.${key}`;
				properties.push({
					name: key,
					description: typeof child?.description === 'string' ? child.description : undefined,
					path: childPath,
					node: child
				});
				walk(val, childPath);
			}
		}

		if (n.additionalProperties && typeof n.additionalProperties === 'object') {
			walk(n.additionalProperties, `${currentPath}.*`);
		}
		if (n.items) {
			walk(n.items, `${currentPath}[]`);
		}
		for (const comb of ['allOf', 'anyOf', 'oneOf'] as const) {
			if (Array.isArray(n[comb])) {
				for (const el of n[comb]) {
					walk(el, currentPath);
				}
			}
		}
	};

	walk(schema, path);
	return properties;
}

/** Passes 2–4: walk spec properties only. Pass 4 runs only when enabled. */
export function inferSpecSchemaEdges(
	sourceId: string,
	sourceGroup: string,
	specSchema: unknown,
	kindIndex: Map<string, string[]>,
	catalog: Map<string, CatalogEntry>,
	options?: { enableDescriptionPass?: boolean }
): EdgeRecord[] {
	const edges: EdgeRecord[] = [];
	if (!specSchema) return edges;

	const properties = collectSpecProperties(specSchema);
	const handledPaths = new Set<string>();

	for (const prop of properties) {
		if (prop.name === 'apiVersion' || prop.name === 'kind' || prop.name === 'metadata') continue;

		const pass3 = extractPass3SemanticEdge(prop.name, prop.description, prop.path);
		if (pass3) {
			const { kind, ...partial } = pass3;
			resolveTargetAndRecord(edges, sourceId, sourceGroup, kind, partial, kindIndex, catalog);
			handledPaths.add(prop.path);
		}

		const pass2 = extractPass2RefEdge(prop.name, prop.description, prop.path, prop.node);
		if (pass2) {
			const kind = extractKindFromPass2(prop.name, prop.description);
			if (kind) {
				resolveTargetAndRecord(edges, sourceId, sourceGroup, kind, pass2, kindIndex, catalog);
				handledPaths.add(prop.path);
			}
		}

		if (!options?.enableDescriptionPass || handledPaths.has(prop.path)) continue;

		for (const pass4 of extractPass4DescriptionEdges(prop.name, prop.description, prop.path)) {
			const kind = extractKindFromPass4(prop.description!, pass4.relation);
			if (kind) {
				resolveTargetAndRecord(edges, sourceId, sourceGroup, kind, pass4, kindIndex, catalog);
			}
		}
	}

	return edges;
}

function extractKindFromPass2(propName: string, description?: string): string | null {
	if (description) {
		const match = description.match(EXPLICIT_REF_DESCRIPTION);
		if (match?.[1] && !STOP_KINDS.has(match[1])) return match[1];
	}
	const stem = stemToKind(propName);
	return stem && !STOP_KINDS.has(stem) ? stem : null;
}

function extractKindFromPass4(description: string, rel: LinkRelation): string | null {
	for (const pattern of DESCRIPTION_KIND_PATTERNS) {
		for (const match of description.matchAll(pattern.regex)) {
			const kind = match[1];
			if (!kind || STOP_KINDS.has(kind)) continue;
			const resolvedRel = resolveRel(pattern.rel, kind, description);
			if (resolvedRel === rel) return kind;
		}
	}
	return null;
}

function edgeDedupKey(edge: PendingEdge): string {
	return `${edge.source}|${edge.target}|${edge.relation}|${edge.fieldPath}`;
}

function isStrongerEdge(candidate: PendingEdge, existing: PendingEdge): boolean {
	const existingPass = PASS_PRIORITY[existing.pass];
	const nextPass = PASS_PRIORITY[candidate.pass];
	if (nextPass !== existingPass) return nextPass > existingPass;

	const existingSourcePriority = SOURCE_PRIORITY[existing.edgeSource];
	const nextSourcePriority = SOURCE_PRIORITY[candidate.edgeSource];
	if (nextSourcePriority !== existingSourcePriority) return nextSourcePriority > existingSourcePriority;

	const existingRelPriority = REL_PRIORITY[existing.relation];
	const nextRelPriority = REL_PRIORITY[candidate.relation];
	if (nextRelPriority !== existingRelPriority) return nextRelPriority > existingRelPriority;

	return candidate.confidence > existing.confidence;
}

function mergeEdgeCandidates(edges: PendingEdge[]): GraphLink[] {
	const byKey = new Map<string, PendingEdge>();

	for (const edge of edges) {
		if (
			edge.source === edge.target &&
			!isPeerFabricSelfEdge(edge.source, edge.target, edge.fieldPath, edge.reason)
		) {
			continue;
		}
		const key = edgeDedupKey(edge);
		const existing = byKey.get(key);
		if (!existing || isStrongerEdge(edge, existing)) {
			byKey.set(key, edge);
		}
	}

	return [...byKey.values()].map((edge) => ({
		id: edgeDedupKey(edge),
		source: edge.source,
		target: edge.target,
		rel: edge.relation,
		field: edge.fieldPath,
		reason: edge.reason,
		confidence: edge.confidence,
		edgeSource: edge.edgeSource,
		confidenceTier: edge.confidenceTier
	}));
}

export function mergeIntentEdges(edges: EdgeRecord[]): GraphLink[] {
	return mergeEdgeCandidates(edges.map(edgeFromRecord));
}

export function mergeGraphLinks(links: GraphLink[]): GraphLink[] {
	return mergeEdgeCandidates(
		links.map((edge) => ({
			source: edge.source,
			target: edge.target,
			relation: edge.rel,
			fieldPath: edge.field ?? '',
			confidence: edge.confidence ?? MIN_CONFIDENCE,
			reason: edge.reason ?? 'Inferred dependency',
			pass: (edge.confidenceTier === 3 ? 4 : edge.confidenceTier === 2 ? 3 : edge.edgeSource === 'catalog' ? 1 : 2) as InferencePass,
			edgeSource: edge.edgeSource ?? 'inferred',
			confidenceTier:
				edge.confidenceTier ??
				(edge.edgeSource === 'catalog'
					? 1
					: edge.edgeSource === 'explicit' || edge.edgeSource === 'semantic'
						? 2
						: 3),
			field: edge.field
		}))
	);
}

export function inferCatalogLinks(
	catalog: Map<string, CatalogEntry>,
	kindIndex: Map<string, string[]>
): GraphLink[] {
	return mergeIntentEdges(inferCatalogEdges(catalog, kindIndex));
}

export function inferSchemaLinks(
	sourceId: string,
	sourceGroup: string,
	specSchema: unknown,
	statusSchema: unknown,
	kindIndex: Map<string, string[]>,
	catalog: Map<string, CatalogEntry>,
	options?: {
		metadataSchema?: unknown;
		rootDescription?: string;
		enableDescriptionPass?: boolean;
	}
): GraphLink[] {
	void statusSchema;
	void options?.metadataSchema;
	void options?.rootDescription;

	const edges = inferSpecSchemaEdges(
		sourceId,
		sourceGroup,
		specSchema,
		kindIndex,
		catalog,
		{ enableDescriptionPass: options?.enableDescriptionPass ?? false }
	);
	return mergeIntentEdges(edges);
}

export function inferAllSchemaEdges(
	sourceId: string,
	sourceGroup: string,
	specSchema: unknown,
	kindIndex: Map<string, string[]>,
	catalog: Map<string, CatalogEntry>,
	options?: { enableDescriptionPass?: boolean }
): EdgeRecord[] {
	return inferSpecSchemaEdges(sourceId, sourceGroup, specSchema, kindIndex, catalog, options);
}

export function buildCatalogFromManifest(resources: CrdResource[]): Map<string, CatalogEntry> {
	const catalog = new Map<string, CatalogEntry>();
	for (const res of resources) {
		catalog.set(res.name, {
			id: res.name,
			kind: res.kind || shortResourceName(res.name),
			group: res.group || res.name.split('.').slice(1).join('.'),
			type: classifyNodeType(res.name, res.kind || '')
		});
	}
	return catalog;
}

export function catalogToNodes(
	catalog: Map<string, CatalogEntry>,
	versions: Map<string, string>,
	descriptions: Map<string, string>
): GraphNode[] {
	return [...catalog.values()].map((entry) => ({
		id: entry.id,
		kind: entry.kind,
		group: entry.group,
		type: entry.type,
		version: versions.get(entry.id) ?? '',
		description: descriptions.get(entry.id),
		shortName: shortResourceName(entry.id)
	}));
}

export function getKindIndex(catalog: Map<string, CatalogEntry>): Map<string, string[]> {
	return buildKindIndex(catalog);
}
