import { findLineForPointerInDoc } from '$lib/yaml-validation/parseDocuments';
import { extractDocumentYaml } from './replaceDocument';
import { bundleDocumentStartLine } from './documentLines';
import type { BundleIssue } from './types';

export type YamlMarkerData = {
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
	message: string;
	severity: 'error' | 'warning' | 'info';
	source: string;
};

function issueLineInBundle(yaml: string, issue: BundleIssue): number | undefined {
	if (issue.line && issue.line > 0) return issue.line;

	if (!issue.fieldPath || issue.docIndex === undefined) return undefined;

	const docText = extractDocumentYaml(yaml, issue.docIndex);
	if (!docText) return undefined;

	const pointer = issue.fieldPath.replace(/\./g, '/');
	const lineInDoc = findLineForPointerInDoc(docText, `/${pointer}`);
	if (lineInDoc === undefined) return undefined;
	return bundleDocumentStartLine(yaml, issue.docIndex) + lineInDoc;
}

/** Map bundle validation issues to Monaco marker data. */
export function bundleIssuesToMarkers(yaml: string, issues: BundleIssue[]): YamlMarkerData[] {
	const markers: YamlMarkerData[] = [];

	for (const issue of issues) {
		const line = issueLineInBundle(yaml, issue);
		if (!line || line < 1) continue;

		const lines = yaml.split('\n');
		const lineContent = lines[line - 1] ?? '';
		const endColumn = Math.max(2, lineContent.length + 1);

		markers.push({
			startLineNumber: line,
			startColumn: 1,
			endLineNumber: line,
			endColumn,
			message: issue.message,
			severity: issue.severity,
			source: issue.category
		});
	}

	return markers;
}
