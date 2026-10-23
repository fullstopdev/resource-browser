/** Lightweight manifest entry used for search, validation, and listing. */
export type ManifestResource = {
	name: string;
	kind?: string;
	group?: string;
	versions?: { name: string; deprecated?: boolean; appVersion?: string }[];
	/** From the release's OpenAPI paths (scripts/build-crd-scopes.ts); absent when unknown. */
	scope?: 'Namespaced' | 'Cluster';
};
