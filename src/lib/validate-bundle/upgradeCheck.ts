import type { BundleIssue } from './types';

export type UpgradeReport = {
	from: string;
	to: string;
	/** Errors on the target release that the current release doesn't report. */
	breaking: BundleIssue[];
	/** Warnings that only appear on the target release (deprecations, unknown fields, …). */
	newWarnings: BundleIssue[];
	/** Errors and warnings that disappear on the target release. */
	resolved: BundleIssue[];
};

/**
 * Same issue on two releases? Messages mention the release and line/column, so compare a
 * normalized shape: document, severity, field and message without those details.
 */
function issueShape(issue: BundleIssue): string {
	const message = issue.message
		.replace(/\s*\(Line \d+(?:, column \d+)?\)/gi, '')
		.replace(/\b(?:in )?release\s+(?:EDA\s+)?\d+\.\d+\.\d+/gi, '')
		.replace(/\bEDA\s+\d+\.\d+\.\d+/gi, '')
		.replace(/\s+/g, ' ')
		.trim();
	return [issue.docIndex ?? 0, issue.severity, issue.fieldPath ?? '', message].join('|');
}

/** Compare one bundle's validation on the current release and on an upgrade target. */
export function compareReleaseValidation(
	current: BundleIssue[],
	target: BundleIssue[],
	labels: { from: string; to: string }
): UpgradeReport {
	const relevant = (i: BundleIssue) => i.severity === 'error' || i.severity === 'warning';
	const currentShapes = new Set(current.filter(relevant).map(issueShape));
	const targetShapes = new Set(target.filter(relevant).map(issueShape));
	const onlyOnTarget = target.filter((i) => relevant(i) && !currentShapes.has(issueShape(i)));

	return {
		from: labels.from,
		to: labels.to,
		breaking: onlyOnTarget.filter((i) => i.severity === 'error'),
		newWarnings: onlyOnTarget.filter((i) => i.severity === 'warning'),
		resolved: current.filter((i) => relevant(i) && !targetShapes.has(issueShape(i)))
	};
}
