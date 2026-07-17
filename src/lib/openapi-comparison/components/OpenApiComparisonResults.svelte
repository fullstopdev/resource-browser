<script lang="ts">
	import OpenApiMethodBadge from '$lib/openapi/components/OpenApiMethodBadge.svelte';
	import DiffDetailModal from '$lib/comparison/components/DiffDetailModal.svelte';
	import OpenApiSchemaDiffPanel from './OpenApiSchemaDiffPanel.svelte';
	import type {
		OpenApiBulkDiffReport,
		OpenApiDiffEntry,
		OpenApiDiffStatus,
		OpenApiPathChange
	} from '$lib/openapi/types';
	import {
		buildDiffDetailLine,
		findDetailLineIndex,
		parseDiffLine,
		syntheticPathDetailLine,
		type DiffDetailModalPayload
	} from '$lib/comparison/diffDetails';
	import {
		STATUS_FILTERS,
		STATUS_SECTIONS,
		displayOpenApiStatus,
		statusChipClass,
		sectionIconModifier,
		matchesOpenApiSearch,
		entryMatchesStatusFilter,
		buildOpenApiDiffSpecHref,
		entryChangeMetricsLabel,
		groupPathChanges,
		groupSchemaChanges,
		pathChangeCounts,
		statusLabel,
		entrySpecIdLabel,
		versionBumpLabel,
		opFieldRowsFromDetails,
		opFieldChangeBadgeClass,
		type OpenApiOpFieldRow
	} from '$lib/openapi-comparison';

	let {
		report,
		sourceReleaseName = '',
		targetReleaseName = '',
		statusFilter = $bindable<OpenApiDiffStatus[]>(['added', 'removed', 'modified']),
		expandedIds = $bindable<string[]>([]),
		searchQuery = $bindable(''),
		onToggleStatusFilter = (_status: OpenApiDiffStatus) => {},
		onToggleExpand = (_specId: string) => {},
		onExpandAll = () => {},
		onCollapseAll = () => {}
	}: {
		report: OpenApiBulkDiffReport;
		sourceReleaseName?: string;
		targetReleaseName?: string;
		statusFilter?: OpenApiDiffStatus[];
		expandedIds?: string[];
		searchQuery?: string;
		onToggleStatusFilter?: (status: OpenApiDiffStatus) => void;
		onToggleExpand?: (specId: string) => void;
		onExpandAll?: () => void;
		onCollapseAll?: () => void;
	} = $props();

	const summaryCounts = $derived(report.summary);

	function statusCount(status: OpenApiDiffStatus): number {
		if (status === 'added') return summaryCounts.added;
		if (status === 'removed') return summaryCounts.removed;
		if (status === 'modified') return summaryCounts.modified;
		if (status === 'unchanged') return summaryCounts.unchanged;
		if (status === 'shared') return summaryCounts.shared;
		if (status === 'error') return summaryCounts.error;
		return 0;
	}

	const filteredEntries = $derived(
		report.entries.filter(
			(entry) =>
				entryMatchesStatusFilter(entry, statusFilter) && matchesOpenApiSearch(entry, searchQuery)
		)
	);

	const groupedSections = $derived(
		STATUS_SECTIONS.map((section) => ({
			...section,
			entries: filteredEntries.filter(
				(e) => displayOpenApiStatus(e.status) === section.status
			)
		})).filter((s) => s.entries.length > 0)
	);

	const allExpanded = $derived(
		filteredEntries.length > 0 && filteredEntries.every((e) => expandedIds.includes(e.specId))
	);

	function sectionIcon(icon: string): string {
		if (icon === 'plus') return 'M12 4v16m8-8H4';
		if (icon === 'minus') return 'M20 12H4';
		if (icon === 'pencil') {
			return 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z';
		}
		return 'M5 13l4 4L19 7';
	}

	function changeCountLabel(entry: OpenApiDiffEntry): string {
		if (entry.detailsLoaded) {
			return entryChangeMetricsLabel(pathChangeCounts(entry.pathChanges), entry.schemaSummary);
		}
		const display = displayOpenApiStatus(entry.status);
		if (display === 'shared' || display === 'unchanged') return 'No changes';
		return entryChangeMetricsLabel(pathChangeCounts(entry.pathChanges), entry.schemaSummary);
	}

	function pathDeltaLabel(entry: OpenApiDiffEntry): string {
		const from = entry.sourcePathCount;
		const to = entry.targetPathCount;
		if (from == null && to == null) return '';
		if (from == null) return `${to} paths`;
		if (to == null) return `${from} paths`;
		const delta = to - from;
		const deltaText = delta === 0 ? '' : delta > 0 ? ` (+${delta})` : ` (${delta})`;
		return `${from} → ${to} paths${deltaText}`;
	}

	function handleHeaderKeydown(event: KeyboardEvent, specId: string) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onToggleExpand(specId);
		}
	}

	function operationHref(entry: OpenApiDiffEntry, pc: OpenApiPathChange): string {
		const useSource = entry.status === 'removed' || pc.changeType === 'removed';
		const release = useSource ? sourceReleaseName : targetReleaseName;
		const specId = useSource ? (entry.sourceSpecId ?? entry.specId) : entry.specId;
		return buildOpenApiDiffSpecHref(specId, release, {
			operationId: pc.operationId
		});
	}

	let shareCopied = $state(false);
	let shareCopiedTimeout: ReturnType<typeof setTimeout> | null = null;

	let diffModalOpen = $state(false);
	let diffModalPayload = $state<DiffDetailModalPayload | null>(null);

	function releaseLabels(): { sourceLabel: string; targetLabel: string } {
		return {
			sourceLabel: sourceReleaseName || report.sourceRelease,
			targetLabel: targetReleaseName || report.targetRelease
		};
	}

	function openDiffModal(payload: DiffDetailModalPayload) {
		diffModalPayload = { eyebrow: 'API diff', ...payload };
		diffModalOpen = true;
	}

	function closeDiffModal() {
		diffModalOpen = false;
		diffModalPayload = null;
	}

	function openOperationModal(entry: OpenApiDiffEntry, pc: OpenApiPathChange) {
		const labels = releaseLabels();
		const details =
			pc.details.length > 0
				? pc.details
				: pc.changeType === 'added' || pc.changeType === 'removed'
					? [syntheticPathDetailLine(pc.changeType, pc.path)]
					: [];
		openDiffModal({
			title: `${pc.method.toUpperCase()} ${pc.path}`,
			subtitle: pc.operationId,
			changeKind: pc.changeType,
			...labels,
			details,
			secondaryAction: {
				href: operationHref(entry, pc),
				label: 'Open in API browser'
			}
		});
	}

	function openFieldModal(
		entry: OpenApiDiffEntry,
		pc: OpenApiPathChange | null,
		fieldRow: OpenApiOpFieldRow,
		schemaName?: string,
		schemaDetails?: string[]
	) {
		const labels = releaseLabels();
		const detail = buildDiffDetailLine({
			field: fieldRow.field,
			kind: fieldRow.kind,
			before: fieldRow.before,
			after: fieldRow.after
		});
		const parentDetails = pc?.details ?? schemaDetails ?? [];
		const parsed = parseDiffLine(detail);
		openDiffModal({
			title: fieldRow.field,
			subtitle: fieldRow.label,
			changeKind: fieldRow.kind,
			...labels,
			details: parentDetails.length > 0 ? parentDetails : [detail],
			focusedLine: parentDetails.length > 0 ? findDetailLineIndex(parentDetails, parsed) : 1,
			secondaryAction: schemaName
				? {
						href: buildOpenApiDiffSpecHref(
							entry.specId,
							entry.status === 'removed' ? sourceReleaseName : targetReleaseName,
							{ schema: schemaName }
						),
						label: 'Open in API browser'
					}
				: pc
					? {
							href: operationHref(entry, pc),
							label: 'Open in API browser'
						}
					: undefined
		});
	}

	async function handleShareLink() {
		try {
			await navigator.clipboard.writeText(window.location.href);
		} catch {
			window.prompt('Copy this link:', window.location.href);
			return;
		}
		shareCopied = true;
		if (shareCopiedTimeout) clearTimeout(shareCopiedTimeout);
		shareCopiedTimeout = setTimeout(() => {
			shareCopied = false;
		}, 2000);
	}
</script>

<div class="spec-search-results-panel comparison-results">
	<div class="comparison-results__header">
		<div>
			<h2 class="comparison-results__title">Comparison results</h2>
			<div class="comparison-results__release-pills">
				<span class="comparison-release-pill comparison-release-pill--source">
					{report.sourceRelease}
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
					{report.targetRelease}
				</span>
			</div>
		</div>
		<div class="comparison-export-toolbar" role="toolbar" aria-label="Share">
			<button
				type="button"
				class="comparison-export-btn comparison-export-btn--share"
				onclick={handleShareLink}
				title="Copy a shareable link to this comparison"
			>
				{shareCopied ? 'Copied!' : 'Share link'}
			</button>
		</div>
	</div>

	<div class="comparison-results__sticky-toolbar">
		<div class="comparison-results__filters">
			{#each STATUS_FILTERS as item (item.status)}
				<button
					type="button"
					onclick={() => onToggleStatusFilter(item.status)}
					class="comparison-filter-chip {statusFilter.includes(item.status)
						? `comparison-filter-chip--active ${item.chipClass}`
						: 'comparison-filter-chip--inactive'}"
				>
					<span>{statusCount(item.status)}</span>
					<span>{item.label}</span>
				</button>
			{/each}
		</div>

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
					id="openapi-comparison-search"
					bind:value={searchQuery}
					placeholder="Filter APIs, paths, operationIds…"
					class="comparison-results__search-input"
				/>
				{#if searchQuery}
					<button
						type="button"
						aria-label="Clear search"
						onclick={() => (searchQuery = '')}
						class="comparison-results__search-clear"
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
			<div class="comparison-results__search-meta">
				<span class="comparison-results__match-count">{filteredEntries.length} shown</span>
				<button
					type="button"
					onclick={allExpanded ? onCollapseAll : onExpandAll}
					class="comparison-results__expand-btn"
				>
					{allExpanded ? 'Collapse all' : 'Expand all'}
				</button>
			</div>
		</div>
	</div>

	{#if filteredEntries.length === 0}
		<div class="spec-search-empty">
			<div class="spec-search-empty-icon">
				<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
					/>
				</svg>
			</div>
			<h3 class="text-base font-semibold text-slate-900 dark:text-slate-100">No matching changes</h3>
			<p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
				Adjust status filters or search terms, or run a new comparison.
			</p>
		</div>
	{:else}
		<div class="comparison-results__sections">
			{#each groupedSections as section (section.status)}
				<section class="comparison-results__section" aria-labelledby="oa-section-{section.status}">
					<header class="comparison-results__section-header" id="oa-section-{section.status}">
						<div
							class="comparison-results__section-icon comparison-results__section-icon--{sectionIconModifier(
								section.status
							)}"
						>
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d={sectionIcon(section.icon)}
								/>
							</svg>
						</div>
						<div>
							<h3 class="comparison-results__section-title">{section.title}</h3>
							<p class="comparison-results__section-desc">{section.description}</p>
						</div>
						<span class="comparison-results__section-count">{section.entries.length}</span>
					</header>

					<div class="comparison-results__cards">
						{#each section.entries as entry (entry.specId)}
							{@const expanded = expandedIds.includes(entry.specId)}
							{@const pathGroups = groupPathChanges(entry.pathChanges)}
							{@const schemaGroups = groupSchemaChanges(entry.schemaChanges)}
							{@const displayStatus = displayOpenApiStatus(entry.status)}
							<article
								class="comparison-crd-card"
								class:comparison-crd-card--expanded={expanded}
							>
								<div
									role="button"
									tabindex="0"
									class="comparison-crd-card__header"
									onclick={() => onToggleExpand(entry.specId)}
									onkeydown={(event) => handleHeaderKeydown(event, entry.specId)}
									aria-expanded={expanded}
								>
									<svg
										class="comparison-crd-card__chevron"
										class:comparison-crd-card__chevron--open={expanded}
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										aria-hidden="true"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M9 5l7 7-7 7"
										/>
									</svg>
									<div class="comparison-crd-card__meta">
										<span class={statusChipClass(entry.status)}
											>{statusLabel(displayStatus)}</span
										>
										<span class="comparison-crd-card__kind">{entry.title}</span>
										{#if versionBumpLabel(entry)}
											<span class="comparison-crd-card__version">{versionBumpLabel(entry)}</span>
										{/if}
										{#if pathDeltaLabel(entry)}
											<span class="comparison-crd-card__version">{pathDeltaLabel(entry)}</span>
										{/if}
									</div>
									<div class="comparison-crd-card__name font-mono">{entrySpecIdLabel(entry)}</div>
									<span class="comparison-crd-card__change-count">{changeCountLabel(entry)}</span>
									<a
										href={buildOpenApiDiffSpecHref(
											entry.specId,
											entry.status === 'removed' ? sourceReleaseName : targetReleaseName
										)}
										class="comparison-crd-card__view-btn"
										onclick={(e) => e.stopPropagation()}
									>
										Open in API browser
									</a>
								</div>

								{#if expanded}
									<div class="comparison-crd-card__body oa-diff-detail">
										{#if entry.error}
											<p class="comparison-crd-card__empty text-red-600 dark:text-red-400">
												{entry.error}
											</p>
										{:else if entry.status === 'added'}
											<p class="comparison-crd-card__empty">
												New API in {targetReleaseName}
												{#if entry.targetPathCount != null}
													· {entry.targetPathCount} paths
												{/if}
											</p>
										{:else if entry.status === 'removed'}
											<p class="comparison-crd-card__empty">
												Removed since {sourceReleaseName}
												{#if entry.sourcePathCount != null}
													· had {entry.sourcePathCount} paths
												{/if}
											</p>
										{:else if entry.pathChanges.length > 0 || entry.schemaChanges.length > 0}
											{#if pathGroups.length > 0}
												{#each pathGroups as group (group.changeType)}
													<div class="oa-diff-detail__group">
														<h4 class="oa-diff-detail__group-title">
															{group.title}
															<span class="oa-diff-detail__group-count">{group.changes.length}</span>
														</h4>
														<ul class="oa-diff-detail__ops">
															{#each group.changes as pc (`${pc.method}:${pc.path}`)}
																<li class="oa-diff-detail__op">
																	<div class="oa-diff-detail__op-row">
																		<OpenApiMethodBadge method={pc.method} compact />
																		<button
																			type="button"
																			class="oa-diff-detail__op-link"
																			onclick={(e) => {
																				e.stopPropagation();
																				openOperationModal(entry, pc);
																			}}
																		>
																			<span class="oa-diff-detail__op-path font-mono">{pc.path}</span>
																			{#if pc.operationId}
																				<span class="oa-diff-detail__op-id">{pc.operationId}</span>
																			{/if}
																		</button>
																		<span
																			class="oa-diff-detail__op-badge oa-diff-detail__op-badge--{pc.changeType}"
																		>
																			{pc.changeType}
																		</span>
																	</div>
																	{#if pc.changeType === 'modified' && pc.details.length > 0}
																		{@const fieldRows = opFieldRowsFromDetails(pc.details)}
																		{#if fieldRows.length > 0}
																			<div class="oa-diff-detail__op-diff release-notes-table-wrap">
																				<table
																					class="release-notes-table release-notes-table--modified oa-op-diff-table"
																				>
																					<thead>
																						<tr>
																							<th class="release-notes-table__col-field">Field</th>
																							<th class="release-notes-table__col-type">Type</th>
																							<th class="release-notes-table__col-diff">Before → After</th>
																						</tr>
																					</thead>
																					<tbody>
																						{#each fieldRows as row (`${row.kind}:${row.field}`)}
																							<tr
																								class="oa-op-diff-table__row"
																								onclick={() => openFieldModal(entry, pc, row)}
																							>
																								<td class="release-notes-table__col-field">
																									<span class="release-notes-field-label">{row.label}</span>
																									<code class="release-notes-field-path">{row.field}</code>
																								</td>
																								<td class="release-notes-table__col-type">
																									<span class={opFieldChangeBadgeClass(row.kind)}>
																										{row.kind}
																									</span>
																								</td>
																								<td class="release-notes-table__col-diff">
																									{#if row.before != null || row.after != null}
																										<span class="release-notes-diff">
																											<span class="release-notes-diff__before"
																												>{row.before ?? '—'}</span
																											>
																											<span class="release-notes-diff__arrow">→</span>
																											<span class="release-notes-diff__after"
																												>{row.after ?? '—'}</span
																											>
																										</span>
																									{:else if row.kind === 'added'}
																										<span class="release-notes-diff">
																											<span class="release-notes-diff__before">—</span>
																											<span class="release-notes-diff__arrow">→</span>
																											<span class="release-notes-diff__after">added</span>
																										</span>
																									{:else if row.kind === 'removed'}
																										<span class="release-notes-diff">
																											<span class="release-notes-diff__before">removed</span>
																											<span class="release-notes-diff__arrow">→</span>
																											<span class="release-notes-diff__after">—</span>
																										</span>
																									{:else}
																										<span class="release-notes-cell-muted">changed</span>
																									{/if}
																								</td>
																							</tr>
																						{/each}
																					</tbody>
																				</table>
																			</div>
																		{/if}
																	{/if}
																</li>
															{/each}
														</ul>
													</div>
												{/each}
											{/if}

											{#if schemaGroups.added.length || schemaGroups.removed.length || schemaGroups.modified.length || schemaGroups.apiVersion.length}
												{#key entry.specId}
													<OpenApiSchemaDiffPanel
														{entry}
														{sourceReleaseName}
														{targetReleaseName}
														entryVersionBump={versionBumpLabel(entry)}
														onOpenDiff={openDiffModal}
														onOpenFieldDiff={(fieldRow, schemaName, schemaDetails) =>
															openFieldModal(entry, null, fieldRow, schemaName, schemaDetails)}
													/>
												{/key}
											{/if}
										{:else if versionBumpLabel(entry)}
											<p class="comparison-crd-card__empty">
												API version bump only · {versionBumpLabel(entry)} — no path or schema
												content changes.
											</p>
										{:else}
											<p class="comparison-crd-card__empty">No path or schema changes detected.</p>
										{/if}
									</div>
								{/if}
							</article>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/if}
</div>

<DiffDetailModal open={diffModalOpen} payload={diffModalPayload} onClose={closeDiffModal} />

<style>
	.oa-diff-detail {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.oa-diff-detail__skeleton {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.oa-diff-detail__group-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.5rem;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-slate-500, #64748b);
	}

	:global(.dark) .oa-diff-detail__group-title {
		color: var(--color-slate-400, #94a3b8);
	}

	.oa-diff-detail__group-count {
		font-weight: 600;
		letter-spacing: 0;
		text-transform: none;
		opacity: 0.8;
	}

	.oa-diff-detail__ops {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.oa-diff-detail__op {
		border: 1px solid var(--color-slate-200, #e2e8f0);
		border-radius: 0.5rem;
		padding: 0.5rem 0.65rem;
		background: var(--color-white, #fff);
	}

	:global(.dark) .oa-diff-detail__op {
		border-color: var(--color-slate-700, #334155);
		background: var(--color-slate-900, #0f172a);
	}

	.oa-diff-detail__op-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.oa-diff-detail__op-link {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.35rem 0.65rem;
		min-width: 0;
		flex: 1;
		border: none;
		padding: 0;
		background: transparent;
		text-align: left;
		cursor: pointer;
		color: inherit;
	}

	.oa-diff-detail__op-link:hover .oa-diff-detail__op-path {
		color: var(--color-blue-600, #2563eb);
	}

	.oa-diff-detail__op-path {
		font-size: 0.8125rem;
		font-weight: 600;
		word-break: break-all;
	}

	.oa-diff-detail__op-id {
		font-size: 0.7rem;
		color: var(--color-slate-500, #64748b);
	}

	.oa-diff-detail__op-badge {
		margin-left: auto;
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		padding: 0.15rem 0.4rem;
		border-radius: 999px;
	}

	.oa-diff-detail__op-badge--added {
		background: color-mix(in srgb, #16a34a 16%, transparent);
		color: #15803d;
	}

	.oa-diff-detail__op-badge--removed {
		background: color-mix(in srgb, #dc2626 16%, transparent);
		color: #b91c1c;
	}

	.oa-diff-detail__op-badge--modified {
		background: color-mix(in srgb, #d97706 16%, transparent);
		color: #b45309;
	}

	:global(.dark) .oa-diff-detail__op-badge--added {
		color: #86efac;
	}

	:global(.dark) .oa-diff-detail__op-badge--removed {
		color: #fca5a5;
	}

	:global(.dark) .oa-diff-detail__op-badge--modified {
		color: #fcd34d;
	}

	.oa-diff-detail__op-diff {
		margin-top: 0.55rem;
		max-width: 100%;
		overflow-x: auto;
	}

	.oa-op-diff-table {
		width: 100%;
		font-size: 0.75rem;
	}

	.oa-op-diff-table .release-notes-table__col-diff {
		white-space: normal;
		min-width: 12rem;
	}

	.oa-op-diff-table .release-notes-diff {
		word-break: break-word;
	}

	:global(.oa-op-diff-table__row) {
		cursor: pointer;
	}

	:global(.oa-op-diff-table__row:hover) {
		background: color-mix(in srgb, #2563eb 6%, transparent);
	}
</style>
