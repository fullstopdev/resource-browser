/**
 * EDA CRD dependency extraction — OpenAPI schema reference discovery.
 *
 * **Tier 1 (schema annotations)** — `extractSchemaReferences()` walks `openAPIV3Schema` recursively
 * (`properties`, `items`, `additionalProperties`, `allOf`, `oneOf`, `anyOf`) and emits edges when:
 *
 * 1. A node has `x-references: "Kind"` or `x-references: ["Kind", …]`
 * 2. A node has `x-kubernetes-group-version-kind` pointing at a catalog group/kind
 * 3. An object has both `apiVersion` and `kind` where `kind.enum` lists target kinds
 * 4. The root schema has top-level `x-references` listing kinds directly
 *
 * **Tier 2 (supplementary)** — description-based "Reference to …" parsing, *Ref field stems, and
 * whitelisted semantic field patterns (see inferEdges pass 3).
 *
 * **Tier 3 (opt-in)** — weak description patterns ("creating an X resource").
 *
 * Kind resolution matches manifest catalog entries by group+kind (GVK index) or kind name with
 * plural/singular normalization; unresolved kinds are dropped.
 */

import {
	type ConfidenceTier,
	type EdgeRecord,
	type EdgeSource,
	type LinkRelation,
	type NodeType
} from './types';

import { walkSchema } from '../schemaGraph/walkSchema';

export type CatalogEntry = {
	id: string;
	kind: string;
	group: string;
	type: NodeType;
};

export type SchemaRefPattern =
	| 'x-references'
	| 'root-x-references'
	| 'x-kubernetes-gvk'
	| 'kind-apiVersion-enum';

export type GvkRef = {
	group: string;
	kind: string;
	version?: string;
};

export type SchemaReferenceHit = {
	kind: string;
	fieldPath: string;
	pattern: SchemaRefPattern;
	gvk?: GvkRef;
};

export type SpecProperty = {
	name: string;
	description?: string;
	path: string;
	node?: Record<string, unknown>;
};

/** Unified field hit from a single OpenAPI schema walk. */
export type SchemaFieldHit = SpecProperty & {
	schemaRefs: SchemaReferenceHit[];
};

export type ResolveContext = {
	fieldPath?: string;
};

export type ResolveResult = {
	targetId: string | null;
	candidates: string[];
	ambiguous: boolean;
};

/** OpenAPI schema words that appear in descriptions but are not CRD kinds. */
const GENERIC_KIND_WORDS = new Set([
	'API',
	'Node',
	'Object',
	'REST',
	'Schema',
	'String',
	'Type',
	'Value',
	'CamelCase',
	'Default',
	'Resource',
	'Kind',
	'CR'
]);

/** Field names that reference routing-policy *Set CRDs (suffix Set, not *Ref). */
const ROUTING_POLICY_SET_FIELD_KINDS: Record<string, string> = {
	prefixSet: 'PrefixSet',
	tagSet: 'TagSet',
	asPathSet: 'ASPathSet',
	communitySet: 'CommunitySet',
	applyTagSet: 'TagSet'
};

export function kindFromRoutingPolicySetField(propName: string): string | null {
	return ROUTING_POLICY_SET_FIELD_KINDS[propName] ?? null;
}

/** Field names that denote cross-CRD references (*Ref stems), not BGP preference or git ref. */
export const REFERENCE_FIELD_PATTERN = /(?:Ref|Refs|ResourceRef|Reference)$/i;

const REFERENCE_FIELD_FALSE_POSITIVES = new Set([
	'ref',
	'preference',
	'localpreference',
	'setlocalpreference',
	'ebgppreference',
	'ibgppreference'
]);

export function isReferenceFieldName(propName: string): boolean {
	if (REFERENCE_FIELD_FALSE_POSITIVES.has(propName.toLowerCase())) return false;
	return REFERENCE_FIELD_PATTERN.test(propName);
}

/** Description wording → operational relation (intent-based schema). */
const DESCRIPTION_INTENT_RELATIONS: Array<{ pattern: RegExp; relation: LinkRelation }> = [
	{ pattern: /on which to (configure|push|provision)/i, relation: 'bindsTo' },
	{ pattern: /to which this config is applied/i, relation: 'bindsTo' },
	{ pattern: /filter routes|evaluat|apply.*policy/i, relation: 'appliesTo' },
	{ pattern: /extending|extends the topology/i, relation: 'extends' },
	{ pattern: /creating an?\s+\w+\s+resource/i, relation: 'orchestrates' },
	{ pattern: /deploy(?:ment)?\s+.*\s+to\b/i, relation: 'deploys' }
];

/** Description variants → canonical manifest kind names. */
export const KIND_ALIASES: Record<string, string> = {
	IRBInterface: 'IrbInterface',
	IRB: 'IrbInterface',
	RoutingPolicy: 'Policy',
	BgpGroup: 'BGPGroup',
	BgpPeer: 'BGPPeer',
	Bridge: 'BridgeDomain'
};

/** Descriptions that name meta-concepts, not concrete CRD kinds. */
const NEGATIVE_DESCRIPTION_PATTERNS: RegExp[] = [/Reference to the transaction id/i];

const META_INTERFACE_DESCRIPTION = /kind of interface/i;

/** Full-phrase description → CRD kind(s) before generic token parsing. */
const DESCRIPTION_PHRASE_KINDS: Array<{ pattern: RegExp; kinds: string[] }> = [
	{ pattern: /Reference to (?:a\s+)?Node object/i, kinds: ['TopoNode'] },
	{ pattern: /Reference to (?:a\s+)?Node on which/i, kinds: ['TopoNode'] },
	{ pattern: /Reference to (?:a\s+)?list of TopoNodes/i, kinds: ['TopoNode'] },
	{ pattern: /Reference to targets to deploy Configlet to/i, kinds: ['TopoNode'] },
	{ pattern: /Reference to (?:an?\s+)?interface(?:\s+in|\s+whose|\s*$)/i, kinds: ['Interface'] },
	{ pattern: /Reference to (?:a\s+)?Bridge Domain/i, kinds: ['BridgeDomain'] },
	{ pattern: /Reference to (?:a\s+)?default Router/i, kinds: ['DefaultRouter'] },
	{ pattern: /Reference to Default Bgp Group/i, kinds: ['DefaultBGPGroup'] },
	{ pattern: /Reference to (?:a\s+)?parent component/i, kinds: ['Component'] },
	{ pattern: /Reference to (?:a\s+)?child component/i, kinds: ['Component'] },
	{ pattern: /Reference to (?:a\s+)?RoutingPolicy/i, kinds: ['Policy'] },
	{ pattern: /Reference to (?:a\s+)?IPV4 DefaultOSPFArea/i, kinds: ['DefaultOSPFArea'] },
	{ pattern: /Reference to (?:a\s+)?IPV4 DefaultOSPFInstance/i, kinds: ['DefaultOSPFInstance'] },
	{ pattern: /Reference to (?:the\s+)?dynamic IPV6 BGPPeer/i, kinds: ['BGPPeer'] },
	{ pattern: /Reference to (?:a\s+)?Default LDP Router/i, kinds: ['DefaultLDPRouter'] },
	{ pattern: /Reference to (?:a\s+)?Default OSPF Instance/i, kinds: ['DefaultOSPFInstance'] },
	{
		pattern: /Reference to the topology that this overlay is extending/i,
		kinds: ['Topology']
	},
	{ pattern: /Reference to (?:a\s+)?IPV[46] DefaultOSPFArea/i, kinds: ['DefaultOSPFArea'] },
	{ pattern: /Reference to (?:a\s+)?IPV[46] DefaultOSPFInstance/i, kinds: ['DefaultOSPFInstance'] },
	{ pattern: /Reference to the (?:IPV[46] )?BGPPeer created/i, kinds: ['BGPPeer'] },
	{ pattern: /Reference to the (?:IPV[46] )?OSPF Interface/i, kinds: ['OSPFInterface'] },
	{ pattern: /Reference to the DefaulInterface/i, kinds: ['DefaultInterface'] },
	{ pattern: /Reference to the LDPRouter/i, kinds: ['DefaultLDPRouter'] },
	{ pattern: /Reference to Nodes on which/i, kinds: ['TopoNode'] },
	{ pattern: /Reference to (?:a\s+)?OSPF Instance/i, kinds: ['OSPFInstance'] },
	{ pattern: /Reference to an ospf area/i, kinds: ['OSPFArea'] },
	{ pattern: /Reference to an ospf instance/i, kinds: ['OSPFInstance'] },
	{ pattern: /Reference to an ospf interface/i, kinds: ['OSPFInterface'] },
	{ pattern: /Reference to a default interface/i, kinds: ['DefaultInterface'] },
	{
		pattern: /Reference to the interface whose IP is used as a source IP/i,
		kinds: ['RoutedInterface', 'IrbInterface']
	},
	{ pattern: /Reference to the OSPV[23] State/i, kinds: ['OSPFInterfaceState'] },
	{ pattern: /Reference to (?:a\s+)?TopoNode to which this config is applied/i, kinds: ['TopoNode'] },
	{ pattern: /Reference to (?:a\s+)?TopoNode\./i, kinds: ['TopoNode'] },
	{ pattern: /Reference to (?:a\s+)?Interface\./i, kinds: ['Interface'] },
	{ pattern: /Match conditions for BGP communities/i, kinds: ['CommunitySet'] }
];

/** Non-EDA references (K8s secrets, external tokens) — skip in audit and inference. */
const EXTERNAL_REFERENCE_PATTERNS: RegExp[] = [
	/\bkubernetes secret\b/i,
	/\bsecret containing\b/i,
	/\bconfigmap that contains\b/i,
	/\bconfigmap containing\b/i,
	/\bgithub token\b/i,
	/\bgitlab token\b/i,
	/\bnetbox\b/i,
	/\bclient credentials\b/i,
	/\bauthentication secret reference\b/i,
	/\bauthsecretref\b/i,
	/\bsecret to use when pulling\b/i,
	/\bcertmanager issuer\b/i,
	/\bgit hash or tag\b/i
];

/** Field-path hints when kind name is ambiguous (e.g. Interface). */
const FIELD_PATH_KIND_PREFERENCES: Array<{ pattern: RegExp; kinds: string[] }> = [
	{ pattern: /bgp|localAddress|routed|peer/i, kinds: ['RoutedInterface', 'IrbInterface'] },
	{ pattern: /bridgeinterface|bridgedomain/i, kinds: ['BridgeInterface', 'BridgeDomain'] },
	{ pattern: /ospf/i, kinds: ['RoutedInterface', 'IrbInterface', 'OSPFInterface'] }
];

/** Pass 4 only: conservative "creating an X resource" wording. */
export const WEAK_DESCRIPTION_PATTERNS: Array<{
	regex: RegExp;
	rel: LinkRelation | ((kind: string, description: string) => LinkRelation);
	confidence: number;
	reason: (kind: string) => string;
}> = [
	{
		regex: /creating an?\s+([A-Z][A-Za-z0-9]+)\s+resource/gi,
		rel: 'orchestrates',
		confidence: 70,
		reason: (kind) => `Description orchestrates creation of ${kind}`
	}
];

/** Map pool wording in descriptions to allocation-pool CRD kinds. */
const POOL_DESCRIPTION_ALIASES: Array<{ pattern: RegExp; kind: string }> = [
	{ pattern: /\bevi\s+pool\b/i, kind: 'IndexAllocationPool' },
	{ pattern: /\bvni\s+pool\b/i, kind: 'IndexAllocationPool' },
	{ pattern: /\bvlan\s+pool\b/i, kind: 'IndexAllocationPool' },
	{ pattern: /\btunnel\s+index(?:\s+allocation)?\s+pool\b/i, kind: 'IndexAllocationPool' },
	{ pattern: /\broute\s+distinguisher\s+allocation\b/i, kind: 'IndexAllocationPool' },
	{ pattern: /\bpool\b.*\broute\s+distinguisher\b/i, kind: 'IndexAllocationPool' },
	{ pattern: /\bipv4\b.*\bpool\b/i, kind: 'IPAllocationPool' },
	{ pattern: /\bipv6\b.*\bpool\b/i, kind: 'IPAllocationPool' },
	{ pattern: /\bsystem\s+pool\s+ipv[46]\b/i, kind: 'IPAllocationPool' }
];

const POLICY_FIELD_PATTERN = /^(exportPolicy|importPolicy|exportPolicies|importPolicies)$/i;
const ISL_FROM_LINK_SELECTORS = /creating an?\s+ISL\b/i;
const TOPO_NODE_IN_DESCRIPTION = /toponode/i;
const TOPO_LINK_IN_DESCRIPTION = /topolinks?/i;

/** Pass 3: selector / orchestration descriptions without "Reference to". */
export type SelectorIntentHit = {
	kind: string;
	relation: LinkRelation;
	confidence: number;
	reason: string;
};

export const SELECTOR_DESCRIPTION_PATTERNS: Array<{
	propPattern: RegExp;
	descriptionPattern: RegExp;
	pathPattern?: RegExp;
	excludePathPattern?: RegExp;
	sourceKindPattern?: RegExp;
	kind: string;
	relation: LinkRelation;
	confidence: number;
	reason: string;
}> = [
	{
		propPattern: /NodeSelectors?$/i,
		descriptionPattern: TOPO_NODE_IN_DESCRIPTION,
		pathPattern: /leafs|spines|borderLeafs|superSpines|deploy|overlayProtocol/i,
		kind: 'TopoNode',
		relation: 'bindsTo',
		confidence: 85,
		reason: 'role node selector binds to TopoNode'
	},
	{
		propPattern: /^linkSelectors$/i,
		descriptionPattern: /selects TopoLinks/i,
		kind: 'TopoLink',
		relation: 'bindsTo',
		confidence: 86,
		reason: 'linkSelectors bind to TopoLink inputs'
	},
	{
		propPattern: /^uplinkSelectors$/i,
		descriptionPattern: TOPO_LINK_IN_DESCRIPTION,
		kind: 'TopoLink',
		relation: 'bindsTo',
		confidence: 86,
		reason: 'uplinkSelectors bind to TopoLink'
	},
	{
		propPattern: /^endpointSelectors$/i,
		descriptionPattern: /deploy|target/i,
		kind: 'TopoNode',
		relation: 'bindsTo',
		confidence: 86,
		reason: 'endpointSelectors bind deploy targets to TopoNode'
	},
	{
		propPattern: /^clientNodeSelectors$/i,
		descriptionPattern: /RouteReflectorClient/i,
		kind: 'RouteReflectorClient',
		relation: 'bindsTo',
		confidence: 84,
		reason: 'clientNodeSelectors bind to RouteReflectorClient'
	},
	{
		propPattern: /^(rrNodeSelectors|nodeSelectors)$/i,
		descriptionPattern: /RouteReflector/i,
		sourceKindPattern: /^RouteReflector$/i,
		kind: 'RouteReflector',
		relation: 'bindsTo',
		confidence: 84,
		reason: 'nodeSelectors bind to RouteReflector peers'
	}
];

export const ORCHESTRATION_DESCRIPTION_PATTERNS: Array<{
	pathPattern?: RegExp;
	sourceKindPattern?: RegExp;
	descriptionPattern: RegExp;
	kinds: string[];
	relation: LinkRelation;
	confidence: number;
	reason: string;
}> = [
	{
		pathPattern: /overlayProtocol\.bgp/i,
		sourceKindPattern: /^Fabric$/i,
		descriptionPattern: /DefaultRouteReflector/i,
		kinds: ['DefaultRouteReflector', 'DefaultRouteReflectorClient'],
		relation: 'orchestrates',
		confidence: 84,
		reason: 'Fabric overlay BGP orchestrates route reflector resources'
	},
	{
		pathPattern: /overlayProtocol\.bgp/i,
		sourceKindPattern: /^Fabric$/i,
		descriptionPattern: /DefaultBGPPeer/i,
		kinds: ['DefaultBGPPeer'],
		relation: 'orchestrates',
		confidence: 84,
		reason: 'Fabric overlay BGP orchestrates DefaultBGPPeer'
	},
	{
		sourceKindPattern: /^NetworkTopology$/i,
		descriptionPattern: /create|reconcile|topology (?:nodes|links)|sim(?:ulation)?\s*node/i,
		kinds: ['TopoNode', 'TopoLink', 'SimNode'],
		relation: 'orchestrates',
		confidence: 82,
		reason: 'NetworkTopology workflow orchestrates topology resources'
	}
];

export function isMetaInterfaceDescription(description: string): boolean {
	return META_INTERFACE_DESCRIPTION.test(description);
}

export function isInterfaceReferenceDescription(description: string): boolean {
	return /InterfaceReference type defines/i.test(description);
}

export function isActionableMetaInterfaceField(
	propName: string,
	description: string | undefined
): boolean {
	if (!description) return false;
	if (/^interfaceKind$/i.test(propName)) {
		return isMetaInterfaceDescription(description) || isInterfaceReferenceDescription(description);
	}
	return isMetaInterfaceDescription(description);
}

export function resolveInterfaceKindFromContext(fieldPath: string, sourceKind: string): string[] {
	if (/ospf/i.test(fieldPath) || /OSPF/.test(sourceKind)) {
		return ['RoutedInterface', 'IrbInterface', 'OSPFInterface'];
	}
	if (/bgp|peer/i.test(fieldPath) || /BGP|Peer|RouteReflector/i.test(sourceKind)) {
		return ['RoutedInterface', 'IrbInterface'];
	}
	return ['RoutedInterface', 'IrbInterface', 'Interface'];
}

export function extractMetaInterfaceKinds(
	propName: string,
	description: string,
	fieldPath: string,
	sourceKind: string
): string[] {
	if (!isActionableMetaInterfaceField(propName, description)) return [];
	if (isInterfaceReferenceDescription(description)) {
		return ['RoutedInterface', 'IrbInterface'];
	}
	return resolveInterfaceKindFromContext(fieldPath, sourceKind);
}

export function extractMonitorTargetKinds(
	propName: string,
	description: string,
	sourceKind: string
): string[] {
	if (!/^(targets?)$/i.test(propName)) return [];
	if (!/Monitor/.test(sourceKind)) return [];
	if (/targets? to monitor/i.test(description) || /target being monitored/i.test(description)) {
		return ['TopoNode'];
	}
	return [];
}

export function extractSelectorIntentHits(
	propName: string,
	description: string | undefined,
	fieldPath: string,
	sourceKind: string
): SelectorIntentHit[] {
	if (!description) return [];
	const hits: SelectorIntentHit[] = [];
	for (const pattern of SELECTOR_DESCRIPTION_PATTERNS) {
		if (!pattern.propPattern.test(propName)) continue;
		if (!pattern.descriptionPattern.test(description)) continue;
		if (pattern.pathPattern && !pattern.pathPattern.test(fieldPath)) continue;
		if (pattern.excludePathPattern && pattern.excludePathPattern.test(fieldPath)) continue;
		if (pattern.sourceKindPattern && !pattern.sourceKindPattern.test(sourceKind)) continue;
		hits.push({
			kind: pattern.kind,
			relation: pattern.relation,
			confidence: pattern.confidence,
			reason: `${pattern.reason} (${fieldPath})`
		});
	}
	return hits;
}

export function extractOrchestrationIntentHits(
	description: string | undefined,
	fieldPath: string,
	sourceKind: string
): SelectorIntentHit[] {
	if (!description) return [];
	const hits: SelectorIntentHit[] = [];
	for (const pattern of ORCHESTRATION_DESCRIPTION_PATTERNS) {
		if (pattern.pathPattern && !pattern.pathPattern.test(fieldPath)) continue;
		if (pattern.sourceKindPattern && !pattern.sourceKindPattern.test(sourceKind)) continue;
		if (!pattern.descriptionPattern.test(description)) continue;
		for (const kind of pattern.kinds) {
			hits.push({
				kind,
				relation: pattern.relation,
				confidence: pattern.confidence,
				reason: `${pattern.reason} (${fieldPath})`
			});
		}
	}
	return hits;
}

function normalizeKindKey(kind: string): string {
	return kind.replace(/\s+/g, '').toLowerCase();
}

export function kindLookupKeys(kind: string): string[] {
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

export function buildKindIndex(catalog: Map<string, CatalogEntry>): Map<string, string[]> {
	const index = new Map<string, string[]>();
	for (const entry of catalog.values()) {
		const kind = entry.kind || entry.id.split('.')[0];
		for (const key of kindLookupKeys(kind)) {
			const list = index.get(key) ?? [];
			if (!list.includes(entry.id)) list.push(entry.id);
			index.set(key, list);
		}
	}
	return index;
}

export function buildGvkIndex(catalog: Map<string, CatalogEntry>): Map<string, string[]> {
	const index = new Map<string, string[]>();
	for (const entry of catalog.values()) {
		const key = `${entry.group}|${entry.kind}`;
		const list = index.get(key) ?? [];
		if (!list.includes(entry.id)) list.push(entry.id);
		index.set(key, list);
	}
	return index;
}

export function resolveGvkTarget(
	gvk: GvkRef,
	gvkIndex: Map<string, string[]>,
	catalog: Map<string, CatalogEntry>
): string | null {
	const key = `${gvk.group}|${gvk.kind}`;
	const candidates = gvkIndex.get(key) ?? [];
	if (candidates.length === 0) {
		return null;
	}
	if (candidates.length === 1) return candidates[0];
	const sameKind = candidates.filter((id) => catalog.get(id)?.kind === gvk.kind);
	if (sameKind.length === 1) return sameKind[0];
	return candidates[0] ?? null;
}

export function normalizeKindAlias(kind: string): string {
	return KIND_ALIASES[kind] ?? kind;
}

export function isDescriptionMetaReference(description: string): boolean {
	return NEGATIVE_DESCRIPTION_PATTERNS.some((p) => p.test(description));
}

export function isExternalReferenceDescription(description: string): boolean {
	return EXTERNAL_REFERENCE_PATTERNS.some((p) => p.test(description));
}

function stripReferenceClause(segment: string): string {
	return segment
		.split(/\s+on which\b/i)[0]!
		.split(/\s+whose\b/i)[0]!
		.replace(/[.,;:]+$/, '')
		.trim();
}

function extractKindToken(segment: string): string | null {
	const cleaned = stripReferenceClause(segment).replace(/^(?:a|an|the)\s+/i, '');
	const match = cleaned.match(/^([A-Z][A-Za-z0-9]+)/);
	if (!match) return null;
	const kind = normalizeKindAlias(match[1]);
	if (GENERIC_KIND_WORDS.has(kind)) return null;
	return kind;
}

export function inferRelationFromDescription(description: string | undefined): LinkRelation | null {
	if (!description) return null;
	for (const entry of DESCRIPTION_INTENT_RELATIONS) {
		if (entry.pattern.test(description)) return entry.relation;
	}
	return null;
}

function isInternalTopologyTemplateReference(
	propName: string,
	fieldPath: string,
	description: string
): boolean {
	if (!/^template$/i.test(propName)) return false;
	if (!/spec\.(nodes|links|simNodes|simulation\.simNodes|topoBreakouts)/i.test(fieldPath)) return false;
	return /template to use for this (TopoNode|TopoLink|SimNode|TopoBreakout)/i.test(description);
}

export function resolveKindTarget(
	kind: string,
	sourceGroup: string,
	kindIndex: Map<string, string[]>,
	catalog: Map<string, CatalogEntry>,
	context?: ResolveContext
): string | null {
	return resolveKindTargetWithContext(kind, sourceGroup, kindIndex, catalog, context).targetId;
}

export function resolveKindTargetWithContext(
	kind: string,
	sourceGroup: string,
	kindIndex: Map<string, string[]>,
	catalog: Map<string, CatalogEntry>,
	context?: ResolveContext
): ResolveResult {
	const normalized = normalizeKindAlias(kind);
	if (GENERIC_KIND_WORDS.has(normalized)) {
		return { targetId: null, candidates: [], ambiguous: false };
	}

	const candidates = new Set<string>();
	for (const key of kindLookupKeys(normalized)) {
		for (const id of kindIndex.get(key) ?? []) {
			candidates.add(id);
		}
	}
	const list = [...candidates];
	if (list.length === 0) {
		return { targetId: null, candidates: [], ambiguous: false };
	}
	if (list.length === 1) {
		return { targetId: list[0], candidates: list, ambiguous: false };
	}

	const fieldPath = context?.fieldPath ?? '';
	for (const hint of FIELD_PATH_KIND_PREFERENCES) {
		if (!hint.pattern.test(fieldPath)) continue;
		const preferred = list.filter((id) => {
			const entryKind = catalog.get(id)?.kind ?? '';
			return hint.kinds.includes(entryKind);
		});
		if (preferred.length === 1) {
			return { targetId: preferred[0], candidates: list, ambiguous: false };
		}
		if (preferred.length > 1) {
			return { targetId: preferred[0], candidates: preferred, ambiguous: true };
		}
	}

	const sameGroup = list.filter((id) => catalog.get(id)?.group === sourceGroup);
	if (sameGroup.length === 1) {
		return { targetId: sameGroup[0], candidates: list, ambiguous: false };
	}

	const sourceShort = normalizeKindKey(normalized);
	const exactKind = list.filter((id) => {
		const entry = catalog.get(id);
		if (!entry) return false;
		const entryKind = entry.kind || entry.id.split('.')[0];
		return kindLookupKeys(entryKind).includes(sourceShort);
	});
	if (exactKind.length === 1) {
		return { targetId: exactKind[0], candidates: list, ambiguous: false };
	}

	const pool = exactKind.length > 0 ? exactKind : sameGroup.length > 0 ? sameGroup : list;
	return {
		targetId: pool[0] ?? null,
		candidates: list,
		ambiguous: pool.length > 1
	};
}

export function isCatalogKind(
	kind: string,
	kindIndex: Map<string, string[]>,
	catalog: Map<string, CatalogEntry>,
	sourceGroup: string
): boolean {
	return resolveKindTarget(kind, sourceGroup, kindIndex, catalog) !== null;
}

export function stemToKindForAudit(propName: string): string | null {
	const stem = propName.replace(REFERENCE_FIELD_PATTERN, '');
	if (!stem || stem === propName) return null;
	return stem.charAt(0).toUpperCase() + stem.slice(1);
}

function stemToKind(propName: string): string | null {
	return stemToKindForAudit(propName);
}

function relationForField(
	propName: string,
	kind: string,
	description: string | undefined
): LinkRelation {
	if (POLICY_FIELD_PATTERN.test(propName)) return 'appliesTo';
	if (description && isMetaInterfaceDescription(description)) return 'bindsTo';
	if (kind === 'Policy' && description && /route|policy|evaluat|filter|export|import/i.test(description)) {
		return 'appliesTo';
	}
	const fromDescription = inferRelationFromDescription(description);
	if (fromDescription) return fromDescription;
	return 'references';
}

export function extractKindsFromDescription(description: string): string[] {
	if (isDescriptionMetaReference(description) || isExternalReferenceDescription(description)) {
		return [];
	}

	const phraseKinds: string[] = [];
	for (const phrase of DESCRIPTION_PHRASE_KINDS) {
		if (!phrase.pattern.test(description)) continue;
		for (const kind of phrase.kinds) {
			if (!phraseKinds.includes(kind)) phraseKinds.push(kind);
		}
	}
	if (phraseKinds.length > 0) return phraseKinds;

	const poolKinds: string[] = [];
	for (const alias of POOL_DESCRIPTION_ALIASES) {
		if (alias.pattern.test(description) && !poolKinds.includes(alias.kind)) {
			poolKinds.push(alias.kind);
		}
	}
	if (poolKinds.length > 0) return poolKinds;

	const kinds: string[] = [];
	if (/Reference to/i.test(description)) {
		const tail = description.match(/Reference to\s+(.+)/i)?.[1];
		if (tail) {
			const body = tail.replace(/^(?:either\s+)?(?:a|an|the)\s+/i, '');
			for (const segment of body.split(/\s+or\s+/i)) {
				const kind = extractKindToken(segment);
				if (kind && !kinds.includes(kind)) kinds.push(kind);
			}
			if (kinds.length === 0) {
				const direct = extractKindToken(body);
				if (direct && !kinds.includes(direct)) kinds.push(direct);
			}
		}
	}

	return kinds;
}

export function shouldSkipDescriptionInference(
	propName: string,
	fieldPath: string,
	description: string
): boolean {
	if (isDescriptionMetaReference(description) || isExternalReferenceDescription(description)) {
		return true;
	}
	if (isInternalTopologyTemplateReference(propName, fieldPath, description)) {
		return true;
	}
	if (/^linkSelectors$/i.test(propName) && /interSwitchLinks/i.test(fieldPath)) {
		return true;
	}
	if (/Selectors?$/i.test(propName) && ISL_FROM_LINK_SELECTORS.test(description)) {
		return true;
	}
	// Label selectors are not resource refs unless description names TopoNode or TopoLink.
	if (
		/Selectors?$/i.test(propName) &&
		!/toponode/i.test(description) &&
		!/topolinks?/i.test(description) &&
		!/route reflector/i.test(description) &&
		!/deploy|target/i.test(description)
	) {
		return true;
	}
	return false;
}

type PartialEdge = Omit<EdgeRecord, 'source' | 'target'>;

function edgeFromDescription(
	propName: string,
	description: string,
	fieldPath: string,
	kind: string
): PartialEdge {
	return {
		relation: relationForField(propName, kind, description),
		fieldPath,
		confidence: 90,
		reason: `Schema description references ${kind} (${fieldPath})`,
		pass: 2,
		edgeSource: 'explicit',
		confidenceTier: 2,
		edgeClass: 'hardRef'
	};
}

function edgeFromRefField(
	propName: string,
	description: string | undefined,
	fieldPath: string,
	kind: string
): PartialEdge {
	return {
		relation: relationForField(propName, kind, description),
		fieldPath,
		confidence: description ? 92 : 86,
		reason: description
			? `Ref field: ${description.trim().slice(0, 80)} (${fieldPath})`
			: `Ref field stem ${propName} → ${kind} (${fieldPath})`,
		pass: 2,
		edgeSource: 'explicit',
		confidenceTier: 2,
		edgeClass: 'hardRef'
	};
}

const SCHEMA_REF_PATTERN_LABEL: Record<SchemaRefPattern, string> = {
	'x-references': 'x-references',
	'root-x-references': 'root x-references',
	'x-kubernetes-gvk': 'x-kubernetes-group-version-kind',
	'kind-apiVersion-enum': 'kind enum + apiVersion'
};

function relationForFieldPath(fieldPath: string): LinkRelation {
	const lastSegment = fieldPath.split('.').pop() ?? '';
	if (POLICY_FIELD_PATTERN.test(lastSegment)) return 'appliesTo';
	return 'references';
}

export function schemaRefHitToEdge(hit: SchemaReferenceHit): PartialEdge {
	const targetLabel = hit.gvk?.kind ?? hit.kind;
	return {
		relation: relationForFieldPath(hit.fieldPath),
		fieldPath: hit.fieldPath,
		confidence: 98,
		reason: `Schema ${SCHEMA_REF_PATTERN_LABEL[hit.pattern]} → ${targetLabel} (${hit.fieldPath})`,
		pass: 2,
		edgeSource: 'explicit',
		confidenceTier: 1,
		edgeClass: 'hardRef'
	};
}

function parseGvkExtension(value: unknown): GvkRef[] {
	if (!value || typeof value !== 'object') return [];
	if (Array.isArray(value)) {
		return value.flatMap((item) => parseGvkExtension(item));
	}
	const obj = value as Record<string, unknown>;
	if (typeof obj.kind !== 'string' || typeof obj.group !== 'string') return [];
	return [
		{
			group: obj.group,
			kind: obj.kind,
			version: typeof obj.version === 'string' ? obj.version : undefined
		}
	];
}

function collectXReferences(xRef: unknown): string[] {
	if (typeof xRef === 'string') return [xRef];
	if (!Array.isArray(xRef)) return [];
	return xRef.filter((item): item is string => typeof item === 'string');
}

function detectKindApiVersionEnum(
	props: Record<string, unknown>,
	parentPath: string,
	add: (hit: SchemaReferenceHit) => void
): void {
	if (!('apiVersion' in props)) return;
	const kindNode = props.kind;
	if (!kindNode || typeof kindNode !== 'object') return;
	const enumVals = (kindNode as Record<string, unknown>).enum;
	if (!Array.isArray(enumVals)) return;

	const kindPath = parentPath ? `${parentPath}.kind` : 'kind';
	for (const value of enumVals) {
		if (typeof value !== 'string' || GENERIC_KIND_WORDS.has(value)) continue;
		add({
			kind: value,
			fieldPath: kindPath,
			pattern: 'kind-apiVersion-enum'
		});
	}
}

/**
 * Walk an OpenAPI v3 schema and collect dependency targets from schema annotations.
 * Accepts the full `openAPIV3Schema` root or a spec subtree.
 */
export function extractSchemaReferences(openApiSchema: unknown): SchemaReferenceHit[] {
	const results: SchemaReferenceHit[] = [];
	const seen = new Set<string>();

	const add = (hit: SchemaReferenceHit) => {
		const key = `${hit.pattern}|${hit.fieldPath}|${hit.kind}|${hit.gvk?.group ?? ''}|${hit.gvk?.kind ?? ''}`;
		if (seen.has(key)) return;
		if (!hit.gvk && GENERIC_KIND_WORDS.has(hit.kind)) return;
		seen.add(key);
		results.push(hit);
	};

	const emitXReferences = (xRef: unknown, fieldPath: string, pattern: SchemaRefPattern) => {
		for (const kind of collectXReferences(xRef)) {
			add({ kind, fieldPath, pattern });
		}
	};

	const emitGvk = (xGvk: unknown, fieldPath: string) => {
		for (const gvk of parseGvkExtension(xGvk)) {
			add({
				kind: gvk.kind,
				fieldPath,
				pattern: 'x-kubernetes-gvk',
				gvk
			});
		}
	};

	const stringifyPath = (segments: string[]): string => {
		if (segments.length === 0) return '';
		let out = segments[0] ?? '';
		for (let i = 1; i < segments.length; i++) {
			const seg = segments[i]!;
			// Match the legacy schemaRefs path formatting exactly:
			// - items are appended as `[]` (no dot)
			// - additionalProperties uses `*` after a dot (e.g. `path.*`)
			if (seg === '[]') out += '[]';
			else out += `.${seg}`;
		}
		return out;
	};

	walkSchema(openApiSchema, (currentPath, node) => {
		if (!node || typeof node !== 'object') return;
		const n = node as Record<string, unknown>;
		const path = stringifyPath(currentPath);

		if (n['x-references'] !== undefined) {
			emitXReferences(n['x-references'], path || 'schema', path ? 'x-references' : 'root-x-references');
		}

		if (n['x-kubernetes-group-version-kind'] !== undefined) {
			emitGvk(n['x-kubernetes-group-version-kind'], path || 'schema');
		}

		if (n.properties && typeof n.properties === 'object') {
			const props = n.properties as Record<string, unknown>;
			detectKindApiVersionEnum(props, path, add);
		}
	});
	return results;
}

/** Resolve the spec subtree when given a full CRD openAPIV3Schema root. */
export function extractSpecSubtree(openApiSchema: unknown): unknown {
	if (!openApiSchema || typeof openApiSchema !== 'object') return openApiSchema;
	const root = openApiSchema as Record<string, unknown>;
	if (root.properties && typeof root.properties === 'object') {
		const spec = (root.properties as Record<string, unknown>).spec;
		if (spec) return spec;
	}
	return openApiSchema;
}

/** Extract explicit reference edges from a single spec property. */
export function extractExplicitRefEdges(
	prop: SpecProperty,
	options?: { skipDescription?: boolean; sourceKind?: string }
): Array<PartialEdge & { kind: string }> {
	const results: Array<PartialEdge & { kind: string }> = [];
	const seen = new Set<string>();

	const add = (kind: string, partial: PartialEdge) => {
		if (seen.has(kind)) return;
		if (!isResolvableKindPlaceholder(kind)) return;
		seen.add(kind);
		results.push({ kind, ...partial });
	};

	// *Ref field stem / x-editable
	if (isReferenceFieldName(prop.name)) {
		let kind: string | null = null;
		if (prop.description) {
			for (const k of extractKindsFromDescription(prop.description)) {
				kind = k;
				break;
			}
		}
		if (!kind) {
			const stem = stemToKind(prop.name);
			if (stem) kind = stem;
		}
		const editable = prop.node?.['x-editable'];
		if (!kind && typeof editable === 'object' && editable !== null) {
			const editableKind = (editable as Record<string, unknown>).kind;
			if (typeof editableKind === 'string') kind = editableKind;
		}
		if (kind) {
			add(kind, edgeFromRefField(prop.name, prop.description, prop.path, kind));
		}
	}

	const routingSetKind = kindFromRoutingPolicySetField(prop.name);
	if (routingSetKind) {
		add(routingSetKind, {
			relation: 'references',
			fieldPath: prop.path,
			confidence: prop.description ? 94 : 90,
			reason: prop.description
				? `Routing policy set field: ${prop.description.trim().slice(0, 80)} (${prop.path})`
				: `Routing policy set field ${prop.name} → ${routingSetKind} (${prop.path})`,
			pass: 2,
			edgeSource: 'explicit',
			confidenceTier: 2,
			edgeClass: 'hardRef'
		});
	}

	// Description-based refs on spec/status fields (primary EDA pattern)
	if (
		!options?.skipDescription &&
		prop.description &&
		(prop.path.startsWith('spec') || prop.path.startsWith('status'))
	) {
		if (!shouldSkipDescriptionInference(prop.name, prop.path, prop.description)) {
			for (const kind of extractKindsFromDescription(prop.description)) {
				// Avoid duplicating *Ref handling when stem already matched the same kind
				if (isReferenceFieldName(prop.name)) {
					const stemKind = stemToKind(prop.name);
					if (stemKind === kind) continue;
				}
				add(kind, edgeFromDescription(prop.name, prop.description, prop.path, kind));
			}
		}
	}

	const sourceKind = options?.sourceKind ?? '';
	if (prop.description && sourceKind) {
		for (const kind of extractMetaInterfaceKinds(prop.name, prop.description, prop.path, sourceKind)) {
			add(kind, {
				...edgeFromDescription(prop.name, prop.description, prop.path, kind),
				relation: 'bindsTo'
			});
		}
		for (const kind of extractMonitorTargetKinds(prop.name, prop.description, sourceKind)) {
			add(kind, {
				relation: 'bindsTo',
				fieldPath: prop.path,
				confidence: 84,
				reason: `Monitor target binds to ${kind} (${prop.path})`,
				pass: 2,
				edgeSource: 'explicit',
				confidenceTier: 2,
				edgeClass: 'hardRef'
			});
		}
	}

	return results;
}

/** Placeholder — resolved by caller via resolveKindTarget + catalog. */
function isResolvableKindPlaceholder(kind: string): boolean {
	return !GENERIC_KIND_WORDS.has(kind);
}

/** Weak tier-3 description patterns (opt-in). */
export function extractWeakDescriptionEdges(
	prop: SpecProperty
): Array<PartialEdge & { kind: string }> {
	if (!prop.description || (!prop.path.startsWith('spec') && !prop.path.startsWith('status'))) {
		return [];
	}
	if (isReferenceFieldName(prop.name)) return [];
	if (shouldSkipDescriptionInference(prop.name, prop.path, prop.description)) return [];

	const results: Array<PartialEdge & { kind: string }> = [];
	const seen = new Set<string>();

	for (const pattern of WEAK_DESCRIPTION_PATTERNS) {
		for (const match of prop.description.matchAll(pattern.regex)) {
			const kind = match[1];
			if (!kind || GENERIC_KIND_WORDS.has(kind) || seen.has(kind)) continue;
			seen.add(kind);
			const rel =
				typeof pattern.rel === 'function'
					? pattern.rel(kind, prop.description)
					: pattern.rel;
			results.push({
				kind,
				relation: rel,
				fieldPath: prop.path,
				confidence: pattern.confidence,
				reason: `${pattern.reason(kind)} (${prop.path})`,
				pass: 4,
				edgeSource: 'inferred',
				confidenceTier: 3,
				edgeClass: 'intentDependency'
			});
		}
	}

	return results;
}

/**
 * Unified OpenAPI walk: collects every schema field plus annotation hits at each node.
 * Walks spec, status, and metadata subtrees when given a full CRD openAPIV3Schema root.
 */
export function walkOpenApiSchemaFields(openApiSchema: unknown): SchemaFieldHit[] {
	const fields: SchemaFieldHit[] = [];
	if (!openApiSchema || typeof openApiSchema !== 'object') return fields;

	const root = openApiSchema as Record<string, unknown>;
	const subtrees: Array<{ schema: unknown; prefix: string }> = [];

	if (root.properties && typeof root.properties === 'object') {
		const props = root.properties as Record<string, unknown>;
		for (const key of ['spec', 'status', 'metadata'] as const) {
			if (props[key]) subtrees.push({ schema: props[key], prefix: key });
		}
	}
	if (subtrees.length === 0) {
		subtrees.push({ schema: openApiSchema, prefix: 'spec' });
	}

	const annotationHits = extractSchemaReferences(openApiSchema);
	const annotationsByPath = new Map<string, SchemaReferenceHit[]>();
	for (const hit of annotationHits) {
		const list = annotationsByPath.get(hit.fieldPath) ?? [];
		list.push(hit);
		annotationsByPath.set(hit.fieldPath, list);
	}

	const walk = (node: unknown, currentPath: string) => {
		if (!node || typeof node !== 'object') return;
		const n = node as Record<string, unknown>;

		if (n.properties && typeof n.properties === 'object') {
			for (const [key, val] of Object.entries(n.properties as Record<string, unknown>)) {
				const child = val as Record<string, unknown> | undefined;
				const childPath = `${currentPath}.${key}`;
				fields.push({
					name: key,
					description: typeof child?.description === 'string' ? child.description : undefined,
					path: childPath,
					node: child,
					schemaRefs: annotationsByPath.get(childPath) ?? []
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

	for (const { schema, prefix } of subtrees) {
		walk(schema, prefix);
	}

	return fields;
}

export function collectSpecProperties(schema: unknown, path = 'spec'): SpecProperty[] {
	return walkOpenApiSchemaFields(
		path === 'spec' && schema && typeof schema === 'object' && !('properties' in (schema as object))
			? { properties: { spec: schema } }
			: schema
	)
		.filter((f) => f.path.startsWith(path))
		.map(({ name, description, path: p, node }) => ({ name, description, path: p, node }));
}

export function tierFromEdgeSource(edgeSource: EdgeSource, tier?: ConfidenceTier): ConfidenceTier {
	if (tier !== undefined) return tier;
	if (edgeSource === 'catalog') return 1;
	if (edgeSource === 'explicit' || edgeSource === 'semantic') return 2;
	return 3;
}
