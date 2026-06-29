<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import ResourceModal from '$lib/components/ResourceModal.svelte';
	import releasesYaml from '$lib/releases.yaml?raw';
	import type { CrdResource, EdaRelease, ReleasesConfig } from '$lib/structure';
	import { fetchManifest, getManifestCache, prefetchManifest, type ManifestResource } from '$lib/manifest';
	import { getLatestVersion } from '$lib/versions';
	import {
		validateBundle,
		formatFixSummary,
		type FixSummary,
		applySuggestedFix,
		applySchemaValueFixes,
		extractDocumentYaml,
		inferManifestIdentity,
		replaceDocumentInBundle,
		validateAiFixApply,
		fixAllBundle,
		type AiFixFn,
		type FixAllChange,
		buildFixIssueContext,
		inferIssueKind,
		enrichIssuesWithSuggestedFix,
		parseBundleResources,
		buildYamlCompletionContext,
		schemaKeysForResources,
		type YamlCompletionContext,
		decodeBundleFromUrl,
		getBundleParamFromSearchParams,
		EXAMPLE_BUNDLE_YAML,
		firstParseIssueForInput,
		type BundleIssue,
		type BundleResource,
		type BundleValidationResult
	} from '$lib/validate-bundle';
	import AiFixPreviewPanel from '$lib/validate-bundle/AiFixPreviewPanel.svelte';
	import FixAllReviewPanel from '$lib/validate-bundle/FixAllReviewPanel.svelte';
	import { fixYAML } from '$lib/ai/aiClient';
	import { fixAiEnabled } from '$lib/featureFlags';
	import { clampYamlInput } from '$lib/yaml/inputLimits';
	import { loadStaticYaml } from '$lib/yaml/safeYaml';

	const releasesConfig = loadStaticYaml(releasesYaml) as ReleasesConfig;

	type MonacoEditorInstance = {
		focusLine?: (line: number) => Promise<void>;
	};

	// Dynamic import — loose typing keeps bind:this and custom events valid.
	let MonacoEditorCmp: any = null;

	type IssueGroup = {
		key: string;
		label: string;
		subtitle: string | null;
		docIndex?: number;
		issues: BundleIssue[];
		errorCount: number;
		warningCount: number;
	};

	let releaseName = '';
	let release: EdaRelease | null = null;
	let yamlInput = EXAMPLE_BUNDLE_YAML;
	let result: BundleValidationResult | null = null;
	let isValidating = false;
	let clientReady = false;
	let highlightLine: number | null = null;
	let editorRef: any = undefined;
	let manifestResources: ManifestResource[] = [];
	let modalOpen = false;
	let modalResource: CrdResource | null = null;
	let modalVersion: string | null = null;
	let toast: string | null = null;
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	let yamlCopied = false;
	let yamlCopyTimer: ReturnType<typeof setTimeout> | null = null;
	let fixSummary: FixSummary | null = null;
	let fixSummaryTimer: ReturnType<typeof setTimeout> | null = null;
	let validationGeneration = 0;
	let issueFilter: 'all' | 'errors' | 'warnings' = 'all';
	let issueSearch = '';
	let collapsedGroups = new Set<string>();
	let yamlTruncationWarned = false;

	let aiFixPanelOpen = false;
	let aiFixIssue: BundleIssue | null = null;
	let aiFixLoading = false;
	let aiFixError: string | null = null;
	let aiFixExplanation = '';
	let aiFixOriginalYaml = '';
	let aiFixFixedYaml: string | null = null;
	let aiFixFixable = false;
	let aiFixApplyBlockedReason: string | null = null;
	let aiFixRequestId = 0;
	let isFixingAll = false;
	let fixAllReviewOpen = false;
	let fixAllReviewBefore = '';
	let fixAllReviewAfter = '';
	let fixAllReviewChanges: FixAllChange[] = [];
	let yamlCompletionContext: YamlCompletionContext | null = null;
	let completionRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	let completionSchemaFetchSerial = 0;
	let loadedSchemaFingerprint = '';
	let previousCompletionReleaseFolder = '';
	let liveValidateTimer: ReturnType<typeof setTimeout> | null = null;
	let activeView: 'editor' | 'diagnostics' = 'editor';
	let isSplitWorkspace = false;
	let splitMediaQuery: MediaQueryList | null = null;

	const manifestCache = getManifestCache();

	function updateSplitWorkspace() {
		isSplitWorkspace = splitMediaQuery?.matches ?? false;
	}

	function setYamlInput(value: string) {
		const { text, truncated } = clampYamlInput(value);
		if (truncated && !yamlTruncationWarned) {
			yamlTruncationWarned = true;
			showToast('Input exceeds 512KB — truncated to the limit.');
		}
		if (!truncated) yamlTruncationWarned = false;
		yamlInput = text;
	}

	$: release = releaseName
		? releasesConfig.releases.find((r) => r.name === releaseName) || null
		: null;

	$: if (browser && clientReady && release?.folder) {
		prefetchManifest(release.folder, manifestCache);
	}

	$: displayIssues = result?.issues ?? [];
	$: aiFixButtonDisabled =
		!yamlInput.trim() ||
		!release ||
		!fixAiEnabled ||
		isFixingAll ||
		isValidating ||
		!result ||
		(result.summary.errorCount === 0 && result.summary.warningCount === 0);
	$: aiFixTooltip = !fixAiEnabled
		? 'AI Fix requires PUBLIC_FIX_AI_ENABLED (enabled by default in production builds)'
		: 'Standard fixes first (renames, enums, DNS), then Workers AI only for remaining issues';

	$: filteredIssues = displayIssues.filter((issue) => {
		if (issueFilter === 'errors' && issue.severity !== 'error') return false;
		if (issueFilter === 'warnings' && issue.severity !== 'warning') return false;
		const q = issueSearch.trim().toLowerCase();
		if (!q) return true;
		return (
			issue.message.toLowerCase().includes(q) ||
			issue.resourceKind?.toLowerCase().includes(q) ||
			issue.resourceName?.toLowerCase().includes(q) ||
			issue.fieldPath?.toLowerCase().includes(q) ||
			issueCategoryLabel(issue)?.toLowerCase().includes(q)
		);
	});

	$: issueGroups = groupIssues(filteredIssues);
	$: diagnosticsCount = result
		? result.summary.errorCount + result.summary.warningCount
		: 0;

	function groupIssues(issues: BundleIssue[]): IssueGroup[] {
		const map = new Map<string, IssueGroup>();

		for (const issue of issues) {
			let key: string;
			let label: string;
			let subtitle: string | null = null;

			if (issue.docIndex !== undefined) {
				key = `doc-${issue.docIndex}`;
				label =
					issue.resourceKind && issue.resourceName
						? `${issue.resourceKind} / ${issue.resourceName}`
						: issue.resourceKind || `Document ${issue.docIndex}`;
				subtitle = issue.docIndex ? `Doc ${issue.docIndex}` : null;
			} else if (issue.resourceKind) {
				key = `res-${issue.resourceKind}-${issue.resourceName || 'unnamed'}`;
				label = issue.resourceKind;
				subtitle = issue.resourceName || null;
			} else {
				key = 'general';
				label = 'Bundle';
				subtitle = 'Parse & general issues';
			}

			if (!map.has(key)) {
				map.set(key, {
					key,
					label,
					subtitle,
					docIndex: issue.docIndex,
					issues: [],
					errorCount: 0,
					warningCount: 0
				});
			}

			const group = map.get(key)!;
			group.issues.push(issue);
			if (issue.severity === 'error') group.errorCount++;
			if (issue.severity === 'warning') group.warningCount++;
		}

		return Array.from(map.values()).sort((a, b) => {
			const aDoc = a.docIndex ?? Number.MAX_SAFE_INTEGER;
			const bDoc = b.docIndex ?? Number.MAX_SAFE_INTEGER;
			if (aDoc !== bDoc) return aDoc - bDoc;
			return a.label.localeCompare(b.label);
		});
	}

	function showToast(message: string) {
		toast = message;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			toast = null;
		}, 3000);
	}

	function showFixSummary(summary: FixSummary) {
		fixSummary = summary;
		if (fixSummaryTimer) clearTimeout(fixSummaryTimer);
		fixSummaryTimer = setTimeout(() => {
			fixSummary = null;
		}, 5000);
	}

	async function handleCopyYaml() {
		if (!yamlInput.trim()) return;
		try {
			await navigator.clipboard.writeText(yamlInput);
			yamlCopied = true;
			showToast('YAML copied to clipboard');
			if (yamlCopyTimer) clearTimeout(yamlCopyTimer);
			yamlCopyTimer = setTimeout(() => {
				yamlCopied = false;
			}, 2000);
		} catch {
			showToast('Could not copy YAML');
		}
	}

	async function getFormatOptions() {
		if (manifestResources.length) {
			return { releaseFolder: release!.folder, manifest: manifestResources };
		}
		return {
			releaseFolder: release!.folder,
			manifest: (await fetchManifest(release!.folder, manifestCache)) || []
		};
	}

	function suggestedFixLabel(issue: BundleIssue): string {
		const fix = issue.suggestedFix;
		if (!fix) return '';
		if (fix.action === 'renameKey') {
			return `Rename ${fix.field} → ${fix.value}`;
		}
		if (fix.action === 'relocateField') {
			return `Relocate ${fix.field} → ${fix.value}`;
		}
		if (fix.action === 'addField') {
			return `Add ${fix.field}: ${fix.value}`;
		}
		return `Replace ${fix.field} with ${fix.value}`;
	}

	function createAiFixFn(): AiFixFn {
		return async ({ docYaml, issue, issues, kind, group }) => {
			if (!release) return {};
			const formatOptions = await getFormatOptions();
			const contextOptions = {
				releaseFolder: formatOptions.releaseFolder,
				manifest: formatOptions.manifest,
				kind,
				group,
				docYaml
			};

			if (issues && issues.length > 1) {
				const relatedSummaries = issues.map(
					(batchIssue) =>
						`${batchIssue.fieldPath ?? 'document'}: ${batchIssue.message.slice(0, 120)}`
				);
				const payloads = await Promise.all(
					issues.map((batchIssue, index) =>
						buildFixIssueContext(batchIssue, {
							...contextOptions,
							relatedIssues: relatedSummaries.filter((_, i) => i !== index)
						})
					)
				);
				const result = await fixYAML(release.name, docYaml, payloads[0]!, {
					kind,
					group,
					issues: payloads
				});
				return {
					fixedYaml: result.fixedYaml,
					fixable: result.fixable,
					error: result.error,
					fallbackReason: result.fallbackReason
				};
			}

			const payload = await buildFixIssueContext(issue, contextOptions);
			const result = await fixYAML(
				release.name,
				docYaml,
				payload,
				kind ? { kind, group } : undefined
			);
			return {
				fixedYaml: result.fixedYaml,
				fixable: result.fixable,
				error: result.error,
				fallbackReason: result.fallbackReason
			};
		};
	}

	async function revalidateFixIssues(yaml: string): Promise<BundleIssue[]> {
		if (!release) return [];
		const manifest = (await fetchManifest(release.folder, manifestCache)) || [];
		const validation = await validateBundle({
			yamlInput: yaml,
			releaseFolder: release.folder,
			releaseLabel: release.label,
			manifest
		});
		return validation.issues.filter(
			(i) => i.severity === 'error' || i.severity === 'warning'
		);
	}

	async function runBulkFix(
		options: { requireIssues?: boolean; includeAi?: boolean } = {}
	) {
		if (!release) {
			showToast('Select an EDA release first.');
			return;
		}

		if (!result) {
			await runValidation();
		}

		const issues = result?.issues ?? [];
		const parseIssue = firstParseIssueForInput(yamlInput);
		if (
			options.requireIssues &&
			!parseIssue &&
			issues.filter((i) => i.severity === 'error' || i.severity === 'warning').length === 0
		) {
			showToast('No errors or warnings to fix.');
			return;
		}

		const includeAi = options.includeAi === true && fixAiEnabled;

		isFixingAll = true;
		try {
			const formatOptions = await getFormatOptions();
			const fixResult = await fixAllBundle(yamlInput, issues, {
				...formatOptions,
				includeAi,
				...(includeAi ? { aiFix: createAiFixFn() } : {}),
				revalidateIssues: revalidateFixIssues,
				resolveDocIndex: resolveIssueDocIndex,
				resolveIdentity: (issue, docYaml) => resolveFixIdentity(issue, docYaml)
			});

			const hasYamlChanges = fixResult.beforeYaml !== fixResult.afterYaml;

			if (!fixResult.ok) {
				showToast(fixResult.message ?? 'Could not apply fixes.');
				return;
			}

			if (hasYamlChanges) {
				setYamlInput(fixResult.yaml);
				fixAllReviewBefore = fixResult.beforeYaml;
				fixAllReviewAfter = fixResult.afterYaml;
				fixAllReviewChanges = fixResult.changes;
				fixAllReviewOpen = true;
			}

			if (fixResult.formatFixes.length > 0) {
				showFixSummary(
					formatFixSummary(fixResult.formatFixes, result?.resources.length ?? 1)
				);
			}

			await runValidation();

			const applied =
				fixResult.formatFixes.length + fixResult.suggestedFixCount + fixResult.aiFixCount;
			const remainingErrors = result?.summary.errorCount ?? 0;
			const remainingWarnings = result?.summary.warningCount ?? 0;
			if (remainingErrors > 0 || remainingWarnings > 0) {
				collapsedGroups = new Set();
			}

			const parts: string[] = [];
			if (fixResult.formatFixes.length > 0) {
				parts.push(`${fixResult.formatFixes.length} manifest`);
			}
			if (fixResult.suggestedFixCount > 0) {
				parts.push(`${fixResult.suggestedFixCount} standard`);
			}
			if (fixResult.aiFixCount > 0) {
				parts.push(`${fixResult.aiFixCount} AI`);
			}

			const remainingParts: string[] = [];
			if (fixResult.parseIssue) {
				remainingParts.push('syntax errors');
			}
			if (remainingErrors > 0) {
				remainingParts.push(`${remainingErrors} error${remainingErrors === 1 ? '' : 's'}`);
			}
			if (remainingWarnings > 0) {
				remainingParts.push(
					`${remainingWarnings} warning${remainingWarnings === 1 ? '' : 's'}`
				);
			}
			const remainingMsg =
				remainingParts.length > 0 ? `; ${remainingParts.join(' and ')} remain` : '';

			let prefix = '';
			if (fixResult.aiUnavailable) {
				prefix = 'AI limit reached — applied standard fixes only. ';
			}

			if (fixResult.parseIssue && !hasYamlChanges) {
				showToast(fixResult.message ?? 'YAML syntax must be fixed before bulk fix can run.');
			} else {
				showToast(
					applied > 0
						? `${prefix}Applied ${applied} fix${applied === 1 ? '' : 'es'}${remainingMsg}.`
						: `${prefix}No automatic fixes were applicable. Use Fix on individual issues.`
				);
			}
		} finally {
			isFixingAll = false;
		}
	}

	async function handleAiFix() {
		await runBulkFix({ includeAi: true, requireIssues: true });
	}

	function updateURL() {
		if (!browser) return;
		const params = new URLSearchParams($page.url.searchParams);
		if (releaseName) params.set('release', releaseName);
		else params.delete('release');
		const targetUrl = `/validate-yaml${params.toString() ? `?${params.toString()}` : ''}`;
		const currentUrl = `${$page.url.pathname}${$page.url.search}`;
		if (targetUrl === currentUrl) return;
		goto(targetUrl, { replaceState: true, noScroll: true, keepFocus: true });
	}

	let previousReleaseName = '';
	$: if (browser && clientReady && releaseName !== previousReleaseName) {
		previousReleaseName = releaseName;
		updateURL();
	}

	function mergeCompletionContext(
		resources: BundleResource[],
		partial: {
			schemas?: YamlCompletionContext['schemas'];
			manifest?: YamlCompletionContext['manifest'];
		}
	): YamlCompletionContext {
		const prior = yamlCompletionContext;
		const schemas = partial.schemas ?? prior?.schemas ?? new Map();
		const manifest =
			partial.manifest && partial.manifest.length > 0
				? partial.manifest
				: manifestResources.length > 0
					? manifestResources
					: (prior?.manifest ?? []);

		const next: YamlCompletionContext = {
			resources,
			schemas,
			releaseFolder: release!.folder,
			manifest
		};
		yamlCompletionContext = next;
		return next;
	}

	async function refreshCompletionContext() {
		if (!browser || !release || !yamlInput.trim()) {
			yamlCompletionContext = null;
			loadedSchemaFingerprint = '';
			return;
		}

		const parsed = parseBundleResources(yamlInput);
		if (parsed.resources.length === 0) {
			yamlCompletionContext = null;
			loadedSchemaFingerprint = '';
			return;
		}

		mergeCompletionContext(parsed.resources, {});

		const manifest =
			manifestResources.length > 0
				? manifestResources
				: (await fetchManifest(release.folder, manifestCache)) || [];
		manifestResources = manifest;

		const schemaFingerprint = schemaKeysForResources(
			parsed.resources,
			release.folder,
			manifest
		).join('\0');

		if (
			schemaFingerprint &&
			schemaFingerprint === loadedSchemaFingerprint &&
			(yamlCompletionContext?.schemas.size ?? 0) > 0
		) {
			mergeCompletionContext(parseBundleResources(yamlInput).resources, { manifest });
			return;
		}

		const fetchId = ++completionSchemaFetchSerial;

		try {
			const fetched = await buildYamlCompletionContext(
				parsed.resources,
				release.folder,
				manifest
			);

			const latest = parseBundleResources(yamlInput);
			if (latest.resources.length === 0) return;

			const mergedSchemas = new Map([
				...(yamlCompletionContext?.schemas ?? []),
				...fetched.schemas
			]);

			if (fetchId === completionSchemaFetchSerial) {
				if (mergedSchemas.size > 0) {
					loadedSchemaFingerprint = schemaFingerprint;
				}
				mergeCompletionContext(latest.resources, {
					schemas: mergedSchemas,
					manifest
				});
				return;
			}

			// A newer refresh started — still apply schemas so spec completions are not lost.
			if (fetched.schemas.size > 0) {
				mergeCompletionContext(latest.resources, {
					schemas: mergedSchemas,
					manifest
				});
			}
		} catch {
			const latest = parseBundleResources(yamlInput);
			if (latest.resources.length > 0) {
				mergeCompletionContext(latest.resources, { manifest: manifestResources });
			}
		}
	}

	function scheduleCompletionRefresh(immediate = false) {
		if (!browser || !clientReady) return;
		if (completionRefreshTimer) clearTimeout(completionRefreshTimer);
		if (immediate) {
			void refreshCompletionContext();
			return;
		}
		completionRefreshTimer = setTimeout(() => {
			completionRefreshTimer = null;
			void refreshCompletionContext();
		}, 300);
	}

	$: if (browser && clientReady && release?.folder && release.folder !== previousCompletionReleaseFolder) {
		previousCompletionReleaseFolder = release.folder;
		loadedSchemaFingerprint = '';
		void refreshCompletionContext();
	}

	// Keyed on yaml + release only — never read yamlCompletionContext here (that caused a reactive loop).
	$: completionInputKey =
		browser && clientReady && release && yamlInput.trim()
			? `${release.folder}\0${yamlInput}`
			: '';

	$: if (completionInputKey) {
		scheduleCompletionRefresh();
	}

	function scheduleEditorLayout() {
		if (!browser || !clientReady || (!isSplitWorkspace && activeView !== 'editor')) return;
		void (async () => {
			await tick();
			requestAnimationFrame(() => {
				requestAnimationFrame(() => editorRef?.layout?.());
			});
		})();
	}

	$: if (browser && clientReady && (isSplitWorkspace || activeView === 'editor')) {
		scheduleEditorLayout();
	}

	$: if (browser && clientReady && release && yamlInput.trim()) {
		scheduleLiveValidation();
	}

	$: if (browser && clientReady && release && !yamlInput.trim()) {
		yamlCompletionContext = null;
		loadedSchemaFingerprint = '';
	}

	$: if (!release) {
		yamlCompletionContext = null;
		loadedSchemaFingerprint = '';
	}

	function scheduleLiveValidation() {
		if (!browser || !clientReady || !release) return;
		if (liveValidateTimer) clearTimeout(liveValidateTimer);
		liveValidateTimer = setTimeout(() => {
			liveValidateTimer = null;
			void runValidation();
		}, 500);
	}

	let validationInFlight = 0;

	async function runValidation(options: { requireRelease?: boolean } = {}) {
		if (!yamlInput.trim()) {
			result = null;
			isValidating = false;
			return;
		}
		if (!release) {
			if (options.requireRelease) {
				showToast('Select an EDA release first.');
			}
			return;
		}

		const generation = ++validationGeneration;
		validationInFlight += 1;
		isValidating = true;
		highlightLine = null;

		try {
			const manifest = (await fetchManifest(release.folder, manifestCache)) || [];
			if (generation !== validationGeneration) return;

			manifestResources = manifest;
			result = await validateBundle({
				yamlInput,
				releaseFolder: release.folder,
				releaseLabel: release.label,
				manifest
			});
			void refreshCompletionContext();
		} catch (error) {
			if (generation !== validationGeneration) return;
			const message = error instanceof Error ? error.message : String(error);
			result = {
				valid: false,
				issues: [
					{
						id: 'fatal',
						severity: 'error',
						category: 'schema',
						message: `Validation failed: ${message}`
					}
				],
				summary: { resourceCount: 0, errorCount: 1, warningCount: 0, infoCount: 0 },
				resources: []
			};
		} finally {
			validationInFlight = Math.max(0, validationInFlight - 1);
			if (validationInFlight === 0) {
				isValidating = false;
			}
		}
	}


	function focusEditorLine(line: number) {
		if (line < 1) return;
		highlightLine = line;
		void editorRef?.focusLine?.(line);
	}

	function jumpToIssue(issue: BundleIssue) {
		if (!isSplitWorkspace) {
			activeView = 'editor';
		}
		if (issue.line) {
			focusEditorLine(issue.line);
		}
	}

	function showDiagnosticsView() {
		activeView = 'diagnostics';
	}

	function issueFixAvailable(issue: BundleIssue): boolean {
		if (issue.suggestedFix) return true;
		if (issue.severity !== 'error' && issue.severity !== 'warning') return false;
		if (issue.message.includes('Misplaced field')) return false;
		if (issue.category === 'schema' && /must be one of|exact case/i.test(issue.message)) {
			return true;
		}
		if (issue.category === 'schema' && /must be <=|must be >=/i.test(issue.message)) {
			return true;
		}
		if (issue.message.includes('is required')) return true;
		if (issue.message.includes('Misspelled field')) return true;
		if (issue.message.includes('Unknown field')) return true;
		if (!fixAiEnabled || !release) return false;
		if (/yaml|parse|indent|syntax/i.test(issue.message)) return true;
		return false;
	}

	function resolveFixIdentity(
		issue: BundleIssue,
		docYaml: string
	): { kind?: string; group?: string } {
		const bundleRes = findBundleResourceForIssue(issue);
		const inferred = inferManifestIdentity(docYaml);
		return {
			kind: issue.resourceKind ?? bundleRes?.kind ?? inferred.kind,
			group: bundleRes?.group ?? inferred.group
		};
	}

	function closeFixAllReview() {
		fixAllReviewOpen = false;
		fixAllReviewBefore = '';
		fixAllReviewAfter = '';
		fixAllReviewChanges = [];
	}

	function handleRevertFixAll() {
		setYamlInput(fixAllReviewBefore);
		closeFixAllReview();
		showToast('Reverted AI Fix changes.');
		void runValidation();
	}

	function closeAiFixPanel() {
		aiFixPanelOpen = false;
		aiFixIssue = null;
		aiFixLoading = false;
		aiFixError = null;
		aiFixExplanation = '';
		aiFixOriginalYaml = '';
		aiFixFixedYaml = null;
		aiFixFixable = false;
		aiFixApplyBlockedReason = null;
	}

	function refreshAiFixApplyGuard(originalYaml: string, fixedYaml: string, issue: BundleIssue) {
		const guard = validateAiFixApply(originalYaml, fixedYaml, issue);
		aiFixApplyBlockedReason = guard.ok ? null : guard.reason ?? 'Cannot apply this fix.';
	}

	function resolveIssueDocIndex(issue: BundleIssue): number {
		if (issue.docIndex !== undefined) return issue.docIndex;
		const bundleRes = findBundleResourceForIssue(issue);
		return bundleRes ? bundleRes.docIndex + 1 : 1;
	}

	async function openAiFixPreview(issue: BundleIssue) {
		if (!release) return;

		let issueForAi = issue;
		if (!issue.suggestedFix && release) {
			const formatOptions = await getFormatOptions();
			const [enriched] = await enrichIssuesWithSuggestedFix(yamlInput, [issue], {
				releaseFolder: formatOptions.releaseFolder,
				manifest: formatOptions.manifest,
				resolveDocIndex: resolveIssueDocIndex,
				resolveIdentity: (item, docYaml) => resolveFixIdentity(item, docYaml)
			});
			issueForAi = enriched;
			if (issueForAi.suggestedFix) {
				void handleApplyFix(issueForAi, new MouseEvent('click'));
				return;
			}
		}

		const docIndex = resolveIssueDocIndex(issueForAi);
		const docYaml = extractDocumentYaml(yamlInput, docIndex);
		if (!docYaml) {
			showToast('Could not extract document YAML for AI fix.');
			return;
		}

		const { kind, group } = resolveFixIdentity(issueForAi, docYaml);
		const requestId = ++aiFixRequestId;

		aiFixIssue = issueForAi;
		aiFixPanelOpen = true;
		aiFixLoading = true;
		aiFixError = null;
		aiFixExplanation = '';
		aiFixOriginalYaml = docYaml;
		aiFixFixedYaml = null;
		aiFixFixable = false;
		aiFixApplyBlockedReason = null;

		const formatOptions = await getFormatOptions();
		const payload = await buildFixIssueContext(issueForAi, {
			releaseFolder: formatOptions.releaseFolder,
			manifest: formatOptions.manifest,
			kind,
			group,
			docYaml
		});

		const result = await fixYAML(
			release.name,
			docYaml,
			payload,
			kind ? { kind, group } : undefined
		);

		if (requestId !== aiFixRequestId) return;

		aiFixLoading = false;
		if (result.error) {
			aiFixError = result.error;
			return;
		}

		aiFixExplanation = result.explanation || result.answer;
		aiFixFixedYaml = result.fixedYaml ?? null;
		aiFixFixable = result.fixable === true && !!aiFixFixedYaml;

		if (aiFixFixedYaml) {
			refreshAiFixApplyGuard(docYaml, aiFixFixedYaml, issue);
		}
	}

	function handleApplyAiFix() {
		if (!aiFixIssue || !aiFixFixedYaml) return;

		const resolvedDocIndex = resolveIssueDocIndex(aiFixIssue);

		const guard = validateAiFixApply(aiFixOriginalYaml, aiFixFixedYaml, aiFixIssue);
		if (!guard.ok) {
			aiFixApplyBlockedReason = guard.reason ?? 'Cannot apply this fix.';
			return;
		}

		const updated = replaceDocumentInBundle(yamlInput, resolvedDocIndex, aiFixFixedYaml);
		if (!updated) {
			showToast('Could not apply AI fix — edit manually.');
			return;
		}

		setYamlInput(updated);
		if (aiFixIssue.line) {
			highlightLine = aiFixIssue.line;
			focusEditorLine(aiFixIssue.line);
		}
		closeAiFixPanel();
		showToast('Applied AI fix — re-validating…');
		void runValidation();
	}

	async function handleApplyFix(issue: BundleIssue, event: MouseEvent) {
		event.stopPropagation();

		let issueToFix = issue;
		if (!issue.suggestedFix && release) {
			const formatOptions = await getFormatOptions();
			const [enriched] = await enrichIssuesWithSuggestedFix(yamlInput, [issue], {
				releaseFolder: formatOptions.releaseFolder,
				manifest: formatOptions.manifest,
				resolveDocIndex: resolveIssueDocIndex,
				resolveIdentity: (item, docYaml) => resolveFixIdentity(item, docYaml)
			});
			issueToFix = enriched;
		}

		if (issueToFix.suggestedFix) {
			const updated = applySuggestedFix(yamlInput, issueToFix);
			if (!updated) {
				showToast('Could not apply fix — edit the field manually.');
				return;
			}

			setYamlInput(updated);
			if (issueToFix.line) {
				highlightLine = issueToFix.line;
				focusEditorLine(issueToFix.line);
			}
			showToast(suggestedFixLabel(issueToFix) || 'Applied fix');
			void runValidation();
			return;
		}

		if (release && (issue.severity === 'error' || issue.severity === 'warning')) {
			const formatOptions = await getFormatOptions();
			const issueKind = inferIssueKind(issueToFix);
			const structuralSpecIssue =
				issueToFix.fieldPath?.startsWith('spec.') &&
				(issueKind === 'unknownField' || issueKind === 'type');
			const valueFixed = await applySchemaValueFixes(yamlInput, formatOptions, {
				docIndex: resolveIssueDocIndex(issueToFix),
				...(structuralSpecIssue ? {} : { fieldPath: issueToFix.fieldPath })
			});
			if (valueFixed.ok && valueFixed.fixes.length > 0) {
				setYamlInput(valueFixed.formatted);
				showFixSummary(formatFixSummary(valueFixed.fixes, result?.resources.length ?? 1));
				void runValidation();
				return;
			}
		}

		if (issue.severity === 'error' || issue.severity === 'warning') {
			if (fixAiEnabled && release && !issueToFix.suggestedFix) {
				void openAiFixPreview(issueToFix);
			} else {
				showToast('No automatic fix available — edit the field manually.');
			}
			return;
		}

		showToast('No automatic fix available — edit the field manually.');
	}

	function toggleGroup(key: string) {
		const next = new Set(collapsedGroups);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		collapsedGroups = next;
	}

	function findManifestEntry(kind: string, group: string): ManifestResource | undefined {
		let entry = manifestResources.find((r) => r.kind === kind && (!r.group || r.group === group));
		if (!entry) entry = manifestResources.find((r) => r.kind === kind);
		if (!entry) {
			entry = manifestResources.find((r) => {
				const kindLower = kind.toLowerCase();
				const resourceType = r.name?.toLowerCase().split('.')[0];
				return resourceType === kindLower;
			});
		}
		return entry;
	}

	function findBundleResourceForIssue(issue: BundleIssue): BundleResource | undefined {
		if (!result) return undefined;
		if (issue.docIndex !== undefined) {
			return result.resources.find((r) => r.docIndex + 1 === issue.docIndex);
		}
		if (issue.resourceKind && issue.resourceName) {
			return result.resources.find(
				(r) => r.kind === issue.resourceKind && r.name === issue.resourceName
			);
		}
		if (issue.resourceKind) {
			return result.resources.find((r) => r.kind === issue.resourceKind);
		}
		return undefined;
	}

	function manifestEntryForIssue(issue: BundleIssue): ManifestResource | undefined {
		const bundleRes = findBundleResourceForIssue(issue);
		if (!bundleRes?.kind) return undefined;
		return findManifestEntry(bundleRes.kind, bundleRes.group);
	}

	function openCrdSchemaModal(issue: BundleIssue, event: MouseEvent) {
		event.stopPropagation();
		const entry = manifestEntryForIssue(issue);
		if (!entry || !release) return;
		modalResource = entry as CrdResource;
		modalVersion = getLatestVersion(entry);
		modalOpen = true;
	}

	function closeCrdSchemaModal() {
		modalOpen = false;
		modalResource = null;
		modalVersion = null;
	}

	function severityTone(severity: BundleIssue['severity']) {
		switch (severity) {
			case 'error':
				return { strip: 'validate-yaml-issue--error', badge: 'validate-yaml-issue-badge--error', label: 'Error' };
			case 'warning':
				return {
					strip: 'validate-yaml-issue--warning',
					badge: 'validate-yaml-issue-badge--warning',
					label: 'Warning'
				};
			default:
				return { strip: 'validate-yaml-issue--info', badge: 'validate-yaml-issue-badge--info', label: 'Info' };
		}
	}

	function issueCategoryLabel(issue: BundleIssue): string | null {
		if (issue.category === 'schema') {
			if (issue.message.startsWith('Invalid apiVersion:')) return 'Schema · apiVersion';
			if (issue.message.startsWith('Invalid kind:')) return 'Schema · kind';
			if (/\bdeprecated\b/i.test(issue.message)) return 'Schema · Deprecated';
			if (issue.message.includes('Misspelled field')) return 'Schema · Misspelled field';
			if (issue.message.includes('Unknown field')) return 'Schema · Unknown field';
			return 'Schema';
		}
		if (issue.category === 'eda') return 'EDA · Manifest';
		if (issue.category === 'kubernetes') return 'Kubernetes';
		return null;
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && aiFixPanelOpen) {
			closeAiFixPanel();
		}
	}

	onMount(async () => {
		if (browser) {
			splitMediaQuery = window.matchMedia('(min-width: 1024px)');
			updateSplitWorkspace();
			splitMediaQuery.addEventListener('change', updateSplitWorkspace);
			window.addEventListener('keydown', onKeydown);
			try {
				const mod = await import('$lib/validate-bundle/MonacoYamlEditor.svelte');
				MonacoEditorCmp = mod.default;
			} catch (error) {
				console.error('Failed to load Monaco editor', error);
				showToast('YAML editor failed to load — try refreshing the page.');
			}
		}

		const urlRelease = $page.url.searchParams.get('release');
		if (urlRelease) {
			releaseName = urlRelease;
		} else {
			const defaultRelease =
				releasesConfig.releases.find((r) => r.default) || releasesConfig.releases[0];
			if (defaultRelease) releaseName = defaultRelease.name;
		}

		const bundleParam = getBundleParamFromSearchParams($page.url.searchParams);
		if (bundleParam) {
			const decoded = await decodeBundleFromUrl(bundleParam);
			if (decoded) {
				setYamlInput(decoded);
			} else {
				showToast('Could not decode bundle from URL — using default example.');
			}
		}

		clientReady = true;
		void runValidation();
		scheduleCompletionRefresh(true);
	});

	onDestroy(() => {
		if (browser) {
			splitMediaQuery?.removeEventListener('change', updateSplitWorkspace);
			window.removeEventListener('keydown', onKeydown);
		}
		if (toastTimer) clearTimeout(toastTimer);
		if (fixSummaryTimer) clearTimeout(fixSummaryTimer);
		if (yamlCopyTimer) clearTimeout(yamlCopyTimer);
		if (completionRefreshTimer) clearTimeout(completionRefreshTimer);
		if (liveValidateTimer) clearTimeout(liveValidateTimer);
	});

</script>

<svelte:head>
	<title>EDA Resource Browser | Validate YAML</title>
	<meta
		name="description"
		content="Validate multi-document Nokia EDA YAML — per-resource CRD schema checks and EDA manifest rules."
	/>
</svelte:head>

<div class="validate-yaml-page validate-yaml-page--pro spec-search-page page-shell overflow-hidden bg-gray-50 dark:text-gray-100">
	<AppHeader fixed={false} />

	<div class="validate-yaml-shell validate-yaml-shell--wide">
		<header class="validate-yaml-topbar" aria-labelledby="validate-yaml-heading">
			<div class="validate-yaml-topbar__brand">
				<h1 id="validate-yaml-heading" class="validate-yaml-topbar__title">Validate YAML</h1>
				<p class="validate-yaml-topbar__subtitle">
					<span class="validate-yaml-topbar__capabilities" aria-label="Capabilities">
						<span class="validate-yaml-topbar__capability">Multi-document manifests</span>
						<span class="validate-yaml-topbar__capability-sep" aria-hidden="true">·</span>
						<span class="validate-yaml-topbar__capability">CRD schema</span>
						<span class="validate-yaml-topbar__capability-sep" aria-hidden="true">·</span>
						<span class="validate-yaml-topbar__capability">Kubernetes</span>
						<span class="validate-yaml-topbar__capability-sep" aria-hidden="true">·</span>
						<span class="validate-yaml-topbar__capability">EDA rules</span>
					</span>
				</p>
			</div>

			<div class="validate-yaml-topbar__controls" role="group" aria-label="Validation options">
				<div class="validate-yaml-action-bar">
					<div class="validate-yaml-release-field">
						<label for="validation-release" class="validate-yaml-release-field__label">Release</label>
						<select
							id="validation-release"
							bind:value={releaseName}
							on:change={() => void runValidation()}
							class="spec-search-select validate-yaml-topbar__release"
							aria-label="Select EDA release"
						>
							<option value="">Select release…</option>
							{#each releasesConfig.releases as r}
								<option value={r.name}>{r.label}{r.default ? ' (latest)' : ''}</option>
							{/each}
						</select>
					</div>

					<div class="validate-yaml-action-bar__primary">
						<button
							type="button"
							class="validate-yaml-btn validate-yaml-btn--primary"
							disabled={isValidating || !release}
							on:click={() => void runValidation({ requireRelease: true })}
						>
							{#if isValidating}
								<svg class="validate-yaml-btn__spinner animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
									<path
										class="opacity-75"
										fill="currentColor"
										d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
									/>
								</svg>
							{/if}
							{isValidating ? 'Validating…' : 'Validate'}
						</button>

						<button
							type="button"
							class="validate-yaml-fix-ai"
							disabled={aiFixButtonDisabled}
							title={aiFixTooltip}
							on:click={() => void handleAiFix()}
						>
							{#if isFixingAll}
								<svg
									class="validate-yaml-btn__spinner animate-spin"
									fill="none"
									viewBox="0 0 24 24"
									aria-hidden="true"
								>
									<circle
										class="opacity-25"
										cx="12"
										cy="12"
										r="10"
										stroke="currentColor"
										stroke-width="4"
									/>
									<path
										class="opacity-75"
										fill="currentColor"
										d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
									/>
								</svg>
							{:else}
								<svg
									class="validate-yaml-fix-ai__icon"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<path
										d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.964 0z"
									/>
									<path d="M20 3v4" />
									<path d="M22 5h-4" />
								</svg>
							{/if}
							<span class="validate-yaml-fix-ai__label">
								{isFixingAll ? 'Fixing…' : 'AI Fix'}
							</span>
						</button>
					</div>

					<div class="validate-yaml-action-bar__utils">
						<button
							type="button"
							class="validate-yaml-btn validate-yaml-btn--ghost validate-yaml-btn--icon"
							aria-label="Load example YAML"
							title="Load example YAML"
							on:click={() => {
								setYamlInput(EXAMPLE_BUNDLE_YAML);
								void runValidation();
							}}
						>
							<svg
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								class="validate-yaml-btn__icon"
								aria-hidden="true"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="1.75"
									d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
								/>
							</svg>
						</button>

						<button
							type="button"
							class="validate-yaml-btn validate-yaml-btn--ghost validate-yaml-btn--icon"
							disabled={!yamlInput.trim()}
							aria-label={yamlCopied ? 'YAML copied' : 'Copy YAML to clipboard'}
							title={yamlCopied ? 'Copied' : 'Copy YAML to clipboard'}
							on:click={() => void handleCopyYaml()}
						>
							{#if yamlCopied}
								<svg
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									class="validate-yaml-btn__icon"
									aria-hidden="true"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="1.75"
										d="M5 13l4 4L19 7"
									/>
								</svg>
							{:else}
								<svg
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									class="validate-yaml-btn__icon"
									aria-hidden="true"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="1.75"
										d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
									/>
								</svg>
							{/if}
						</button>
					</div>
				</div>
			</div>

			{#if result}
				<div class="validate-yaml-topbar__stats" role="status" aria-live="polite">
					<span class="validate-yaml-stat">
						<span class="validate-yaml-stat__value">{result.summary.resourceCount}</span>
						<span class="validate-yaml-stat__label">doc{result.summary.resourceCount !== 1 ? 's' : ''}</span>
					</span>
					{#if result.summary.errorCount > 0}
						<span class="validate-yaml-stat validate-yaml-stat--error">
							<span class="validate-yaml-stat__value">{result.summary.errorCount}</span>
							<span class="validate-yaml-stat__label">
								<span class="validate-yaml-stat__label--abbr">err</span>
								<span class="validate-yaml-stat__label--full">errors</span>
							</span>
						</span>
					{/if}
					{#if result.summary.warningCount > 0}
						<span class="validate-yaml-stat validate-yaml-stat--warning">
							<span class="validate-yaml-stat__value">{result.summary.warningCount}</span>
							<span class="validate-yaml-stat__label">
								<span class="validate-yaml-stat__label--abbr">warn</span>
								<span class="validate-yaml-stat__label--full">warnings</span>
							</span>
						</span>
					{/if}
					<span
						class="validate-yaml-status-pill"
						class:validate-yaml-status-pill--valid={result.valid}
						class:validate-yaml-status-pill--invalid={!result.valid}
					>
						{result.valid ? 'Valid' : 'Invalid'}
					</span>
				</div>
			{/if}
		</header>

		{#if isValidating}
			<div
				class="validate-yaml-progress-strip"
				role="progressbar"
				aria-label="Validating YAML"
			></div>
		{/if}

		{#if fixSummary}
			<div class="validate-yaml-fix-banner validate-yaml-fix-banner--compact" role="status" aria-live="polite">
				<p class="validate-yaml-fix-banner__headline">{fixSummary.headline}</p>
			</div>
		{/if}

		<div class="validate-yaml-workspace validate-yaml-workspace--pro validate-yaml-workspace--tabbed validate-yaml-workspace--split">
			<div class="validate-yaml-workspace-panel">
				<div
					class="validate-yaml-workspace-toolbar validate-yaml-workspace-toolbar--mobile-only"
					role="tablist"
					aria-label="Workspace views"
				>
					<button
						type="button"
						role="tab"
						id="validate-yaml-tab-editor"
						aria-selected={activeView === 'editor'}
						aria-controls="validate-yaml-panel-editor"
						class="validate-yaml-workspace-tab"
						class:validate-yaml-workspace-tab--active={activeView === 'editor'}
						on:click={() => (activeView = 'editor')}
					>
						Editor
					</button>
					<button
						type="button"
						role="tab"
						id="validate-yaml-tab-diagnostics"
						aria-selected={activeView === 'diagnostics'}
						aria-controls="validate-yaml-panel-diagnostics"
						class="validate-yaml-workspace-tab"
						class:validate-yaml-workspace-tab--active={activeView === 'diagnostics'}
						on:click={showDiagnosticsView}
					>
						Diagnostics
						{#if diagnosticsCount > 0}
							<span class="validate-yaml-workspace-tab__count">{diagnosticsCount}</span>
						{/if}
					</button>
				</div>

				<div class="validate-yaml-workspace-body">
					<div
						id="validate-yaml-panel-editor"
						role="tabpanel"
						aria-labelledby="validate-yaml-tab-editor"
						class="validate-yaml-editor-column"
						class:validate-yaml-view--hidden={!isSplitWorkspace && activeView !== 'editor'}
						aria-hidden={!isSplitWorkspace && activeView !== 'editor'}
					>
						{#if browser}
							{#if MonacoEditorCmp}
								<!-- Monaco editor loaded dynamically; instance typing is runtime-only -->
								{@const Editor = MonacoEditorCmp}
								<Editor
									bind:this={editorRef}
									bind:value={yamlInput}
									{highlightLine}
									validating={isValidating}
									completionContext={yamlCompletionContext}
									validationIssues={result?.issues ?? []}
									hideToolbarLabel
									onValidate={() => void runValidation()}
									onTruncate={() => {
										if (!yamlTruncationWarned) {
											yamlTruncationWarned = true;
											showToast('Input exceeds 512KB — truncated to the limit.');
										}
									}}
								/>
							{:else}
								<div class="monaco-yaml-editor monaco-yaml-editor--loading" aria-busy="true">
									<div class="yaml-editor-toolbar">
										<span class="yaml-editor-hint">Loading Monaco…</span>
									</div>
								</div>
							{/if}
						{/if}
					</div>

					<div
						id="validate-yaml-panel-diagnostics"
						role="tabpanel"
						aria-labelledby="validate-yaml-tab-diagnostics"
						class="validate-yaml-diagnostics-panel spec-search-results-panel"
						class:validate-yaml-view--hidden={!isSplitWorkspace && activeView !== 'diagnostics'}
						aria-hidden={!isSplitWorkspace && activeView !== 'diagnostics'}
					>
						<div class="validate-yaml-issues-header">
							{#if displayIssues.length > 0}
								<div class="validate-yaml-issues-filters validate-yaml-issues-filters--diagnostics">
									<div class="validate-yaml-filter-tabs" role="tablist" aria-label="Filter issues">
										<button
											type="button"
											role="tab"
											aria-selected={issueFilter === 'all'}
											class="validate-yaml-filter-tab"
											class:validate-yaml-filter-tab--active={issueFilter === 'all'}
											on:click={() => (issueFilter = 'all')}
										>
											All
										</button>
										<button
											type="button"
											role="tab"
											aria-selected={issueFilter === 'errors'}
											class="validate-yaml-filter-tab"
											class:validate-yaml-filter-tab--active={issueFilter === 'errors'}
											on:click={() => (issueFilter = 'errors')}
										>
											Errors
										</button>
										<button
											type="button"
											role="tab"
											aria-selected={issueFilter === 'warnings'}
											class="validate-yaml-filter-tab"
											class:validate-yaml-filter-tab--active={issueFilter === 'warnings'}
											on:click={() => (issueFilter = 'warnings')}
										>
											Warnings
										</button>
									</div>
									<label class="validate-yaml-search">
										<span class="sr-only">Search issues</span>
										<input
											type="search"
											bind:value={issueSearch}
											placeholder="Search issues…"
											class="validate-yaml-search__input"
										/>
									</label>
									{#if result && diagnosticsCount > 0}
										<span class="validate-yaml-issues-count validate-yaml-issues-count--inline">
											{filteredIssues.length === displayIssues.length
												? diagnosticsCount
												: `${filteredIssues.length}/${displayIssues.length}`}
										</span>
									{/if}
								</div>
							{/if}
						</div>

						<div class="validate-yaml-issues-body">
					{#if !result}
						<div class="spec-search-empty">
							<div class="spec-search-empty-icon" aria-hidden="true">
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" class="h-7 w-7">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="1.75"
										d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
									/>
								</svg>
							</div>
							<p class="text-sm text-slate-500 dark:text-slate-400">
								Paste YAML to validate against the selected release.
							</p>
						</div>
					{:else if displayIssues.length === 0}
						<div class="validate-yaml-success" role="status">
							<div class="validate-yaml-success__icon" aria-hidden="true">
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" class="h-6 w-6">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M5 13l4 4L19 7"
									/>
								</svg>
							</div>
							<div>
								<p class="validate-yaml-success__title">All clear</p>
								<p class="validate-yaml-success__text">
									All {result.summary.resourceCount} document{result.summary.resourceCount !== 1
										? 's'
										: ''} passed validation.
								</p>
							</div>
						</div>
					{:else if filteredIssues.length === 0}
						<div class="spec-search-empty">
							<p class="text-sm text-slate-500 dark:text-slate-400">
								No issues match the current filter.
							</p>
						</div>
					{:else}
						<div class="validate-yaml-groups">
							{#each issueGroups as group (group.key)}
								<section class="validate-yaml-group">
									<button
										type="button"
										class="validate-yaml-group__header"
										aria-expanded={!collapsedGroups.has(group.key)}
										on:click={() => toggleGroup(group.key)}
									>
										<svg
											class="validate-yaml-group__chevron"
											class:validate-yaml-group__chevron--collapsed={collapsedGroups.has(group.key)}
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
											aria-hidden="true"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M19 9l-7 7-7-7"
											/>
										</svg>
										<div class="validate-yaml-group__meta">
											<span class="validate-yaml-group__label">{group.label}</span>
											{#if group.subtitle && group.subtitle !== group.label}
												<span class="validate-yaml-group__subtitle">{group.subtitle}</span>
											{/if}
										</div>
										<div class="validate-yaml-group__counts">
											{#if group.errorCount > 0}
												<span class="validate-yaml-group__count validate-yaml-group__count--error">
													{group.errorCount}
												</span>
											{/if}
											{#if group.warningCount > 0}
												<span
													class="validate-yaml-group__count validate-yaml-group__count--warning"
												>
													{group.warningCount}
												</span>
											{/if}
										</div>
									</button>

									{#if !collapsedGroups.has(group.key)}
										<ul class="validate-yaml-issues" role="list">
											{#each group.issues as issue (issue.id)}
												{@const tone = severityTone(issue.severity)}
												{@const categoryLabel = issueCategoryLabel(issue)}
												{@const crdEntry = manifestEntryForIssue(issue)}
												<li>
													<div class="validate-yaml-issue {tone.strip}">
														<button
															type="button"
															class="validate-yaml-issue__main"
															on:click={() => jumpToIssue(issue)}
														>
															<div class="validate-yaml-issue__head">
																<span
																	class="validate-yaml-issue-severity"
																	class:validate-yaml-issue-severity--error={issue.severity === 'error'}
																	class:validate-yaml-issue-severity--warning={issue.severity === 'warning'}
																	aria-hidden="true"
																>
																	{#if issue.severity === 'error'}
																		<svg fill="currentColor" viewBox="0 0 16 16" class="validate-yaml-issue-severity__icon">
																			<path
																				d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293 5.354 4.646Z"
																			/>
																		</svg>
																	{:else if issue.severity === 'warning'}
																		<svg fill="currentColor" viewBox="0 0 16 16" class="validate-yaml-issue-severity__icon">
																			<path
																				d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"
																			/>
																		</svg>
																	{:else}
																		<svg fill="currentColor" viewBox="0 0 16 16" class="validate-yaml-issue-severity__icon">
																			<path
																				d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"
																			/>
																			<path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z" />
																		</svg>
																	{/if}
																</span>
																<span class="validate-yaml-issue-badge {tone.badge}">
																	{tone.label}
																</span>
																{#if categoryLabel}
																	<span class="validate-yaml-issue-category">{categoryLabel}</span>
																{/if}
																{#if issue.resourceKind && !group.label.includes(issue.resourceKind)}
																	<span class="validate-yaml-issue-resource">
																		{issue.resourceKind}{issue.resourceName
																			? ` / ${issue.resourceName}`
																			: ''}
																	</span>
																{/if}
																{#if issue.line}
																	<span class="validate-yaml-issue-line">L{issue.line}</span>
																{/if}
															</div>
															<p class="validate-yaml-issue-msg">{issue.message}</p>
															{#if issue.fieldPath}
																<p class="validate-yaml-issue-path">{issue.fieldPath}</p>
															{/if}
														</button>
														<div class="validate-yaml-issue__actions">
															{#if issueFixAvailable(issue)}
																<button
																	type="button"
																	class="validate-yaml-issue-fix-link"
																	class:validate-yaml-issue-ai-link={!issue.suggestedFix}
																	title={issue.suggestedFix
																		? suggestedFixLabel(issue)
																		: 'Suggest a fix with AI'}
																	on:click={(e) => handleApplyFix(issue, e)}
																>
																	Fix
																</button>
															{/if}
															{#if crdEntry}
																<button
																	type="button"
																	class="validate-yaml-issue-schema-link"
																	on:click={(e) => openCrdSchemaModal(issue, e)}
																>
																	View CRD schema →
																</button>
															{/if}
														</div>
													</div>
												</li>
											{/each}
										</ul>
									{/if}
								</section>
							{/each}
						</div>
					{/if}
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>

{#if toast}
	<div class="validate-yaml-toast" role="status">{toast}</div>
{/if}

{#if release && modalResource}
	<ResourceModal
		open={modalOpen}
		resourceDef={modalResource}
		selectedRelease={release}
		allReleases={releasesConfig.releases}
		initialVersion={modalVersion}
		onClose={closeCrdSchemaModal}
	/>
{/if}

<AiFixPreviewPanel
	open={aiFixPanelOpen}
	issue={aiFixIssue}
	loading={aiFixLoading}
	error={aiFixError}
	explanation={aiFixExplanation}
	originalYaml={aiFixOriginalYaml}
	fixedYaml={aiFixFixedYaml}
	fixable={aiFixFixable}
	applyBlockedReason={aiFixApplyBlockedReason}
	onClose={closeAiFixPanel}
	onApply={handleApplyAiFix}
/>

<FixAllReviewPanel
	open={fixAllReviewOpen}
	beforeYaml={fixAllReviewBefore}
	afterYaml={fixAllReviewAfter}
	changes={fixAllReviewChanges}
	onClose={closeFixAllReview}
	onRevert={handleRevertFixAll}
/>
