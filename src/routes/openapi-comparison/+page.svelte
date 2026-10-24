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
	import OpenApiComparisonResults from '$lib/openapi-comparison/components/OpenApiComparisonResults.svelte';
	import {
		compareOpenApiHint,
		defaultOpenApiComparisonPair,
		entryMatchesStatusFilter,
		generateOpenApiBulkDiffReport,
		matchesOpenApiSearch,
		pathChangeCounts,
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
		!!sourceRelease && !!targetRelease && !generating && sourceReleaseName !== targetReleaseName
	);

	const hintText = $derived(
		compareOpenApiHint(canCompare, generating, sourceRelease?.label, targetRelease?.label)
	);

	const progress = $derived(
		analyzeTotal > 0 ? Math.round((analyzeProgress / analyzeTotal) * 100) : 0
	);

	/** Summary tiles: API-level counts, then operation and schema changes inside changed APIs. */
	const tiles = $derived.by(() => {
		if (!report) return [];
		let opsAdded = 0;
		let opsRemoved = 0;
		let schemas = 0;
		for (const entry of report.entries) {
			const counts = pathChangeCounts(entry.pathChanges);
			opsAdded += counts.added;
			opsRemoved += counts.removed;
			const s = entry.schemaSummary;
			if (s) schemas += s.added + s.removed + s.modified;
		}
		return [
			{ label: 'APIs added', value: report.summary.added, tone: 'add' },
			{ label: 'APIs removed', value: report.summary.removed, tone: 'rem' },
			{ label: 'APIs changed', value: report.summary.modified, tone: 'mod' },
			{ label: 'Operations added', value: opsAdded, tone: 'add', sign: '+' },
			{ label: 'Operations removed', value: opsRemoved, tone: 'rem', sign: '−' },
			{ label: 'Schemas changed', value: schemas, tone: 'mod' }
		];
	});

	let shareCopied = $state(false);
	async function copyShareLink() {
		try {
			await navigator.clipboard.writeText(window.location.href);
			shareCopied = true;
			setTimeout(() => (shareCopied = false), 2000);
		} catch {
			// Clipboard refused (permissions): the address bar already holds the link.
		}
	}

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

	function filteredExpandableIds(
		current: OpenApiBulkDiffReport | null,
		filter: OpenApiDiffStatus[],
		query: string
	): string[] {
		if (!current) return [];
		return current.entries
			.filter((e) => entryMatchesStatusFilter(e, filter) && matchesOpenApiSearch(e, query))
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
	<title>Compare APIs | EDA Resource Browser</title>
	<meta
		name="description"
		content="Compare Nokia EDA API Server specs between two releases — added, removed and changed APIs, endpoints and schemas."
	/>
</svelte:head>

<div class="cmp-page oa-root page-shell min-h-full">
	<AppHeader fixed={false} />

	<main class="cmp-main">
		<p class="cmp-crumb">API <span aria-hidden="true">›</span> <b>Compare</b></p>
		<form
			class="cmp-bar"
			aria-label="Releases to compare"
			onsubmit={(e) => {
				e.preventDefault();
				if (canCompare) void runCompare();
			}}
		>
			<h1 class="cmp-title">Compare APIs</h1>
			<label class="sr-only" for="cmp-source">Source release (baseline)</label>
			<select
				id="cmp-source"
				class="cmp-select"
				bind:value={sourceReleaseName}
				onchange={onReleaseChange}
			>
				{#each releases as r (r.name)}<option value={r.name}>{r.name}</option>{/each}
			</select>
			<span class="cmp-arrow" aria-hidden="true">→</span>
			<label class="sr-only" for="cmp-target">Target release</label>
			<select
				id="cmp-target"
				class="cmp-select"
				bind:value={targetReleaseName}
				onchange={onReleaseChange}
			>
				{#each releases as r (r.name)}<option value={r.name}
						>{r.name}{r.default ? ' (latest)' : ''}</option
					>{/each}
			</select>
			<button
				type="button"
				class="cmp-btn"
				onclick={swapReleases}
				disabled={!sourceReleaseName && !targetReleaseName}
				aria-label="Swap source and target releases"
			>
				<svg viewBox="0 0 24 24" aria-hidden="true"
					><path d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" /></svg
				>
				Swap
			</button>
			<button
				type="submit"
				class="cmp-btn cmp-btn--primary"
				disabled={!canCompare}
				aria-busy={generating}
			>
				{generating ? `Comparing ${analyzeProgress} of ${analyzeTotal || '…'}` : 'Compare'}
			</button>
			{#if report}
				<button type="button" class="cmp-btn cmp-btn--quiet" onclick={copyShareLink}>
					{shareCopied ? 'Link copied' : 'Copy share link'}
				</button>
			{/if}
		</form>
		{#if compareError}
			<p class="cmp-error" role="alert">{compareError}</p>
		{:else if !report && !generating}
			<p class="cmp-hint">{hintText}</p>
		{/if}
		{#if generating}
			<div
				class="cmp-progress"
				role="progressbar"
				aria-valuenow={progress}
				aria-valuemin="0"
				aria-valuemax="100"
				aria-label="Comparison progress"
			>
				<span style="width: {progress}%"></span>
			</div>
		{/if}

		{#if report}
			<ul
				class="cmp-tiles"
				aria-label="Summary of changes from {report.sourceRelease} to {report.targetRelease}"
			>
				{#each tiles as tile (tile.label)}
					<li class="cmp-tile cmp-tile--{tile.tone}" class:cmp-tile--zero={tile.value === 0}>
						<b>{tile.value > 0 && tile.sign ? tile.sign : ''}{tile.value}</b>
						<span>{tile.label}</span>
					</li>
				{/each}
			</ul>
			<div class="cmp-results">
				<OpenApiComparisonResults
					{report}
					{sourceReleaseName}
					{targetReleaseName}
					showHeader={false}
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
			</div>
		{:else if generating}
			<div class="cmp-skeleton" aria-busy="true" aria-label="Comparing releases">
				{#each Array(6) as _, i (i)}<span></span>{/each}
			</div>
		{:else if clientReady}
			<div class="cmp-empty">
				<p class="cmp-empty__title">Pick two releases and press Compare</p>
				<p>The report lists the APIs, endpoints and schemas that were added, removed or changed.</p>
			</div>
		{/if}
	</main>

	<PageCredits />
</div>

<style>
	.cmp-page {
		background: var(--rb-bg);
		color: var(--rb-ink);
	}

	.cmp-main {
		max-width: 80rem;
		margin: 0 auto;
		padding: 1.25rem max(1rem, env(safe-area-inset-right, 0px)) 1rem
			max(1rem, env(safe-area-inset-left, 0px));
	}

	@media (min-width: 1024px) {
		.cmp-main {
			padding-left: 2rem;
			padding-right: 2rem;
		}
	}

	.cmp-crumb {
		margin: 0 0 0.375rem;
		font: 500 0.75rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	.cmp-crumb b {
		font-weight: 500;
		color: var(--rb-ink-2);
	}

	.cmp-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.625rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--rb-line);
	}

	.cmp-title {
		margin: 0 0.75rem 0 0;
		font-family: var(--rb-font-display);
		font-size: clamp(1.3rem, 2.4vw, 1.6rem);
		font-weight: 700;
		letter-spacing: -0.015em;
		flex-basis: auto;
	}

	.cmp-select {
		height: 2.375rem;
		padding: 0 2rem 0 0.75rem;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.5rem;
		background-color: var(--rb-surface);
		color: var(--rb-ink);
		font: 600 0.875rem var(--rb-font-mono);
	}

	.cmp-arrow {
		color: var(--rb-ink-3);
		font-family: var(--rb-font-mono);
	}

	.cmp-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		height: 2.375rem;
		padding: 0 0.875rem;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.5rem;
		background: var(--rb-surface);
		color: var(--rb-ink);
		font: 600 0.85rem var(--rb-font);
		cursor: pointer;
	}

	.cmp-btn svg {
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.cmp-btn:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.cmp-btn--primary {
		border-color: transparent;
		background: var(--rb-signal);
		color: var(--rb-signal-ink);
	}

	.cmp-btn--quiet {
		margin-left: auto;
	}

	.cmp-select:focus-visible,
	.cmp-btn:focus-visible {
		outline: 2px solid var(--rb-signal);
		outline-offset: 1px;
	}

	.cmp-hint,
	.cmp-error {
		margin: 0.625rem 0 0;
		font-size: 0.85rem;
		color: var(--rb-ink-3);
	}

	.cmp-error {
		color: var(--rb-removed);
	}

	.cmp-progress {
		height: 3px;
		margin-top: 0.75rem;
		border-radius: 2px;
		background: var(--rb-raised);
		overflow: hidden;
	}

	.cmp-progress span {
		display: block;
		height: 100%;
		background: var(--rb-signal);
		transition: width 0.2s;
	}

	.cmp-tiles {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.625rem;
		margin: 1.25rem 0 0.5rem;
		padding: 0;
		list-style: none;
	}

	@media (min-width: 720px) {
		.cmp-tiles {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	@media (min-width: 1100px) {
		.cmp-tiles {
			grid-template-columns: repeat(6, minmax(0, 1fr));
		}
	}

	.cmp-tile {
		display: grid;
		gap: 0.125rem;
		padding: 0.75rem 0.875rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.625rem;
		background: var(--rb-surface);
	}

	.cmp-tile b {
		font: 700 1.6rem/1.1 var(--rb-font-mono);
		font-variant-numeric: tabular-nums;
	}

	.cmp-tile span {
		font-size: 0.8rem;
		color: var(--rb-ink-3);
	}

	.cmp-tile--add b {
		color: var(--rb-ok);
	}
	.cmp-tile--rem b {
		color: var(--rb-removed);
	}
	.cmp-tile--mod b {
		color: var(--rb-signal);
	}
	.cmp-tile--zero b {
		color: var(--rb-ink-3);
	}

	.cmp-skeleton {
		display: grid;
		gap: 0.5rem;
		margin-top: 1.25rem;
	}

	.cmp-skeleton span {
		height: 3rem;
		border-radius: 0.625rem;
		background: var(--rb-raised);
	}

	.cmp-empty {
		padding: 3rem 1rem;
		text-align: center;
		color: var(--rb-ink-3);
		font-size: 0.9rem;
	}

	.cmp-empty p {
		margin: 0.25rem 0;
	}

	.cmp-empty__title {
		font-weight: 600;
		font-size: 1rem;
		color: var(--rb-ink);
	}

	/* Results: flatten the shared comparison panels onto the site tokens. */
	.cmp-results :global(.comparison-results) {
		margin-top: 0.75rem;
		border: 0;
		box-shadow: none;
		background: none;
	}

	/* The results panel clips overflow, so a sticky bar would sit 4rem down inside it. */
	.cmp-results :global(.comparison-results__sticky-toolbar) {
		position: static;
		background: none;
		backdrop-filter: none;
		border-bottom: 0;
		padding-left: 0;
		padding-right: 0;
	}

	.cmp-results :global(.comparison-crd-card) {
		border-color: var(--rb-line);
		background: var(--rb-surface);
		box-shadow: none;
	}

	.cmp-results :global(.comparison-crd-card__change-count) {
		color: var(--rb-ink-3);
	}

	/* Diff-style gutters on endpoint changes. */
	.cmp-results :global(.oa-diff-detail__op) {
		border-left: 3px solid transparent;
		padding-left: 0.5rem;
	}

	.cmp-results :global(.oa-diff-detail__op:has(.oa-diff-detail__op-badge--added)) {
		border-left-color: var(--rb-ok);
		background: color-mix(in srgb, var(--rb-ok-soft) 60%, transparent);
	}

	.cmp-results :global(.oa-diff-detail__op:has(.oa-diff-detail__op-badge--removed)) {
		border-left-color: var(--rb-removed);
		background: color-mix(in srgb, var(--rb-removed) 8%, transparent);
	}

	.cmp-results :global(.oa-diff-detail__op:has(.oa-diff-detail__op-badge--modified)) {
		border-left-color: var(--rb-signal);
	}

	@media (prefers-reduced-motion: reduce) {
		.cmp-progress span {
			transition: none;
		}
	}
</style>
