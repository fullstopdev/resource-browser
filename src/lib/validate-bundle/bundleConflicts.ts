import type { BundleResource } from './types';

export type BundleConflictType = 'duplicate-resource' | 'apiversion-mismatch';

export type BundleConflict = {
	type: BundleConflictType;
	severity: 'error' | 'warning';
	message: string;
	docIndexes: number[];
	kind?: string;
	name?: string;
	namespace?: string;
};

function resourceKey(kind: string, namespace: string, name: string): string {
	return `${namespace}/${kind}/${name}`;
}

/** Detect duplicate resources and apiVersion mismatches across a bundle. */
export function detectBundleConflicts(resources: BundleResource[]): BundleConflict[] {
	const conflicts: BundleConflict[] = [];
	const byKey = new Map<string, BundleResource[]>();

	for (const resource of resources) {
		if (!resource.kind || !resource.name) continue;
		const key = resourceKey(resource.kind, resource.namespace || 'default', resource.name);
		const bucket = byKey.get(key) ?? [];
		bucket.push(resource);
		byKey.set(key, bucket);
	}

	for (const [, group] of byKey) {
		if (group.length < 2) continue;

		const docIndexes = group.map((r) => r.docIndex + 1);
		const first = group[0]!;
		conflicts.push({
			type: 'duplicate-resource',
			severity: 'error',
			message: `Duplicate ${first.kind} "${first.name}" in namespace "${first.namespace}" (documents ${docIndexes.join(', ')})`,
			docIndexes,
			kind: first.kind,
			name: first.name,
			namespace: first.namespace
		});

		const apiVersions = [...new Set(group.map((r) => r.apiVersion).filter(Boolean))];
		if (apiVersions.length > 1) {
			conflicts.push({
				type: 'apiversion-mismatch',
				severity: 'warning',
				message: `${first.kind} "${first.name}" uses multiple apiVersions: ${apiVersions.join(', ')}`,
				docIndexes,
				kind: first.kind,
				name: first.name,
				namespace: first.namespace
			});
		}
	}

	return conflicts.sort((a, b) => a.docIndexes[0]! - b.docIndexes[0]!);
}
