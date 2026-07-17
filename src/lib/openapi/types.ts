export interface OpenApiManifestEntry {
	id: string;
	title: string;
	group: string;
	apiVersion: string;
	file: string;
	pathCount: number;
	tags: string[];
}

export interface OpenApiRelease {
	name: string;
	label: string;
	folder: string;
	default?: boolean;
}

export interface OpenApiReleasesConfig {
	releases: OpenApiRelease[];
}

export interface OpenApiSpecDocument {
	openapi?: string;
	info?: { title?: string; version?: string; description?: string };
	paths?: Record<string, Record<string, OpenApiOperation>>;
	components?: { schemas?: Record<string, unknown> };
	tags?: { name: string; description?: string }[];
}

export interface OpenApiOperation {
	operationId?: string;
	summary?: string;
	description?: string;
	tags?: string[];
	parameters?: unknown[];
	requestBody?: unknown;
	responses?: Record<string, unknown>;
}

export type OpenApiDiffStatus =
	| 'added'
	| 'removed'
	| 'modified'
	| 'api_version'
	| 'unchanged'
	| 'shared'
	| 'error';

export interface OpenApiPathChange {
	path: string;
	method: string;
	operationId?: string;
	changeType: 'added' | 'removed' | 'modified';
	details: string[];
}

export interface OpenApiSchemaSummary {
	added: number;
	removed: number;
	modified: number;
	/** Schemas equal after version-token normalize — version bump only. */
	apiVersion: number;
}

export interface OpenApiDiffEntry {
	/** Target-side spec id (or sole id for added/removed). */
	specId: string;
	/**
	 * Source-side spec id when it differs from `specId` (API version bump,
	 * e.g. `…/v1alpha1` → `…/v1`).
	 */
	sourceSpecId?: string;
	title: string;
	group: string;
	status: OpenApiDiffStatus;
	pathChanges: OpenApiPathChange[];
	schemaChanges: string[];
	schemaSummary?: OpenApiSchemaSummary;
	/** True after path/schema details were computed from full specs. */
	detailsLoaded?: boolean;
	sourcePathCount?: number;
	targetPathCount?: number;
	sourceFile?: string;
	targetFile?: string;
	error?: string;
}

export interface OpenApiBulkDiffReport {
	sourceRelease: string;
	targetRelease: string;
	entries: OpenApiDiffEntry[];
	summary: {
		added: number;
		removed: number;
		modified: number;
		apiVersion: number;
		unchanged: number;
		shared: number;
		error: number;
	};
}
