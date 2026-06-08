export type DiffStatus =
	| 'added'
	| 'removed'
	| 'modified'
	| 'unchanged'
	| 'not-in-either'
	| 'error';

export type CrdDiffEntry = {
	name: string;
	kind: string;
	/** Source-side API version (e.g. v1, v2, v1alpha1). */
	version: string;
	/** Target-side API version when it differs from {@link version}. */
	targetVersion?: string;
	status: DiffStatus;
	hasDiff: boolean;
	details: string[];
};

export type BulkDiffReport = {
	sourceRelease: string;
	/** When comparing all version pairs, set to "all". */
	sourceVersion: string;
	targetRelease: string;
	targetVersion: string;
	generatedAt: string;
	crds: CrdDiffEntry[];
};
