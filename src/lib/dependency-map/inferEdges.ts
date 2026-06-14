import type { CrdResource } from '$lib/structure';
import {
	edgeClassFromSource,
	type ConfidenceTier,
	type EdgeRecord,
	type EdgeSource,
	type GraphLink,
	type GraphNode,
	type InferencePass,
	type LinkRelation,
	type NodeType
} from './types';
import {
	buildGvkIndex,
	buildKindIndex,
	extractExplicitRefEdges,
	extractOrchestrationIntentHits,
	extractSchemaReferences,
	extractSelectorIntentHits,
	extractWeakDescriptionEdges,
	resolveGvkTarget,
	resolveKindTarget,
	resolveKindTargetWithContext,
	schemaRefHitToEdge,
	walkOpenApiSchemaFields,
	type CatalogEntry
} from './schemaRefs';

type PendingEdge = EdgeRecord & { field?: string; apiVersion?: string };

export type { EdgeRecord, InferencePass };

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

/** Pass 3: whitelisted EDA semantic patterns — never generic *Selector → kind. */
const SEMANTIC_FIELD_PATTERNS: Array<{
	propPattern: RegExp;
	pathPattern?: RegExp;
	kind: string;
	relation: LinkRelation;
	confidence: number;
	reason: string;
	requireTopoNodeInDescription?: boolean;
	requireTopoPathContext?: boolean;
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
		requireTopoNodeInDescription: true,
		requireTopoPathContext: true
	},
	{
		propPattern: /^overlay$/i,
		kind: 'Topology',
		relation: 'extends',
		confidence: 88,
		reason: 'overlay extends base Topology'
	}
];

const TOPO_NODE_IN_DESCRIPTION = /toponode/i;

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

function isPeerFabricSelfEdge(sourceId: string, targetId: string, fieldPath: string, reason: string): boolean {
	return (
		targetId === sourceId &&
		(fieldPath.includes('fabricSelectors') || /peer Fabric|connecting multiple Fabrics/i.test(reason))
	);
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
					confidenceTier: 1,
					edgeClass: 'intentDependency'
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
					confidenceTier: 1,
					edgeClass: 'intentDependency'
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
	catalog: Map<string, CatalogEntry>,
	apiVersion?: string
): void {
	const resolved = resolveKindTargetWithContext(kind, sourceGroup, kindIndex, catalog, {
		fieldPath: partial.fieldPath
	});
	const targetId = resolved.targetId;
	if (!targetId) return;
	const isPeerFabric = isPeerFabricSelfEdge(sourceId, targetId, partial.fieldPath, partial.reason);
	if (targetId === sourceId && !isPeerFabric) return;
	addEdge(
		edges,
		{
			source: sourceId,
			target: targetId,
			...partial,
			apiVersions: apiVersion ? [apiVersion] : partial.apiVersions,
			resolvedCandidates: resolved.ambiguous ? resolved.candidates : undefined,
			confidence: resolved.ambiguous ? Math.min(partial.confidence, 85) : partial.confidence
		},
		isPeerFabric
	);
}

function extractPass3SemanticEdge(
	propName: string,
	description: string | undefined,
	fieldPath: string
): (Omit<EdgeRecord, 'source' | 'target'> & { kind: string }) | null {
	for (const pattern of SEMANTIC_FIELD_PATTERNS) {
		if (!pattern.propPattern.test(propName)) continue;
		if (pattern.pathPattern && !pattern.pathPattern.test(fieldPath)) continue;
		if (pattern.requireTopoNodeInDescription || pattern.requireTopoPathContext) {
			const pathOk = /leafs|spines|borderLeafs|superSpines|deploy|overlayProtocol/i.test(fieldPath);
			const descOk = Boolean(description && TOPO_NODE_IN_DESCRIPTION.test(description));
			if (pattern.requireTopoPathContext && !pathOk && !descOk) continue;
			if (pattern.requireTopoNodeInDescription && !descOk && !pathOk) continue;
		}
		return {
			kind: pattern.kind,
			relation: pattern.relation,
			fieldPath,
			confidence: pattern.confidence,
			reason: `${pattern.reason} (${fieldPath})`,
			pass: 3,
			edgeSource: 'semantic',
			confidenceTier: 2,
			edgeClass: 'intentDependency'
		};
	}
	return null;
}

function recordIntentHits(
	edges: EdgeRecord[],
	sourceId: string,
	sourceGroup: string,
	hits: Array<{ kind: string; relation: LinkRelation; confidence: number; reason: string; fieldPath: string }>,
	kindIndex: Map<string, string[]>,
	catalog: Map<string, CatalogEntry>,
	apiVersion?: string
): void {
	for (const hit of hits) {
		resolveTargetAndRecord(
			edges,
			sourceId,
			sourceGroup,
			hit.kind,
			{
				relation: hit.relation,
				fieldPath: hit.fieldPath,
				confidence: hit.confidence,
				reason: hit.reason,
				pass: 3,
				edgeSource: 'semantic',
				confidenceTier: 2,
				edgeClass: 'intentDependency'
			},
			kindIndex,
			catalog,
			apiVersion
		);
	}
}

/** Passes 2–4: walk OpenAPI schema (spec + status + metadata). Pass 4 (weak) runs only when enabled. */
export function inferSpecSchemaEdges(
	sourceId: string,
	sourceGroup: string,
	sourceKind: string,
	openApiSchema: unknown,
	kindIndex: Map<string, string[]>,
	catalog: Map<string, CatalogEntry>,
	gvkIndex: Map<string, string[]>,
	options?: { enableDescriptionPass?: boolean; apiVersion?: string }
): EdgeRecord[] {
	const edges: EdgeRecord[] = [];
	if (!openApiSchema) return edges;

	const apiVersion = options?.apiVersion;
	const rootDescription =
		openApiSchema && typeof openApiSchema === 'object'
			? (openApiSchema as { description?: string }).description
			: undefined;

	for (const hit of extractSchemaReferences(openApiSchema)) {
		const targetId = hit.gvk
			? resolveGvkTarget(hit.gvk, gvkIndex, catalog)
			: resolveKindTargetWithContext(hit.kind, sourceGroup, kindIndex, catalog, {
					fieldPath: hit.fieldPath
				}).targetId;
		if (!targetId) continue;
		const partial = schemaRefHitToEdge(hit);
		const isPeerFabric = isPeerFabricSelfEdge(sourceId, targetId, partial.fieldPath, partial.reason);
		if (targetId === sourceId && !isPeerFabric) continue;
		addEdge(
			edges,
			{
				source: sourceId,
				target: targetId,
				...partial,
				apiVersions: apiVersion ? [apiVersion] : undefined
			},
			isPeerFabric
		);
	}

	const fields = walkOpenApiSchemaFields(openApiSchema);
	const handledPaths = new Set<string>();

	for (const field of fields) {
		if (field.name === 'apiVersion' || field.name === 'kind' || field.name === 'metadata') continue;

		const prop = {
			name: field.name,
			description: field.description,
			path: field.path,
			node: field.node
		};

		const pass3 = extractPass3SemanticEdge(prop.name, prop.description, prop.path);
		if (pass3) {
			const { kind, ...partial } = pass3;
			resolveTargetAndRecord(
				edges,
				sourceId,
				sourceGroup,
				kind,
				partial,
				kindIndex,
				catalog,
				apiVersion
			);
			handledPaths.add(prop.path);
		}

		const selectorHits = extractSelectorIntentHits(prop.name, prop.description, prop.path, sourceKind);
		recordIntentHits(
			edges,
			sourceId,
			sourceGroup,
			selectorHits.map((h) => ({ ...h, fieldPath: prop.path })),
			kindIndex,
			catalog,
			apiVersion
		);
		if (selectorHits.length > 0) handledPaths.add(prop.path);

		const orchestrationHits = extractOrchestrationIntentHits(prop.description, prop.path, sourceKind);
		recordIntentHits(
			edges,
			sourceId,
			sourceGroup,
			orchestrationHits.map((h) => ({ ...h, fieldPath: prop.path })),
			kindIndex,
			catalog,
			apiVersion
		);
		if (orchestrationHits.length > 0) handledPaths.add(prop.path);

		for (const explicit of extractExplicitRefEdges(prop, { sourceKind })) {
			const { kind, ...partial } = explicit;
			resolveTargetAndRecord(
				edges,
				sourceId,
				sourceGroup,
				kind,
				partial,
				kindIndex,
				catalog,
				apiVersion
			);
			handledPaths.add(prop.path);
		}

		if (!options?.enableDescriptionPass) continue;

		for (const weak of extractWeakDescriptionEdges(prop)) {
			if (handledPaths.has(prop.path)) continue;
			const { kind, ...partial } = weak;
			resolveTargetAndRecord(
				edges,
				sourceId,
				sourceGroup,
				kind,
				partial,
				kindIndex,
				catalog,
				apiVersion
			);
		}
	}

	if (rootDescription) {
		recordIntentHits(
			edges,
			sourceId,
			sourceGroup,
			extractOrchestrationIntentHits(rootDescription, 'spec', sourceKind).map((h) => ({
				...h,
				fieldPath: 'schema'
			})),
			kindIndex,
			catalog,
			apiVersion
		);
	}

	return edges;
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
		confidenceTier: edge.confidenceTier,
		edgeClass: edge.edgeClass ?? edgeClassFromSource(edge.edgeSource),
		apiVersions: edge.apiVersions,
		resolvedCandidates: edge.resolvedCandidates
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
			edgeClass: edge.edgeClass ?? edgeClassFromSource(edge.edgeSource ?? 'inferred'),
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
	openApiSchema: unknown,
	_statusSchema: unknown,
	kindIndex: Map<string, string[]>,
	catalog: Map<string, CatalogEntry>,
	gvkIndex: Map<string, string[]>,
	options?: {
		metadataSchema?: unknown;
		rootDescription?: string;
		enableDescriptionPass?: boolean;
		apiVersion?: string;
	}
): GraphLink[] {
	void _statusSchema;
	void options?.metadataSchema;
	void options?.rootDescription;

	const entry = catalog.get(sourceId);
	const sourceKind = entry?.kind ?? sourceId.split('.')[0] ?? '';
	const edges = inferSpecSchemaEdges(
		sourceId,
		sourceGroup,
		sourceKind,
		openApiSchema,
		kindIndex,
		catalog,
		gvkIndex,
		{
			enableDescriptionPass: options?.enableDescriptionPass ?? true,
			apiVersion: options?.apiVersion
		}
	);
	return mergeIntentEdges(edges);
}

/** Union schema edges across multiple API versions of the same CRD. */
export function inferSchemaLinksForVersions(
	sourceId: string,
	sourceGroup: string,
	schemas: Array<{ apiVersion: string; openApiRoot: unknown }>,
	kindIndex: Map<string, string[]>,
	catalog: Map<string, CatalogEntry>,
	gvkIndex: Map<string, string[]>,
	options?: { enableDescriptionPass?: boolean }
): GraphLink[] {
	const allEdges: EdgeRecord[] = [];
	for (const { apiVersion, openApiRoot } of schemas) {
		const entry = catalog.get(sourceId);
		const sourceKind = entry?.kind ?? sourceId.split('.')[0] ?? '';
		allEdges.push(
			...inferSpecSchemaEdges(
				sourceId,
				sourceGroup,
				sourceKind,
				openApiRoot,
				kindIndex,
				catalog,
				gvkIndex,
				{
					enableDescriptionPass: options?.enableDescriptionPass ?? true,
					apiVersion
				}
			)
		);
	}
	return mergeIntentEdges(allEdges);
}

export function inferAllSchemaEdges(
	sourceId: string,
	sourceGroup: string,
	openApiSchema: unknown,
	kindIndex: Map<string, string[]>,
	catalog: Map<string, CatalogEntry>,
	gvkIndex: Map<string, string[]>,
	options?: { enableDescriptionPass?: boolean }
): EdgeRecord[] {
	const entry = catalog.get(sourceId);
	const sourceKind = entry?.kind ?? sourceId.split('.')[0] ?? '';
	return inferSpecSchemaEdges(
		sourceId,
		sourceGroup,
		sourceKind,
		openApiSchema,
		kindIndex,
		catalog,
		gvkIndex,
		options
	);
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

export function getGvkIndex(catalog: Map<string, CatalogEntry>): Map<string, string[]> {
	return buildGvkIndex(catalog);
}
