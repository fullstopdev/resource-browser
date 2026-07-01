export type FieldChangeType =
	| 'type_change'
	| 'added'
	| 'removed'
	| 'enum_added'
	| 'enum_removed'
	| 'enum_changed'
	| 'default_changed'
	| 'required_added'
	| 'optional_added';

export type NewResource = {
	kind: string;
	apiVersion: string;
	description: string;
	group?: string;
	crdName?: string;
};

export type RemovedResource = {
	kind: string;
	apiVersion: string;
	reason: string;
};

export type FieldChange = {
	field: string;
	changeType: FieldChangeType;
	before: string;
	after: string;
	networkBehavior: string;
};

export type ModifiedResource = {
	kind: string;
	apiVersion?: string;
	changes: FieldChange[];
};

export type DeprecatedApiVersion = {
	version: string;
	apiVersion: string;
	removedInVersion?: string;
	newInRelease: boolean;
};

export type DeprecatedItem = {
	kind: string;
	group: string;
	crdName: string;
	deprecatedVersions: DeprecatedApiVersion[];
	recommendedApiVersion?: string;
	/** Stable apiVersion introduced in the target release (e.g. v1 replacing v1alpha1). */
	newlyPromotedApiVersion?: string;
	migrationPath: string;
};

export type ReleaseNotes = {
	newResources: NewResource[];
	removedResources: RemovedResource[];
	modifiedResources: ModifiedResource[];
	deprecated: DeprecatedItem[];
};

export type ReleaseNotesSummary = {
	added: number;
	removed: number;
	modified: number;
	deprecated: number;
	unchanged: number;
	specChanges: number;
};

export type ReleaseNotesEntry = {
	toVer: string;
	fromVer: string;
	notes: ReleaseNotes;
	summary?: ReleaseNotesSummary;
	timestamp: number;
	source: 'comparison' | 'mock';
};

export type ReleaseTimelineItem = {
	version: string;
	label: string;
	tag?: 'latest';
};
