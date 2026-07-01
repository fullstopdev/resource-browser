<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import PageCredits from '$lib/components/PageCredits.svelte';
	import ResourceModal from '$lib/components/ResourceModal.svelte';
	import ReleaseNotesHeader from '$lib/release-notes/components/ReleaseNotesHeader.svelte';
	import ReleaseNotesSidebar from '$lib/release-notes/components/ReleaseNotesSidebar.svelte';
	import { countDeprecatedApiVersions } from '$lib/release-notes/deprecation';
	import HighlightText from '$lib/release-notes/HighlightText.svelte';
	import {
		catalogBrowseHref,
		changeTypeBadgeClass,
		changeTypeLabel,
		filterDeprecatedItems,
		filterModifiedResources,
		filterNewResources,
		groupModifiedByOperationalArea,
		groupNewResourcesByKind,
		groupNewResourcesByOperationalArea,
		humanizeFieldPath,
		inferReleaseTone,
		partitionFieldChanges,
		sortFieldChanges
	} from '$lib/release-notes/presentation';
	import type { ReleaseNotesEntry, ReleaseNotesSummary } from '$lib/release-notes/types';
	import { normalizeReleaseNotesEntry, resolveInitialReleaseSelection } from '$lib/release-notes/loadStatic';
	import { fetchManifest, getManifestCache, type ManifestResource } from '$lib/manifest';
	import { getLatestVersion } from '$lib/versions';
	import releasesYaml from '$lib/releases.yaml?raw';
	import { loadStaticYaml } from '$lib/yaml/safeYaml';
	import type { CrdResource, EdaRelease, ReleasesConfig } from '$lib/structure';

	let { data } = $props();

	const releasesConfig = loadStaticYaml(releasesYaml) as ReleasesConfig;
	const manifestCache = getManifestCache();

	let selected = $state(resolveInitialReleaseSelection(data.releaseHistory, data.index?.latest));
	let filterQuery = $state('');
	let modalOpen = $state(false);
	let modalResource: CrdResource | null = $state(null);
	let modalVersion: string | null = $state(null);
	let manifestResources: ManifestResource[] = $state([]);

	const releaseHistory = $derived(data.releaseHistory);
	const selectedEntry = $derived(releaseHistory.find((e) => e.toVer === selected) ?? null);
	const selectedSummary = $derived(
		selectedEntry?.summary ?? (selectedEntry ? fallbackEntrySummary(selectedEntry) : null)
	);
	const selectedRelease = $derived(
		selectedEntry ? releasesConfig.releases.find((r) => r.name === selectedEntry.toVer) ?? null : null
	);
	const latestVersion = $derived(data.index?.latest ?? selected);

	const summaryCards = $derived(
		selectedSummary
			? [
					{ key: 'added', label: 'Added', count: selectedSummary.added, section: 'section-added' },
					{
						key: 'removed',
						label: 'Removed',
						count: selectedSummary.removed,
						section: 'section-removed'
					},
					{
						key: 'modified',
						label: 'Modified',
						count: selectedSummary.modified,
						section: 'section-modified'
					},
					{
						key: 'deprecated',
						label: 'Deprecated',
						count: selectedSummary.deprecated,
						section: 'section-deprecated'
					},
					{
						key: 'unchanged',
						label: 'Unchanged',
						count: selectedSummary.unchanged,
						section: 'section-unchanged'
					}
				]
			: []
	);

	function fallbackEntrySummary(entry: ReleaseNotesEntry): ReleaseNotesSummary {
		return normalizeReleaseNotesEntry(entry).summary!;
	}

	$effect(() => {
		if (!browser) return;
		const params = new URLSearchParams(window.location.search);
		const fromUrl = params.get('v') ?? params.get('release');
		if (fromUrl && releaseHistory.some((e) => e.toVer === fromUrl)) {
			selected = fromUrl;
		}
	});

	$effect(() => {
		if (selectedEntry?.toVer) {
			void loadManifestForSelected();
		}
	});

	function selectRelease(toVer: string) {
		selected = toVer;
		filterQuery = '';
		const url = new URL($page.url);
		url.searchParams.set('v', toVer);
		void goto(url.pathname + url.search, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function scrollToSection(sectionId: string) {
		document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function releaseTone(entry: ReleaseNotesEntry): 'low' | 'medium' | 'high' {
		return inferReleaseTone(entry.fromVer, entry.toVer);
	}

	function overviewText(entry: ReleaseNotesEntry): string {
		const summary = entry.summary ?? fallbackEntrySummary(entry);
		const { fromVer, toVer } = entry;
		const parts: string[] = [];
		if (summary.added > 0) parts.push(`${summary.added} added`);
		if (summary.removed > 0) parts.push(`${summary.removed} removed`);
		if (summary.modified > 0) parts.push(`${summary.modified} modified CRDs`);
		if (summary.specChanges > 0) parts.push(`${summary.specChanges} spec field changes`);
		if (summary.deprecated > 0) parts.push(`${summary.deprecated} deprecated apiVersions`);
		if (parts.length === 0) {
			return `No CRD schema changes between EDA ${fromVer} and ${toVer}.`;
		}
		return `${parts.join(' · ')}.`;
	}

	async function loadManifestForSelected() {
		if (!selectedEntry || !selectedRelease) return;
		manifestResources = (await fetchManifest(selectedRelease.folder, manifestCache)) || [];
	}

	function resolveCrdResource(kind: string, group?: string, crdName?: string): CrdResource | null {
		if (crdName) {
			const byName = manifestResources.find((r) => r.name === crdName);
			if (byName) return byName as CrdResource;
		}
		if (group) {
			const byGroup = manifestResources.find((r) => r.kind === kind && r.group === group);
			if (byGroup) return byGroup as CrdResource;
		}
		const byKind = manifestResources.find((r) => r.kind === kind);
		return (byKind as CrdResource | undefined) ?? null;
	}

	async function openKindModal(kind: string, group?: string, crdName?: string, event?: Event) {
		event?.stopPropagation();
		if (!selectedRelease) return;
		await loadManifestForSelected();
		const resource = resolveCrdResource(kind, group, crdName);
		if (!resource) return;
		modalResource = resource;
		modalVersion = getLatestVersion(resource);
		modalOpen = true;
	}

	function closeKindModal() {
		modalOpen = false;
		modalResource = null;
		modalVersion = null;
	}

	function filteredNew(entry: ReleaseNotesEntry) {
		return groupNewResourcesByKind(filterNewResources(entry.notes.newResources, filterQuery));
	}

	function filteredRemoved(entry: ReleaseNotesEntry) {
		const q = filterQuery.trim().toLowerCase();
		if (!q) return entry.notes.removedResources;
		return entry.notes.removedResources.filter(
			(r) => r.kind.toLowerCase().includes(q) || r.apiVersion.toLowerCase().includes(q)
		);
	}

	function filteredModified(entry: ReleaseNotesEntry) {
		return groupModifiedByOperationalArea(
			filterModifiedResources(entry.notes.modifiedResources, filterQuery)
		);
	}

	function filteredDeprecated(entry: ReleaseNotesEntry) {
		return filterDeprecatedItems(entry.notes.deprecated, filterQuery);
	}

	function entrySummary(entry: ReleaseNotesEntry): ReleaseNotesSummary {
		return entry.summary ?? fallbackEntrySummary(entry);
	}

	function hasVisibleChanges(summary: ReleaseNotesSummary): boolean {
		return summary.added + summary.removed + summary.modified + summary.deprecated > 0;
	}

	function sectionIcon(status: string): string {
		if (status === 'added') return 'M12 4v16m8-8H4';
		if (status === 'removed') return 'M20 12H4';
		if (status === 'modified') {
			return 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z';
		}
		if (status === 'deprecated') {
			return 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z';
		}
		return 'M5 13l4 4L19 7';
	}
</script>

<svelte:head>
	<title>EDA Resource Browser | Release Changes</title>
	<meta
		name="description"
		content="Pre-computed release changes for Nokia EDA upgrades — CRD additions, removals, schema changes, and deprecations between consecutive releases."
	/>
</svelte:head>

<div class="spec-search-page page-shell min-h-full bg-gray-50 dark:text-gray-100">
	<AppHeader fixed={false} />

	<div class="spec-search-main">
		<ReleaseNotesHeader />

		{#if data.error}
			<div
				class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
				role="alert"
			>
				{data.error}
			</div>
		{:else if releaseHistory.length === 0}
			<div class="spec-search-results-panel">
				<div class="spec-search-empty">
					<span class="spec-search-empty-icon" aria-hidden="true">
						<svg class="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
					</span>
					<p class="text-sm font-medium text-slate-700 dark:text-slate-200">No release changes available</p>
					<p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
						Run <code class="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs dark:bg-slate-800"
							>npm run generate:release-notes</code
						> to build the release changes bundle.
					</p>
				</div>
			</div>
		{:else}
			<div class="spec-search-results-panel release-notes-panel">
				<div class="release-notes-grid">
					<ReleaseNotesSidebar
						{releaseHistory}
						{selected}
						{latestVersion}
						onSelect={selectRelease}
						{entrySummary}
						{hasVisibleChanges}
						{releaseTone}
					/>

					<div class="release-notes-main min-w-0">
						{#if selectedEntry && selectedRelease && selectedSummary}
							<div class="comparison-results__header border-b border-gray-200 dark:border-gray-700/60">
								<div>
									<h2 class="comparison-results__title">Release step</h2>
									<div class="comparison-results__release-pills">
										<span class="comparison-release-pill comparison-release-pill--source">
											EDA {selectedEntry.fromVer}
										</span>
										<svg
											class="comparison-results__arrow"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
											aria-hidden="true"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M17 8l4 4m0 0l-4 4m4-4H3"
											/>
										</svg>
										<span class="comparison-release-pill comparison-release-pill--target">
											EDA {selectedEntry.toVer}
										</span>
									</div>
									<p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
										{overviewText(selectedEntry)}
									</p>
								</div>
							</div>

							<div class="border-b border-gray-200 px-3 py-2 dark:border-gray-700/60 sm:px-4">
								<div class="comparison-summary" role="group" aria-label="Release summary">
									{#each summaryCards as card (card.key)}
										<button
											type="button"
											class="comparison-summary-card comparison-summary-card--{card.key}"
											class:comparison-summary-card--disabled={card.count === 0}
											disabled={card.count === 0}
											onclick={() => scrollToSection(card.section)}
										>
											<span class="comparison-summary-card__count">{card.count}</span>
											<span class="comparison-summary-card__label">{card.label}</span>
										</button>
									{/each}
								</div>
							</div>

							<div class="comparison-results__sticky-toolbar">
								<div class="comparison-results__search-row">
									<div class="comparison-results__search">
										<svg
											class="comparison-results__search-icon"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
											aria-hidden="true"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
											/>
										</svg>
										<input
											id="rn-filter"
											class="comparison-results__search-input"
											type="search"
											placeholder="Filter by kind, group, field…"
											bind:value={filterQuery}
										/>
										{#if filterQuery.trim()}
											<button
												type="button"
												aria-label="Clear filter"
												class="comparison-results__search-clear"
												onclick={() => (filterQuery = '')}
											>
												<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M6 18L18 6M6 6l12 12"
													/>
												</svg>
											</button>
										{/if}
									</div>
								</div>
							</div>

							<div class="comparison-results__sections">
								{#if selectedSummary.added > 0}
									<details id="section-added" class="release-notes-section">
										<summary class="comparison-results__section-header">
											<div
												class="comparison-results__section-icon comparison-results__section-icon--added"
											>
												<svg
													class="h-4 w-4"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													aria-hidden="true"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d={sectionIcon('added')}
													/>
												</svg>
											</div>
											<div>
												<h3 class="comparison-results__section-title">Added CRDs</h3>
												<p class="comparison-results__section-desc">New resources in this release</p>
											</div>
											<span class="comparison-results__section-count">{selectedSummary.added}</span>
										</summary>
										<div class="release-notes-section-body">
											{#each groupNewResourcesByOperationalArea(filteredNew(selectedEntry)) as group (group.area)}
												<div class="mb-2 last:mb-0">
													<h4 class="release-notes-area-label">{group.area}</h4>
													<div class="release-notes-table-wrap">
														<table class="release-notes-table release-notes-table--added">
															<thead>
																<tr>
																	<th class="release-notes-table__col-kind">Kind</th>
																	<th class="release-notes-table__col-group">API group</th>
																	<th class="release-notes-table__col-description">Description</th>
																	<th class="release-notes-table__col-versions">Versions</th>
																	<th class="release-notes-table__col-link">Link</th>
																</tr>
															</thead>
															<tbody>
																{#each group.resources as resource (resource.kind)}
																	<tr>
																		<td class="release-notes-table__col-kind">
																			<button
																				type="button"
																				class="release-notes-kind-btn whitespace-nowrap"
																				onclick={() =>
																					openKindModal(
																						resource.kind,
																						resource.group,
																						resource.crdName
																					)}
																			>
																				<HighlightText
																					text={resource.kind}
																					query={filterQuery}
																				/>
																			</button>
																		</td>
																		<td class="release-notes-table__col-group">
																			<span class="release-notes-field-path">
																				<HighlightText
																					text={resource.group}
																					query={filterQuery}
																				/>
																			</span>
																		</td>
																		<td class="release-notes-table__col-description release-notes-cell-muted">
																			<HighlightText
																				text={resource.description}
																				query={filterQuery}
																			/>
																		</td>
																		<td class="release-notes-table__col-versions">
																			{#each resource.apiVersions as version (version.apiVersion)}
																				<span class="release-notes-mono-badge"
																					>{version.apiVersion}</span
																				>
																			{/each}
																		</td>
																		<td class="release-notes-table__col-link">
																			<a
																				class="release-notes-browse-link"
																				href={catalogBrowseHref(
																					selectedEntry.toVer,
																					resource.crdName
																				)}
																			>
																				Browse
																			</a>
																		</td>
																	</tr>
																{/each}
															</tbody>
														</table>
													</div>
												</div>
											{/each}
										</div>
									</details>
								{/if}

								{#if selectedSummary.removed > 0}
									<details id="section-removed" class="release-notes-section">
										<summary class="comparison-results__section-header">
											<div
												class="comparison-results__section-icon comparison-results__section-icon--removed"
											>
												<svg
													class="h-4 w-4"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													aria-hidden="true"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d={sectionIcon('removed')}
													/>
												</svg>
											</div>
											<div>
												<h3 class="comparison-results__section-title">Removed CRDs</h3>
												<p class="comparison-results__section-desc">Resources dropped in this step</p>
											</div>
											<span class="comparison-results__section-count"
												>{selectedSummary.removed}</span
											>
										</summary>
										<div class="release-notes-section-body">
											<div class="release-notes-table-wrap">
												<table class="release-notes-table release-notes-table--removed">
													<thead>
														<tr>
															<th class="release-notes-table__col-kind">Kind</th>
															<th class="release-notes-table__col-versions">API version</th>
															<th class="release-notes-table__col-reason">Reason</th>
														</tr>
													</thead>
													<tbody>
														{#each filteredRemoved(selectedEntry) as resource (`${resource.kind}-${resource.apiVersion}`)}
															<tr>
																<td class="release-notes-table__col-kind">
																	<span class="font-semibold">
																		<HighlightText
																			text={resource.kind}
																			query={filterQuery}
																		/>
																	</span>
																</td>
																<td class="release-notes-table__col-versions">
																	<span class="release-notes-mono-badge"
																		>{resource.apiVersion}</span
																	>
																</td>
																<td class="release-notes-table__col-reason release-notes-cell-muted"
																	>{resource.reason}</td
																>
															</tr>
														{/each}
													</tbody>
												</table>
											</div>
										</div>
									</details>
								{/if}

								{#if selectedSummary.modified > 0}
									<details id="section-modified" class="release-notes-section">
										<summary class="comparison-results__section-header">
											<div
												class="comparison-results__section-icon comparison-results__section-icon--modified"
											>
												<svg
													class="h-4 w-4"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													aria-hidden="true"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d={sectionIcon('modified')}
													/>
												</svg>
											</div>
											<div>
												<h3 class="comparison-results__section-title">Modified CRDs</h3>
												<p class="comparison-results__section-desc">Operational schema field changes</p>
											</div>
											<span class="comparison-results__section-count"
												>{selectedSummary.modified}</span
											>
										</summary>
										<div class="release-notes-section-body">
											{#each filteredModified(selectedEntry) as group (group.area)}
												<div class="mb-2 last:mb-0">
													<h4 class="release-notes-area-label">{group.area}</h4>
													<div class="release-notes-table-wrap">
														<table class="release-notes-table release-notes-table--modified">
															<thead>
																<tr>
																	<th class="release-notes-table__col-kind">Kind</th>
																	<th class="release-notes-table__col-count">#</th>
																	<th class="release-notes-table__col-field">Field</th>
																	<th class="release-notes-table__col-type">Type</th>
																	<th class="release-notes-table__col-diff">Before → After</th>
																</tr>
															</thead>
															<tbody>
																{#each group.resources as resource (resource.kind)}
																	{@const changes = sortFieldChanges(
																		partitionFieldChanges(resource.changes).operational,
																		'severity'
																	)}
																	{#if changes.length > 0}
																		{#each changes as change, i (`${resource.kind}-${change.field}-${i}`)}
																			<tr>
																				{#if i === 0}
																					<td
																						class="release-notes-table__col-kind"
																						rowspan={changes.length}
																					>
																						<button
																							type="button"
																							class="release-notes-kind-btn whitespace-nowrap"
																							onclick={(e) =>
																								openKindModal(
																									resource.kind,
																									undefined,
																									undefined,
																									e
																								)}
																						>
																							{resource.kind}
																						</button>
																					</td>
																					<td
																						class="release-notes-table__col-count release-notes-count"
																						rowspan={changes.length}
																					>
																						{changes.length}
																					</td>
																				{/if}
																				<td class="release-notes-table__col-field">
																					<span class="release-notes-field-label">
																						<HighlightText
																							text={humanizeFieldPath(change.field)}
																							query={filterQuery}
																						/>
																					</span>
																					<code class="release-notes-field-path"
																						>{change.field}</code
																					>
																				</td>
																				<td class="release-notes-table__col-type">
																					<span class={changeTypeBadgeClass(change.changeType)}>
																						{changeTypeLabel(change.changeType)}
																					</span>
																				</td>
																				<td class="release-notes-table__col-diff">
																					{#if change.before || change.after}
																						<span class="release-notes-diff">
																							<span class="release-notes-diff__before"
																								>{change.before || '—'}</span
																							>
																							<span class="release-notes-diff__arrow"
																								>→</span
																							>
																							<span class="release-notes-diff__after"
																								>{change.after || '—'}</span
																							>
																						</span>
																					{:else}
																						<span class="release-notes-cell-muted">—</span>
																					{/if}
																				</td>
																			</tr>
																		{/each}
																	{/if}
																{/each}
															</tbody>
														</table>
													</div>
												</div>
											{/each}
										</div>
									</details>
								{/if}

								{#if selectedSummary.deprecated > 0}
									<details id="section-deprecated" class="release-notes-section">
										<summary class="comparison-results__section-header">
											<div class="comparison-results__section-icon comparison-results__section-icon--modified">
												<svg
													class="h-4 w-4"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													aria-hidden="true"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d={sectionIcon('deprecated')}
													/>
												</svg>
											</div>
											<div>
												<h3 class="comparison-results__section-title">apiVersion migrations</h3>
												<p class="comparison-results__section-desc">Deprecated versions and targets</p>
											</div>
											<span class="comparison-results__section-count"
												>{countDeprecatedApiVersions(selectedEntry.notes.deprecated)}</span
											>
										</summary>
										<div class="release-notes-section-body">
											<div class="release-notes-table-wrap">
												<table class="release-notes-table release-notes-table--deprecated">
													<thead>
														<tr>
															<th class="release-notes-table__col-kind">Kind</th>
															<th class="release-notes-table__col-group">API group</th>
															<th class="release-notes-table__col-migration">Migration</th>
															<th class="release-notes-table__col-versions">Versions</th>
														</tr>
													</thead>
													<tbody>
														{#each filteredDeprecated(selectedEntry) as item (item.crdName)}
															<tr>
																<td class="release-notes-table__col-kind">
																	<button
																		type="button"
																		class="release-notes-kind-btn whitespace-nowrap"
																		onclick={() =>
																			openKindModal(item.kind, item.group, item.crdName)}
																	>
																		<HighlightText text={item.kind} query={filterQuery} />
																	</button>
																</td>
																<td class="release-notes-table__col-group">
																	<span class="release-notes-field-path">
																		<HighlightText text={item.group} query={filterQuery} />
																	</span>
																</td>
																<td class="release-notes-table__col-migration release-notes-cell-muted"
																	>{item.migrationPath}</td
																>
																<td class="release-notes-table__col-versions">
																	<div class="flex flex-wrap items-center gap-0.5">
																		{#each item.deprecatedVersions as version (version.apiVersion)}
																			<span class="release-notes-version-badge release-notes-version-badge--deprecated">
																				{version.apiVersion}
																				{#if version.newInRelease}
																					<span class="release-notes-version-badge__tag"
																						>new</span
																					>
																				{/if}
																			</span>
																		{/each}
																		{#if item.recommendedApiVersion}
																			<span class="release-notes-diff__arrow" aria-hidden="true"
																				>→</span
																			>
																			<span
																				class="release-notes-version-badge release-notes-version-badge--stable"
																			>
																				{item.recommendedApiVersion}
																				{#if item.newlyPromotedApiVersion === item.recommendedApiVersion}
																					<span class="release-notes-version-badge__tag"
																						>stable</span
																					>
																				{/if}
																			</span>
																		{/if}
																	</div>
																</td>
															</tr>
														{/each}
													</tbody>
												</table>
											</div>
										</div>
									</details>
								{/if}

								{#if !hasVisibleChanges(selectedSummary)}
									<section id="section-unchanged" class="px-3 py-4 text-center sm:px-4">
										<p class="text-sm text-slate-600 dark:text-slate-300">
											No CRD schema changes in this release step.
										</p>
										<p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
											{selectedSummary.unchanged} CRDs unchanged at latest version.
										</p>
									</section>
								{:else if selectedSummary.unchanged > 0}
									<details id="section-unchanged" class="release-notes-section">
										<summary class="comparison-results__section-header">
											<div
												class="comparison-results__section-icon comparison-results__section-icon--unchanged"
											>
												<svg
													class="h-4 w-4"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													aria-hidden="true"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d={sectionIcon('unchanged')}
													/>
												</svg>
											</div>
											<div>
												<h3 class="comparison-results__section-title">Unchanged CRDs</h3>
												<p class="comparison-results__section-desc">No schema diff at latest version</p>
											</div>
											<span class="comparison-results__section-count"
												>{selectedSummary.unchanged}</span
											>
										</summary>
										<div class="release-notes-section-body">
											<p class="text-xs text-slate-500 dark:text-slate-400">
												{selectedSummary.unchanged} CRDs had no schema diff between {selectedEntry.fromVer}
												and {selectedEntry.toVer}.
											</p>
										</div>
									</details>
								{/if}
							</div>
						{:else}
							<div class="spec-search-empty py-10">
								<p class="text-sm text-slate-500 dark:text-slate-400">
									Select a release from the timeline.
								</p>
							</div>
						{/if}
					</div>
				</div>
			</div>

			<PageCredits />
		{/if}
	</div>
</div>

{#if modalOpen && modalResource && selectedRelease}
	<ResourceModal
		open={modalOpen}
		resourceDef={modalResource}
		selectedRelease={selectedRelease}
		allReleases={releasesConfig.releases}
		initialVersion={modalVersion}
		onClose={closeKindModal}
	/>
{/if}
