import { applySuggestedFix } from './applyIssueFix';
import { firstParseIssueForInput } from './parser';
import {
	extractDocumentYaml,
	inferManifestIdentity,
	replaceDocumentInBundle,
	validateAiFixApply
} from './replaceDocument';
import { formatYamlBundle, type FixReport, type FormatYamlOptions } from './formatYaml';
import type { BundleIssue } from './types';

export type AiFixResult = {
	fixedYaml?: string;
	fixable?: boolean;
	error?: string;
	fallbackReason?: 'quota' | 'llm_error';
};

export type AiFixFn = (params: {
	docYaml: string;
	issue: BundleIssue;
	kind?: string;
	group?: string;
}) => Promise<AiFixResult>;

export type FixAllBundleOptions = FormatYamlOptions & {
	/** When set, AI is tried for errors without a deterministic suggestedFix. */
	aiFix?: AiFixFn;
	resolveDocIndex?: (issue: BundleIssue) => number;
	resolveIdentity?: (
		issue: BundleIssue,
		docYaml: string
	) => { kind?: string; group?: string };
};

export type FixAllResult = {
	ok: boolean;
	yaml: string;
	message?: string;
	parseIssue?: BundleIssue;
	formatFixes: FixReport[];
	suggestedFixCount: number;
	aiFixCount: number;
	aiUnavailable: boolean;
	aiUnavailableReason?: string;
	remainingErrors: number;
	remainingWarnings: number;
};

/** True when Workers AI cannot run (quota, token limit, or service unavailable). */
export function isAiUnavailableResult(result: AiFixResult): boolean {
	if (result.fallbackReason === 'quota') return true;
	const msg = (result.error ?? '').toLowerCase();
	return (
		/context length|maximum context|token limit|too many tokens|prompt is too long|daily limit|neuron|workers ai is not available|workers ai daily limit|temporarily unavailable/.test(
			msg
		)
	);
}

function defaultDocIndex(issue: BundleIssue): number {
	return issue.docIndex ?? 1;
}

function defaultIdentity(
	issue: BundleIssue,
	docYaml: string
): { kind?: string; group?: string } {
	return {
		kind: issue.resourceKind ?? inferManifestIdentity(docYaml).kind,
		group: inferManifestIdentity(docYaml).group
	};
}

async function applyAiFixes(
	yaml: string,
	issues: BundleIssue[],
	options?: FixAllBundleOptions
): Promise<{
	yaml: string;
	aiFixCount: number;
	aiUnavailable: boolean;
	aiUnavailableReason?: string;
}> {
	if (!options?.aiFix) {
		return { yaml, aiFixCount: 0, aiUnavailable: false };
	}

	const resolveDocIndex = options.resolveDocIndex ?? defaultDocIndex;
	const resolveIdentity = options.resolveIdentity ?? defaultIdentity;

	const aiTargets = issues.filter(
		(issue) => issue.severity === 'error' && !issue.suggestedFix
	);

	let aiFixCount = 0;
	let aiUnavailable = false;
	let aiUnavailableReason: string | undefined;
	let currentYaml = yaml;

	for (const issue of aiTargets) {
		if (aiUnavailable) break;

		const docIndex = resolveDocIndex(issue);
		const docYaml = extractDocumentYaml(currentYaml, docIndex);
		if (!docYaml) continue;

		const { kind, group } = resolveIdentity(issue, docYaml);
		const result = await options.aiFix({
			docYaml,
			issue,
			kind,
			group
		});

		if (isAiUnavailableResult(result)) {
			aiUnavailable = true;
			aiUnavailableReason = result.error ?? 'Workers AI unavailable';
			break;
		}

		if (!result.fixable || !result.fixedYaml) continue;

		const guard = validateAiFixApply(docYaml, result.fixedYaml, issue);
		if (!guard.ok) continue;

		const updated = replaceDocumentInBundle(currentYaml, docIndex, result.fixedYaml);
		if (!updated) continue;

		currentYaml = updated;
		aiFixCount += 1;
	}

	return { yaml: currentYaml, aiFixCount, aiUnavailable, aiUnavailableReason };
}

/** Apply AI fixes (when available), manifest format, and deterministic per-issue fixes. */
export async function fixAllBundle(
	yamlInput: string,
	issues: BundleIssue[],
	options?: FixAllBundleOptions
): Promise<FixAllResult> {
	const parseIssue = firstParseIssueForInput(yamlInput);
	const allIssues = parseIssue
		? [parseIssue, ...issues.filter((i) => i.id !== parseIssue.id)]
		: [...issues];

	let yaml = yamlInput;
	const aiResult = await applyAiFixes(yaml, allIssues, options);
	yaml = aiResult.yaml;

	const stillParseIssue = firstParseIssueForInput(yaml);
	if (stillParseIssue) {
		return {
			ok: false,
			yaml: yamlInput,
			message:
				aiResult.aiFixCount > 0
					? 'YAML still has syntax errors after AI fix.'
					: 'YAML syntax must be fixed before bulk fix can run.',
			parseIssue: stillParseIssue,
			formatFixes: [],
			suggestedFixCount: 0,
			aiFixCount: aiResult.aiFixCount,
			aiUnavailable: aiResult.aiUnavailable,
			aiUnavailableReason: aiResult.aiUnavailableReason,
			remainingErrors: allIssues.filter((i) => i.severity === 'error').length,
			remainingWarnings: allIssues.filter((i) => i.severity === 'warning').length
		};
	}

	let formatFixes: FixReport[] = [];
	const formatted = await formatYamlBundle(yaml, options);
	if (formatted.ok) {
		yaml = formatted.formatted;
		formatFixes = formatted.fixes;
	}

	const fixable = allIssues.filter((issue) => issue.suggestedFix);
	let suggestedFixCount = 0;
	let fixedErrors = 0;
	let fixedWarnings = 0;

	for (const issue of fixable) {
		const updated = applySuggestedFix(yaml, issue);
		if (updated) {
			yaml = updated;
			suggestedFixCount += 1;
			if (issue.severity === 'error') fixedErrors += 1;
			if (issue.severity === 'warning') fixedWarnings += 1;
		}
	}

	const totalErrors = allIssues.filter((i) => i.severity === 'error').length;
	const totalWarnings = allIssues.filter((i) => i.severity === 'warning').length;

	return {
		ok: true,
		yaml,
		formatFixes,
		suggestedFixCount,
		aiFixCount: aiResult.aiFixCount,
		aiUnavailable: aiResult.aiUnavailable,
		aiUnavailableReason: aiResult.aiUnavailableReason,
		remainingErrors: Math.max(0, totalErrors - fixedErrors - aiResult.aiFixCount),
		remainingWarnings: Math.max(0, totalWarnings - fixedWarnings)
	};
}
