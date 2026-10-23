import { findLineForYamlFieldPath } from '$lib/yaml-validation/yamlFieldPath';
import { detectBundleConflicts } from './bundleConflicts';
import type { BundleIssue, BundleResource } from './types';

/** EDA-specific manifest rules not covered by CRD schema or Kubernetes validation. */
export function validateEdaRules(resources: BundleResource[]): BundleIssue[] {
	const issues: BundleIssue[] = [];

	// Two documents that create the same resource: the later one silently replaces the earlier.
	for (const conflict of detectBundleConflicts(resources)) {
		for (const docIndex of conflict.docIndexes.slice(1)) {
			const res = resources.find((r) => r.docIndex + 1 === docIndex);
			const rel = res ? findLineForYamlFieldPath(res.doc.rawText, 'metadata.name') : undefined;
			issues.push({
				id: `eda-${conflict.type}-${docIndex}`,
				severity: conflict.severity,
				category: 'eda',
				rule: conflict.type,
				message: conflict.message,
				resourceName: conflict.name,
				resourceKind: conflict.kind,
				docIndex,
				line: res && rel !== undefined ? res.doc.startLine + rel + 1 : undefined,
				fieldPath: 'metadata.name'
			});
		}
	}

	return issues;
}
