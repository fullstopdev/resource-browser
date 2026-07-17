<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import PageCredits from '$lib/components/PageCredits.svelte';
	import {
		buildOpenApiComparisonPath,
		parseOpenApiComparisonParams,
		resolveOpenApiRelease,
		type OpenApiReleasesConfig
	} from '$lib/openapi';
	import OpenApiComparisonHeader from '$lib/openapi-comparison/components/OpenApiComparisonHeader.svelte';
	import OpenApiComparisonResults from '$lib/openapi-comparison/components/OpenApiComparisonResults.svelte';
	import OpenApiReleaseSelector from '$lib/openapi-comparison/components/OpenApiReleaseSelector.svelte';
	import {
		compareOpenApiHint,
		defaultOpenApiComparisonPair,
		entryMatchesStatusFilter,
		generateOpenApiBulkDiffReport,
		matchesOpenApiSearch,
		type OpenApiBulkDiffReport,
		type OpenApiDiffStatus
	} from '$lib/openapi-comparison';
	import { loadStaticYaml } from '$lib/yaml/safeYaml';
	import openapiReleasesYaml from '$lib/openapi-releases.yaml?raw';

	const releasesConfig = loadStaticYaml(openapiReleasesYaml) as OpenApiReleasesConfig;
	const releases = releasesConfig.releases ?? [];

	let sourceReleaseName = $state('');
	let targetReleaseName = $state('');
	let generating = $state(false);
	let report = $state<OpenApiBulkDiffReport | null>(null);
	let compareError = $state('');
	/** Default matches CRD: Added / Removed / Modified (Shared + Unchanged off until toggled). */
	let statusFilter = $state<OpenApiDiffStatus[]>(['added', 'removed', 'modified']);
	let searchQuery = $state('');
	let expandedIds = $state<string[]>([]);
	let clientReady = $state(false);
	let swapping = $state(false);
	let analyzeProgress = $state(0);
	let analyzeTotal = $state(0);
	let compareGen = 0;

	const sourceRelease = $derived(
		sourceReleaseName ? resolveOpenApiRelease(releases, sourceReleaseName) : null
	);
	const targetRelease = $derived(
		targetReleaseName ? resolveOpenApiRelease(releases, targetReleaseName) : null
	);

	const canCompare = $derived(
		!!sourceRelease &&
			!!targetRelease &&
			!generating &&
			sourceReleaseName !== targetReleaseName
	);

	const hintText = $derived(
		compareOpenApiHint(canCompare, generating, sourceRelease?.label, targetRelease?.label)
	);

	const progress = $derived(
		analyzeTotal > 0 ? Math.round((analyzeProgress / analyzeTotal) * 100) : 0
	);

	const activeStep = $derived.by((): 1 | 2 | 3 => {
		if (report) return 3;
		if (generating) return 2;
		return 1;
	});

	const manifestCache = new Map();
	const specCache = new Map();

	function updateUrl() {
		if (!browser) return;
		const targetUrl = buildOpenApiComparisonPath({
			sourceRelease: sourceReleaseName || undefined,
			targetRelease: targetReleaseName || undefined
		});
		const currentUrl = `${$page.url.pathname}${$page.url.search}`;
		if (targetUrl === currentUrl) return;
		void goto(targetUrl, { replaceState: true, keepFocus: true, noScroll: true });
	}

	/** Toggle filter only — never mutates entry status or reclassifies rows. */
	function toggleStatusFilter(status: OpenApiDiffStatus) {
		if (statusFilter.includes(status)) {
			statusFilter = statusFilter.filter((s) => s !== status);
		} else {
			statusFilter = [...statusFilter, status];
		}
	}

	function swapReleases() {
		swapping = true;
		const prevSource = sourceReleaseName;
		sourceReleaseName = targetReleaseName;
		targetReleaseName = prevSource;
		report = null;
		compareError = '';
		expandedIds = [];
		updateUrl();
		setTimeout(() => {
			swapping = false;
		}, 320);
	}

	function toggleExpand(specId: string) {
		const isOpen = expandedIds.includes(specId);
		if (isOpen) {
			expandedIds = expandedIds.filter((id) => id !== specId);
			return;
		}
		expandedIds = [...expandedIds, specId];
	}

	async function runCompare() {
		if (!browser || !sourceRelease || !targetRelease) {
			compareError = 'Select source and target releases.';
			return;
		}
		if (sourceReleaseName === targetReleaseName) {
			compareError = 'Source and target releases must differ.';
			return;
		}

		const gen = ++compareGen;
		generating = true;
		compareError = '';
		report = null;
		expandedIds = [];
		analyzeProgress = 0;
		analyzeTotal = 0;

		try {
			const next = await generateOpenApiBulkDiffReport(sourceRelease, targetRelease, {
				manifestCache,
				specCache,
				onProgress: (current, total) => {
					if (gen !== compareGen) return;
					analyzeProgress = current;
					analyzeTotal = total;
				}
			});
			if (gen !== compareGen) return;
			report = next;
			updateUrl();
		} catch (err) {
			if (gen !== compareGen) return;
			compareError = err instanceof Error ? err.message : 'Comparison failed.';
		} finally {
			if (gen === compareGen) {
				generating = false;
				analyzeProgress = 0;
				analyzeTotal = 0;
			}
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
		const target = e.target as HTMLElement | null;
		if (target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.tagName === 'INPUT')
			return;
		if (!canCompare) return;
		e.preventDefault();
		void runCompare();
	}

	function filteredExpandableIds(
		current: OpenApiBulkDiffReport | null,
		filter: OpenApiDiffStatus[],
		query: string
	): string[] {
		if (!current) return [];
		return current.entries
			.filter(
				(e) => entryMatchesStatusFilter(e, filter) && matchesOpenApiSearch(e, query)
			)
			.map((e) => e.specId);
	}

	function onReleaseChange() {
		report = null;
		compareError = '';
		expandedIds = [];
		updateUrl();
	}

	onMount(async () => {
		const urlState = parseOpenApiComparisonParams($page.url.searchParams);
		const defaults = defaultOpenApiComparisonPair(releases);

		// Prefer URL, else defaults (penultimate → latest, e.g. 25.12.3 → 26.4.3).
		sourceReleaseName =
			urlState.sourceRelease && releases.some((r) => r.name === urlState.sourceRelease)
				? urlState.sourceRelease
				: defaults.sourceRelease;
		targetReleaseName =
			urlState.targetRelease && releases.some((r) => r.name === urlState.targetRelease)
				? urlState.targetRelease
				: defaults.targetRelease;

		clientReady = true;
		updateUrl();

		// Manual compare by default; only auto-run when both releases were in the URL.
		if (
			urlState.sourceRelease &&
			urlState.targetRelease &&
			urlState.sourceRelease !== urlState.targetRelease
		) {
			await runCompare();
		}
	});
</script>

<svelte:head>
	<title>EDA Resource Browser | API Comparison</title>
	<meta
		name="description"
		content="Compare Nokia EDA API Server specs between two releases — added, removed, modified, and shared APIs, endpoints, and schemas."
	/>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<div class="spec-search-page page-shell min-h-full bg-gray-50 dark:text-gray-100">
	<AppHeader fixed={false} />

	<div class="spec-search-main">
		<OpenApiComparisonHeader {activeStep} />

		<div class="spec-search-results-panel comparison-selector-panel">
			<div class="comparison-selector-panel__header">
				<h2 class="comparison-selector-panel__title">Release selectors</h2>
				<p class="comparison-selector-panel__subtitle">
					Source is the baseline; target is compared against it.
				</p>
			</div>

			<div class="comparison-selector-panel__body">
				<div class="comparison-selector-layout">
					<OpenApiReleaseSelector
						role="source"
						bind:releaseName={sourceReleaseName}
						release={sourceRelease}
						{releases}
						{swapping}
						{onReleaseChange}
					/>

					<div class="comparison-swap-wrap">
						<button
							type="button"
							onclick={swapReleases}
							disabled={!sourceReleaseName && !targetReleaseName}
							class="comparison-swap-btn"
							class:comparison-swap-btn--active={swapping}
							aria-label="Swap source and target releases"
							title="Swap source and target"
						>
							<svg
								class="comparison-swap-btn__icon"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4"
								/>
							</svg>
							<span class="comparison-swap-btn__label">Swap</span>
						</button>
					</div>

					<OpenApiReleaseSelector
						role="target"
						bind:releaseName={targetReleaseName}
						release={targetRelease}
						{releases}
						{swapping}
						{onReleaseChange}
					/>
				</div>

				<div class="comparison-action-bar">
					<div class="comparison-action-bar__status">
						{#if compareError}
							<p class="comparison-action-bar__error" role="alert">{compareError}</p>
						{:else}
							<p class="comparison-action-bar__hint">{hintText}</p>
						{/if}
					</div>

					<button
						type="button"
						onclick={runCompare}
						disabled={!canCompare}
						aria-busy={generating}
						title={canCompare ? 'Compare releases (Enter)' : hintText}
						class="comparison-compare-btn"
					>
						{#if generating}
							<svg
								class="comparison-compare-btn__spinner"
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
							<span>
								Comparing {analyzeProgress} of {analyzeTotal || '…'}
								<span class="comparison-compare-btn__pct">({progress}%)</span>
							</span>
						{:else}
							Compare releases
						{/if}
					</button>
				</div>

				{#if generating}
					<div
						class="comparison-progress"
						role="progressbar"
						aria-valuenow={progress}
						aria-valuemin="0"
						aria-valuemax="100"
						aria-label="Comparison progress"
					>
						<div class="comparison-progress__bar" style="width: {progress}%"></div>
					</div>
				{/if}
			</div>
		</div>

		{#if report}
			<OpenApiComparisonResults
				{report}
				{sourceReleaseName}
				{targetReleaseName}
				bind:statusFilter
				bind:expandedIds
				bind:searchQuery
				onToggleStatusFilter={toggleStatusFilter}
				onToggleExpand={toggleExpand}
				onExpandAll={() => {
					expandedIds = filteredExpandableIds(report, statusFilter, searchQuery);
				}}
				onCollapseAll={() => {
					expandedIds = [];
				}}
			/>
		{:else if generating}
			<div class="spec-search-results-panel">
				<div class="comparison-loading">
					{#each Array(5) as _, i (i)}
						<div
							class="comparison-skeleton comparison-skeleton--row"
							style="animation-delay: {i * 80}ms"
						></div>
					{/each}
				</div>
			</div>
		{:else if clientReady}
			<div class="spec-search-results-panel">
				<div class="spec-search-empty">
					<div class="spec-search-empty-icon">
						<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
							/>
						</svg>
					</div>
					<h3 class="text-base font-semibold text-slate-900 dark:text-slate-100">No report yet</h3>
					<p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
						Choose source and target releases, then click Compare releases to generate an API diff.
					</p>
				</div>
			</div>
		{/if}

		<PageCredits />
	</div>
</div>
