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
 * Intent confidence tier for default vs opt-in weak inference.
 * 1 = catalog / explicit *Ref — always show
 * 2 = field-pattern + schema confirmation — show by default
 * 3 = description-only / weak selector — opt-in via "Schema inferred"
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
	/** Aggregated schema paths when multiple inference edges share source→target. */
	fieldPaths?: string[];
	/** Aggregated inference reasons for collapsed visual edges. */
	reasons?: string[];
	/** Distinct relation types when a collapsed edge mixes relations. */
	relations?: LinkRelation[];
	/** Number of inference edges merged into this visual edge. */
	refCount?: number;
};

export type DependencyGraph = {
	nodes: GraphNode[];
	links: GraphLink[];
	releaseFolder: string;
	generatedAt: string;
};

export type BuildProgress = {
	phase: 'manifest' | 'schemas' | 'edges' | 'done';
	current: number;
	total: number;
	message?: string;
};
