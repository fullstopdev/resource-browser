import type { DependencyGraph, GraphLink } from '$lib/dependency-map/types';
import { findManifestEntry } from '$lib/manifest/lookup';
import { findLineForYamlFieldPath } from '$lib/yaml-validation/yamlFieldPath';
import type { ManifestEntry } from '$lib/yaml-validation/types';
import type { BundleIssue, BundleResource } from './types';

/** Only well-supported name references: selectors (appliesTo / bindsTo) don't name a resource. */
const MIN_CONFIDENCE = 90;

function isNameReference(link: GraphLink): boolean {
	return (
		link.rel === 'references' &&
		link.edgeClass === 'hardRef' &&
		(link.confidence ?? 0) >= MIN_CONFIDENCE &&
		typeof link.field === 'string' &&
		link.field.startsWith('spec.')
	);
}

/** Values at a graph field path such as `spec.members[].interface`, with their instance paths. */
function valuesAtField(data: unknown, field: string): Array<{ value: string; path: string }> {
	const out: Array<{ value: string; path: string }> = [];
	const segments = field.split('.');
	const walk = (node: unknown, i: number, at: string) => {
		if (node === undefined || node === null) return;
		if (i === segments.length) {
			if (typeof node === 'string' && node.trim()) out.push({ value: node.trim(), path: at });
			else if (Array.isArray(node)) {
				node.forEach(
					(v, n) =>
						typeof v === 'string' && v.trim() && out.push({ value: v.trim(), path: `${at}.${n}` })
				);
			}
			return;
		}
		const segment = segments[i]!;
		const isList = segment.endsWith('[]');
		const key = isList ? segment.slice(0, -2) : segment;
		const next = (node as Record<string, unknown>)[key];
		const nextPath = at ? `${at}.${key}` : key;
		if (isList) {
			if (Array.isArray(next)) next.forEach((item, n) => walk(item, i + 1, `${nextPath}.${n}`));
		} else if (typeof node === 'object' && !Array.isArray(node)) {
			walk(next, i + 1, nextPath);
		}
	};
	walk(data, 0, '');
	return out;
}

/**
 * Name references to resources that aren't defined in the bundle, as Info notes: the bundle may be
 * fine (the target can already exist in the cluster), but it's worth knowing before applying it.
 * Uses the release's precomputed dependency graph (which fields reference which CRD).
 */
export function checkBundleReferences(
	resources: BundleResource[],
	manifest: ManifestEntry[],
	graph: DependencyGraph | null
): BundleIssue[] {
	if (!graph?.links?.length) return [];
	const byCrd = new Map<string, GraphLink[]>();
	for (const link of graph.links) {
		if (!isNameReference(link)) continue;
		byCrd.set(link.source, [...(byCrd.get(link.source) ?? []), link]);
	}
	const entryByName = new Map(manifest.map((e) => [e.name, e]));
	const issues: BundleIssue[] = [];
	const seen = new Set<string>();

	for (const res of resources) {
		if (!res.kind || !res.group) continue;
		const crd = findManifestEntry(manifest, res.kind, res.group)?.name;
		const links = crd ? byCrd.get(crd) : undefined;
		if (!links) continue;

		for (const link of links) {
			const target = entryByName.get(link.target);
			if (!target?.kind) continue;
			for (const { value, path } of valuesAtField(res.data, link.field!)) {
				const defined = resources.some(
					(other) =>
						other.kind === target.kind &&
						other.group === target.group &&
						other.name === value &&
						(target.scope === 'Cluster' ||
							(other.namespace || 'default') === (res.namespace || 'default'))
				);
				const key = `${res.docIndex}|${path}|${value}`;
				if (defined || seen.has(key)) continue;
				seen.add(key);
				const rel = findLineForYamlFieldPath(res.doc.rawText, path);
				const where =
					target.scope === 'Cluster' ? '' : ` in namespace "${res.namespace || 'default'}"`;
				issues.push({
					id: `ref-${issues.length + 1}`,
					severity: 'info',
					category: 'eda',
					rule: 'missing-reference',
					message: `${path} references ${target.kind} "${value}", which isn't in this bundle — make sure it already exists${where}`,
					resourceName: res.name,
					resourceKind: res.kind,
					docIndex: res.docIndex + 1,
					line: rel !== undefined ? res.doc.startLine + rel + 1 : undefined,
					fieldPath: path
				});
			}
		}
	}
	return issues;
}
