/** Raw edge before merge/dedup — produced by the inference pipeline. */
export type EdgeRecord = {
	source: string;
	target: string;
	relation: LinkRelation;
	fieldPath: string;
	confidence: number;
	reason: string;
	pass: InferencePass;
	edgeSource: EdgeSource;
	confidenceTier: ConfidenceTier;
	edgeClass: EdgeClass;
	/** API version(s) that contributed this edge when merging multi-version schemas. */
	apiVersions?: string[];
	/** Other catalog IDs that matched kind resolution (ambiguous). */
	resolvedCandidates?: string[];
};

/** Inference pipeline pass (1 = catalog … 4 = description-only). */
export type InferencePass = 1 | 2 | 3 | 4;

export type NodeType = 'config' | 'state' | 'other';

export type GraphNode = {
	id: string;
	kind: string;
	group: string;
	type: NodeType;
	version: string;
	description?: string;
	shortName: string;
};

export type LinkRelation =
	| 'observes'
	| 'deploys'
	| 'references'
	| 'member'
	| 'memberOf'
	| 'bindsTo'
	| 'appliesTo'
	| 'orchestrates'
	| 'extends';

/** How the dependency edge was derived (catalog pairing vs schema field vs loose inference). */
export type EdgeSource = 'catalog' | 'explicit' | 'semantic' | 'inferred';

/**
 * Evidence class: schema-hard reference vs operational intent dependency.
 * hardRef = explicit field/annotation naming another CRD; intentDependency = catalog/semantic/inferred.
 */
export type EdgeClass = 'hardRef' | 'intentDependency';

export function edgeClassFromSource(edgeSource: EdgeSource): EdgeClass {
	return edgeSource === 'explicit' ? 'hardRef' : 'intentDependency';
}

/**
 * Intent confidence tier for default vs opt-in weak inference.
 * 1 = schema annotations (x-references, GVK, kind+apiVersion) and catalog pairing — always show
 * 2 = description-based refs, *Ref stems, semantic field patterns — show by default (strict)
 * 3 = weak description-only inference (hidden from map UI)
 */
export type ConfidenceTier = 1 | 2 | 3;

export type GraphLink = {
	id: string;
	source: string;
	target: string;
	rel: LinkRelation;
	field?: string;
	reason?: string;
	confidence?: number;
	edgeSource?: EdgeSource;
	confidenceTier?: ConfidenceTier;
	edgeClass?: EdgeClass;
	/** Distinct evidence classes when a collapsed edge mixes hard refs and intent deps. */
	edgeClasses?: EdgeClass[];
	/** Aggregated schema paths when multiple inference edges share source→target. */
	fieldPaths?: string[];
	/** Aggregated inference reasons for collapsed visual edges. */
	reasons?: string[];
	/** Distinct relation types when a collapsed edge mixes relations. */
	relations?: LinkRelation[];
	/** Number of inference edges merged into this visual edge. */
	refCount?: number;
	/** API versions that contributed merged edges. */
	apiVersions?: string[];
	/** Ambiguous resolution candidates for tooltip display. */
	resolvedCandidates?: string[];
};

export type DependencyGraph = {
	nodes: GraphNode[];
	links: GraphLink[];
	releaseFolder: string;
	generatedAt: string;
	/** Precomputed graph metadata when loaded from static cache. */
	precomputed?: boolean;
	/** Corpus audit metrics from last graph build (optional). */
	coverage?: CorpusCoverage;
	/** Per-CRD reference-field coverage (excludes skipped meta fields). */
	crdCoverage?: Record<string, { matched: number; total: number }>;
};

export type AuditMetric = {
	matched: number;
	total: number;
	rate: number;
};

export type CorpusCoverage = {
	/** Legacy flat fields — mirror referenceDescriptions for older consumers. */
	matched: number;
	total: number;
	rate: number;
	referenceDescriptions: AuditMetric;
	refFieldStems: AuditMetric;
	metaInterface: AuditMetric;
	selectorIntent: AuditMetric;
	/** intentDependency edge counts per source CRD, grouped by LinkRelation. */
	intentEdgesByCrd: Record<string, Partial<Record<LinkRelation, number>>>;
};

export type BuildProgress = {
	phase: 'manifest' | 'schemas' | 'edges' | 'done';
	current: number;
	total: number;
	message?: string;
};
