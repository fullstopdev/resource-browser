import { applySuggestedFix, addFieldParentPath } from './applyIssueFix';
import { firstParseIssueForInput } from './parser';
import { inferIssueKind } from './fixIssueContext';
import {
	extractDocumentYaml,
	inferManifestIdentity,
	replaceDocumentInBundle,
	validateAiFixApply,
	validateAiMigrationApply
} from './replaceDocument';
import { formatYamlBundle, applySchemaValueFixes, type FixReport, type FormatYamlOptions } from './formatYaml';
import { enrichIssuesWithSuggestedFix } from './schemaSuggestedFix';
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
	/** When set, request a single batched migration fix for all listed issues in this document. */
	issues?: BundleIssue[];
	kind?: string;
	group?: string;
}) => Promise<AiFixResult>;

export type FixAllBundleOptions = FormatYamlOptions & {
	/** When set, AI is tried for issues not resolved by deterministic fixes. */
	aiFix?: AiFixFn;
	/** Re-run validation after deterministic fixes; AI only sees remaining issues. */
	revalidateIssues?: (yaml: string) => Promise<BundleIssue[]>;
	resolveDocIndex?: (issue: BundleIssue) => number;
	resolveIdentity?: (
		issue: BundleIssue,
		docYaml: string
	) => { kind?: string; group?: string };
	/** When true, run layout/format pass (sort keys, spacing). Default false — fixes errors only. */
	includeLayoutFormat?: boolean;
	/** When true, invoke AI for syntax and remaining issues (requires aiFix). Default false. */
	includeAi?: boolean;
};

export type FixAllChange = {
	issueId?: string;
	source: 'format' | 'suggested' | 'ai';
	label: string;
	docIndex?: number;
};

export type FixAllResult = {
	ok: boolean;
	yaml: string;
	beforeYaml: string;
	afterYaml: string;
	changes: FixAllChange[];
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

const MAX_DETERMINISTIC_PASSES = 3;
const MAX_AI_PASSES = 5;
const MAX_AI_FIXES_PER_DOC = 12;

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

function formatFixChangeLabel(fix: FixReport): string {
	const change = `${String(fix.from)} → ${String(fix.to)}`;
	switch (fix.kind) {
		case 'apiVersionUpgrade':
			return `Upgraded apiVersion: ${change}`;
		case 'kindCase':
			return `Fixed kind case: ${change}`;
		case 'apiVersionCase':
			return `Fixed apiVersion case: ${change}`;
		case 'dnsName':
			return `Fixed DNS name: ${change}`;
		case 'enumCase':
			return `Fixed enum case: ${change}`;
		case 'booleanCoercion':
			return `Fixed boolean: ${change}`;
		case 'stringCoercion':
			return `Coerced string: ${change}`;
	}
}

function suggestedFixChangeLabel(issue: BundleIssue): string {
	const fix = issue.suggestedFix;
	if (!fix) return issue.message;
	if (fix.action === 'renameKey') {
		return `Renamed ${fix.field} → ${fix.value}`;
	}
	if (fix.action === 'relocateField') {
		return `Relocated ${fix.field} → ${fix.value}`;
	}
	return `Set ${fix.field} to ${fix.value}`;
}

function formatChangesFromFixes(fixes: FixReport[]): FixAllChange[] {
	return fixes.map((fix) => ({
		source: 'format' as const,
		label: formatFixChangeLabel(fix),
		docIndex: fix.docIndex
	}));
}

async function tryParseAiFix(
	yaml: string,
	parseIssue: BundleIssue,
	options?: FixAllBundleOptions
): Promise<{
	yaml: string;
	fixed: boolean;
	aiUnavailable: boolean;
	aiUnavailableReason?: string;
}> {
	if (!options?.aiFix) {
		return { yaml, fixed: false, aiUnavailable: false };
	}

	const resolveDocIndex = options.resolveDocIndex ?? defaultDocIndex;
	const resolveIdentity = options.resolveIdentity ?? defaultIdentity;
	const docIndex = resolveDocIndex(parseIssue);
	const docYaml = extractDocumentYaml(yaml, docIndex);
	if (!docYaml) return { yaml, fixed: false, aiUnavailable: false };

	const { kind, group } = resolveIdentity(parseIssue, docYaml);
	const result = await options.aiFix({ docYaml, issue: parseIssue, kind, group });

	if (isAiUnavailableResult(result)) {
		return {
			yaml,
			fixed: false,
			aiUnavailable: true,
			aiUnavailableReason: result.error ?? 'Workers AI unavailable'
		};
	}

	if (!result.fixable || !result.fixedYaml) {
		return { yaml, fixed: false, aiUnavailable: false };
	}

	const guard = validateAiFixApply(docYaml, result.fixedYaml, parseIssue);
	if (!guard.ok) return { yaml, fixed: false, aiUnavailable: false };

	const updated = replaceDocumentInBundle(yaml, docIndex, result.fixedYaml);
	if (!updated) return { yaml, fixed: false, aiUnavailable: false };

	return { yaml: updated, fixed: true, aiUnavailable: false };
}

async function applyAiFixes(
	yaml: string,
	issues: BundleIssue[],
	options?: FixAllBundleOptions
): Promise<{
	yaml: string;
	aiFixCount: number;
	changes: FixAllChange[];
	aiUnavailable: boolean;
	aiUnavailableReason?: string;
}> {
	if (!options?.aiFix || issues.length === 0) {
		return { yaml, aiFixCount: 0, changes: [], aiUnavailable: false };
	}

	const resolveDocIndex = options.resolveDocIndex ?? defaultDocIndex;
	const resolveIdentity = options.resolveIdentity ?? defaultIdentity;

	let aiFixCount = 0;
	const changes: FixAllChange[] = [];
	let aiUnavailable = false;
	let aiUnavailableReason: string | undefined;
	let currentYaml = yaml;

	const byDoc = groupIssuesByDoc(issues, resolveDocIndex);

	for (const [docIndex, docIssues] of byDoc) {
		if (aiUnavailable) break;

		const docYaml = extractDocumentYaml(currentYaml, docIndex);
		if (!docYaml) continue;

		const { kind, group } = resolveIdentity(docIssues[0]!, docYaml);
		let remaining = [...docIssues];
		let fixesThisDoc = 0;

		while (
			remaining.length > 0 &&
			!aiUnavailable &&
			fixesThisDoc < MAX_AI_FIXES_PER_DOC
		) {
			const currentDocYaml = extractDocumentYaml(currentYaml, docIndex) ?? docYaml;

			if (needsMigrationBatch(remaining)) {
				const result = await options.aiFix({
					docYaml: currentDocYaml,
					issue: remaining[0]!,
					issues: remaining,
					kind,
					group
				});

				if (isAiUnavailableResult(result)) {
					aiUnavailable = true;
					aiUnavailableReason = result.error ?? 'Workers AI unavailable';
					break;
				}

				if (!result.fixable || !result.fixedYaml) {
					remaining = remaining.slice(1);
					continue;
				}

				const guard = validateAiMigrationApply(currentDocYaml, result.fixedYaml, remaining);
				if (!guard.ok) {
					remaining = remaining.slice(1);
					continue;
				}

				const updated = replaceDocumentInBundle(currentYaml, docIndex, result.fixedYaml);
				if (!updated) {
					remaining = remaining.slice(1);
					continue;
				}

				currentYaml = updated;
				aiFixCount += 1;
				fixesThisDoc += 1;
				changes.push({
					source: 'ai',
					label: `AI migration: ${remaining.length} issue(s)`,
					docIndex
				});

				if (options?.revalidateIssues) {
					const fresh = await options.revalidateIssues(currentYaml);
					remaining = issuesNeedingAi(fresh).filter(
						(i) => (i.docIndex ?? 1) === docIndex
					);
				} else {
					remaining = [];
				}
				continue;
			}

			const issue = remaining[0]!;
			const result = await options.aiFix({
				docYaml: currentDocYaml,
				issue,
				kind,
				group
			});

			if (isAiUnavailableResult(result)) {
				aiUnavailable = true;
				aiUnavailableReason = result.error ?? 'Workers AI unavailable';
				break;
			}

			if (!result.fixable || !result.fixedYaml) {
				remaining = remaining.slice(1);
				continue;
			}

			const guard = validateAiFixApply(currentDocYaml, result.fixedYaml, issue);
			if (!guard.ok) {
				remaining = remaining.slice(1);
				continue;
			}

			const updated = replaceDocumentInBundle(currentYaml, docIndex, result.fixedYaml);
			if (!updated) {
				remaining = remaining.slice(1);
				continue;
			}

			currentYaml = updated;
			aiFixCount += 1;
			fixesThisDoc += 1;
			changes.push({
				issueId: issue.id,
				source: 'ai',
				label: `AI: ${issue.message.slice(0, 80)}${issue.message.length > 80 ? '…' : ''}`,
				docIndex
			});

			if (options?.revalidateIssues) {
				const fresh = await options.revalidateIssues(currentYaml);
				remaining = issuesNeedingAi(fresh).filter(
					(i) => (i.docIndex ?? 1) === docIndex
				);
			} else {
				remaining = remaining.slice(1);
			}
		}
	}

	return { yaml: currentYaml, aiFixCount, changes, aiUnavailable, aiUnavailableReason };
}

function suggestedFixPriority(issue: BundleIssue): number {
	const action = issue.suggestedFix?.action;
	if (action === 'renameKey' || action === 'relocateField') return 0;
	if (action === 'setValue') return 1;
	if (action === 'addField') return 2;
	return 3;
}

function isStructuralAiIssue(issue: BundleIssue): boolean {
	const kind = inferIssueKind(issue);
	if (kind === 'type') return true;
	if (kind === 'unknownField' && issue.suggestedFix?.action !== 'renameKey') return true;
	return false;
}

function needsMigrationBatch(issues: BundleIssue[]): boolean {
	if (issues.some((i) => /deprecated for kind/i.test(i.message))) return true;
	return issues.filter(isStructuralAiIssue).length >= 2;
}

function groupIssuesByDoc(
	issues: BundleIssue[],
	resolveDocIndex: (issue: BundleIssue) => number
): Map<number, BundleIssue[]> {
	const byDoc = new Map<number, BundleIssue[]>();
	for (const issue of issues) {
		const docIndex = resolveDocIndex(issue);
		const list = byDoc.get(docIndex) ?? [];
		list.push(issue);
		byDoc.set(docIndex, list);
	}
	return byDoc;
}

async function applyDeterministicPass(
	yaml: string,
	issues: BundleIssue[],
	options: FixAllBundleOptions | undefined,
	runFormatRequested: boolean
): Promise<{
	yaml: string;
	formatFixes: FixReport[];
	suggestedFixCount: number;
	changes: FixAllChange[];
	fixedErrors: number;
	fixedWarnings: number;
	fixedIssueIds: Set<string>;
}> {
	const changes: FixAllChange[] = [];
	let formatFixes: FixReport[] = [];
	let currentYaml = yaml;

	if (
		options?.manifest?.length &&
		options.releaseFolder &&
		!firstParseIssueForInput(currentYaml)
	) {
		const valueFixed = await applySchemaValueFixes(currentYaml, options);
		if (valueFixed.ok && valueFixed.fixes.length > 0) {
			currentYaml = valueFixed.formatted;
			formatFixes = valueFixed.fixes;
			changes.push(...formatChangesFromFixes(valueFixed.fixes));
		}
	}

	const runFormat = runFormatRequested && !firstParseIssueForInput(currentYaml);
	if (runFormat) {
		const formatted = await formatYamlBundle(currentYaml, options);
		if (formatted.ok) {
			currentYaml = formatted.formatted;
			formatFixes = [...formatFixes, ...formatted.fixes];
			changes.push(...formatChangesFromFixes(formatted.fixes));
		}
	}

	let suggestedFixCount = 0;
	let fixedErrors = 0;
	let fixedWarnings = 0;
	const fixedIssueIds = new Set<string>();

	let progress = true;
	const appliedAddFields = new Set<string>();
	while (progress) {
		progress = false;
		const fixableIssues = issues
			.filter((issue) => issue.suggestedFix && !fixedIssueIds.has(issue.id))
			.sort((a, b) => suggestedFixPriority(a) - suggestedFixPriority(b));
		for (const issue of fixableIssues) {
			if (!issue.suggestedFix) continue;
			if (issue.suggestedFix.action === 'addField') {
				const parentPath = addFieldParentPath(issue, issue.suggestedFix);
				const dedupeKey = `${issue.docIndex ?? 1}:${parentPath ?? ''}:${issue.suggestedFix.field}`;
				if (appliedAddFields.has(dedupeKey)) {
					fixedIssueIds.add(issue.id);
					continue;
				}
			}
			const updated = applySuggestedFix(currentYaml, issue);
			if (!updated) continue;

			currentYaml = updated;
			fixedIssueIds.add(issue.id);
			if (issue.suggestedFix.action === 'addField') {
				const parentPath = addFieldParentPath(issue, issue.suggestedFix);
				appliedAddFields.add(
					`${issue.docIndex ?? 1}:${parentPath ?? ''}:${issue.suggestedFix.field}`
				);
			}
			suggestedFixCount += 1;
			progress = true;
			if (issue.severity === 'error') fixedErrors += 1;
			if (issue.severity === 'warning') fixedWarnings += 1;
			changes.push({
				issueId: issue.id,
				source: 'suggested',
				label: suggestedFixChangeLabel(issue),
				docIndex: issue.docIndex
			});
		}
	}

	return {
		yaml: currentYaml,
		formatFixes,
		suggestedFixCount,
		changes,
		fixedErrors,
		fixedWarnings,
		fixedIssueIds
	};
}

function issuesNeedingAi(issues: BundleIssue[]): BundleIssue[] {
	return issues.filter(
		(issue) =>
			!issue.suggestedFix &&
			(issue.severity === 'error' || issue.severity === 'warning')
	);
}

async function maybeEnrichIssues(
	yaml: string,
	issues: BundleIssue[],
	options?: FixAllBundleOptions
): Promise<BundleIssue[]> {
	if (!options?.releaseFolder || !options.manifest?.length) return issues;
	return enrichIssuesWithSuggestedFix(yaml, issues, {
		releaseFolder: options.releaseFolder,
		manifest: options.manifest,
		resolveDocIndex: options.resolveDocIndex,
		resolveIdentity: options.resolveIdentity
	});
}

/** Apply deterministic schema fixes first; AI only when includeAi is true. */
export async function fixAllBundle(
	yamlInput: string,
	issues: BundleIssue[],
	options?: FixAllBundleOptions
): Promise<FixAllResult> {
	const beforeYaml = yamlInput;
	const parseIssueAtStart = firstParseIssueForInput(yamlInput);
	const allIssues = parseIssueAtStart
		? [parseIssueAtStart, ...issues.filter((i) => i.id !== parseIssueAtStart.id)]
		: [...issues];

	const changes: FixAllChange[] = [];
	let yaml = yamlInput;
	let aiUnavailable = false;
	let aiUnavailableReason: string | undefined;
	let aiFixCount = 0;
	let formatFixes: FixReport[] = [];
	let suggestedFixCount = 0;
	let fixedErrors = 0;
	let fixedWarnings = 0;
	const deterministicFixedIds = new Set<string>();
	const includeAi = options?.includeAi === true && !!options?.aiFix;

	// Phase 1: deterministic fixes only (format + suggestedFix), optionally revalidate between passes.
	let workingIssues = allIssues.filter((i) => i.severity === 'error' || i.severity === 'warning');
	workingIssues = await maybeEnrichIssues(yaml, workingIssues, options);
	const maxPasses = options?.revalidateIssues ? MAX_DETERMINISTIC_PASSES : 1;

	for (let pass = 0; pass < maxPasses; pass++) {
		const includeFormat = options?.includeLayoutFormat === true && pass === 0;
		const det = await applyDeterministicPass(yaml, workingIssues, options, includeFormat);
		yaml = det.yaml;
		if (pass === 0) formatFixes = det.formatFixes;
		suggestedFixCount += det.suggestedFixCount;
		fixedErrors += det.fixedErrors;
		fixedWarnings += det.fixedWarnings;
		for (const id of det.fixedIssueIds) deterministicFixedIds.add(id);
		changes.push(...det.changes);

		if (det.suggestedFixCount === 0 && det.formatFixes.length === 0) break;

		if (options?.revalidateIssues) {
			workingIssues = await options.revalidateIssues(yaml);
			workingIssues = await maybeEnrichIssues(yaml, workingIssues, options);
		}
	}

	// Phase 2: syntax AI only when explicitly enabled and YAML still does not parse.
	let parseIssue = firstParseIssueForInput(yaml);
	if (parseIssue && includeAi) {
		const parseResult = await tryParseAiFix(yaml, parseIssue, options);
		yaml = parseResult.yaml;
		aiUnavailable = parseResult.aiUnavailable;
		aiUnavailableReason = parseResult.aiUnavailableReason;
		if (parseResult.fixed) {
			aiFixCount += 1;
			changes.push({
				issueId: parseIssue.id,
				source: 'ai',
				label: 'AI: fixed YAML syntax',
				docIndex: parseIssue.docIndex
			});
			if (options?.revalidateIssues) {
				workingIssues = await options.revalidateIssues(yaml);
				workingIssues = await maybeEnrichIssues(yaml, workingIssues, options);
				// One more deterministic pass on freshly valid YAML before content AI.
				const det = await applyDeterministicPass(yaml, workingIssues, options, false);
				yaml = det.yaml;
				formatFixes = [...formatFixes, ...det.formatFixes];
				suggestedFixCount += det.suggestedFixCount;
				fixedErrors += det.fixedErrors;
				fixedWarnings += det.fixedWarnings;
				for (const id of det.fixedIssueIds) deterministicFixedIds.add(id);
				changes.push(...det.changes);
				workingIssues = await options.revalidateIssues(yaml);
				workingIssues = await maybeEnrichIssues(yaml, workingIssues, options);
			}
		}
	}

	parseIssue = firstParseIssueForInput(yaml);
	if (parseIssue) {
		const hasChanges = beforeYaml !== yaml;
		const syntaxMessage =
			aiFixCount > 0
				? 'YAML still has syntax errors after AI fix.'
				: hasChanges
					? 'YAML still has syntax errors — review partial fixes.'
					: 'YAML syntax must be fixed before bulk fix can run.';

		// Partial success: keep deterministic/AI edits even when syntax is still invalid.
		if (hasChanges) {
			return {
				ok: true,
				yaml,
				beforeYaml,
				afterYaml: yaml,
				changes,
				message: syntaxMessage,
				parseIssue,
				formatFixes,
				suggestedFixCount,
				aiFixCount,
				aiUnavailable,
				aiUnavailableReason,
				remainingErrors: allIssues.filter((i) => i.severity === 'error').length,
				remainingWarnings: allIssues.filter((i) => i.severity === 'warning').length
			};
		}

		return {
			ok: false,
			yaml: yamlInput,
			beforeYaml,
			afterYaml: yamlInput,
			changes: [],
			message: syntaxMessage,
			parseIssue,
			formatFixes,
			suggestedFixCount,
			aiFixCount,
			aiUnavailable,
			aiUnavailableReason,
			remainingErrors: allIssues.filter((i) => i.severity === 'error').length,
			remainingWarnings: allIssues.filter((i) => i.severity === 'warning').length
		};
	}

	// Phase 3: revalidate, deterministic pass, then iterative AI until clean or max passes.
	if (includeAi && options?.revalidateIssues) {
		workingIssues = await options.revalidateIssues(yaml);
		workingIssues = await maybeEnrichIssues(yaml, workingIssues, options);
		const finalDet = await applyDeterministicPass(yaml, workingIssues, options, false);
		if (finalDet.suggestedFixCount > 0 || finalDet.formatFixes.length > 0) {
			yaml = finalDet.yaml;
			formatFixes = [...formatFixes, ...finalDet.formatFixes];
			suggestedFixCount += finalDet.suggestedFixCount;
			fixedErrors += finalDet.fixedErrors;
			fixedWarnings += finalDet.fixedWarnings;
			for (const id of finalDet.fixedIssueIds) deterministicFixedIds.add(id);
			changes.push(...finalDet.changes);
			workingIssues = await options.revalidateIssues(yaml);
			workingIssues = await maybeEnrichIssues(yaml, workingIssues, options);
		}
	}

	if (includeAi) {
		for (let aiPass = 0; aiPass < MAX_AI_PASSES; aiPass++) {
			const aiTargets = issuesNeedingAi(workingIssues);
			if (aiTargets.length === 0) break;

			const aiResult = await applyAiFixes(yaml, aiTargets, options);
			yaml = aiResult.yaml;
			aiFixCount += aiResult.aiFixCount;
			changes.push(...aiResult.changes);
			if (aiResult.aiUnavailable) {
				aiUnavailable = true;
				aiUnavailableReason = aiResult.aiUnavailableReason;
				break;
			}
			if (aiResult.aiFixCount === 0) break;

			if (!options?.revalidateIssues) break;

			workingIssues = await options.revalidateIssues(yaml);
			workingIssues = await maybeEnrichIssues(yaml, workingIssues, options);
			const det = await applyDeterministicPass(yaml, workingIssues, options, false);
			if (det.suggestedFixCount > 0 || det.formatFixes.length > 0) {
				yaml = det.yaml;
				formatFixes = [...formatFixes, ...det.formatFixes];
				suggestedFixCount += det.suggestedFixCount;
				fixedErrors += det.fixedErrors;
				fixedWarnings += det.fixedWarnings;
				for (const id of det.fixedIssueIds) deterministicFixedIds.add(id);
				changes.push(...det.changes);
				workingIssues = await options.revalidateIssues(yaml);
				workingIssues = await maybeEnrichIssues(yaml, workingIssues, options);
			}
		}
	}

	const remainingAfterAi = options?.revalidateIssues
		? await options.revalidateIssues(yaml)
		: null;
	const totalErrors = remainingAfterAi
		? remainingAfterAi.filter((i) => i.severity === 'error').length
		: Math.max(
				0,
				allIssues.filter((i) => i.severity === 'error').length - fixedErrors - aiFixCount
			);
	const totalWarnings = remainingAfterAi
		? remainingAfterAi.filter((i) => i.severity === 'warning').length
		: Math.max(0, allIssues.filter((i) => i.severity === 'warning').length - fixedWarnings);

	return {
		ok: true,
		yaml,
		beforeYaml,
		afterYaml: yaml,
		changes,
		formatFixes,
		suggestedFixCount,
		aiFixCount,
		aiUnavailable,
		aiUnavailableReason,
		remainingErrors: totalErrors,
		remainingWarnings: totalWarnings
	};
}
