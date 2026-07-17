<script lang="ts">
	import type { OpenApiDiffEntry } from '$lib/openapi/types';
	import {
		SCHEMA_KIND_FILTERS,
		buildOpenApiDiffSpecHref,
		buildSchemaDisplayRows,
		defaultSchemaKindFilters,
		filterSchemaDisplayRows,
		groupSchemaChanges,
		groupSchemaChangesForUI,
		opFieldChangeBadgeClass,
		opFieldRowsFromDetails,
		schemaKindFilterCounts,
		schemaPairBump,
		type SchemaDisplayRow,
		type SchemaKindFilter,
		type OpenApiOpFieldRow
	} from '$lib/openapi-comparison';
	import {
		syntheticPathDetailLine,
		type DiffDetailModalPayload
	} from '$lib/comparison/diffDetails';

	let {
		entry,
		sourceReleaseName = '',
		targetReleaseName = '',
		entryVersionBump = null,
		onOpenDiff = (_payload: DiffDetailModalPayload) => {},
		onOpenFieldDiff = (_fieldRow: OpenApiOpFieldRow, _schemaName?: string, _schemaDetails?: string[]) => {}
	}: {
		entry: OpenApiDiffEntry;
		sourceReleaseName?: string;
		targetReleaseName?: string;
		entryVersionBump?: string | null;
		onOpenDiff?: (payload: DiffDetailModalPayload) => void;
		onOpenFieldDiff?: (
			fieldRow: OpenApiOpFieldRow,
			schemaName?: string,
			schemaDetails?: string[]
		) => void;
	} = $props();

	const schemaGroups = $derived(groupSchemaChanges(entry.schemaChanges));
	const allRows = $derived(buildSchemaDisplayRows(schemaGroups));
	const kindCounts = $derived(schemaKindFilterCounts(allRows));

	let kindFilter = $state<SchemaKindFilter[]>(
		defaultSchemaKindFilters(buildSchemaDisplayRows(groupSchemaChanges(entry.schemaChanges)))
	);
	let searchQuery = $state('');
	let expandedCompanionIds = $state<string[]>([]);

	const filteredRows = $derived(filterSchemaDisplayRows(allRows, kindFilter, searchQuery));
	const uiGroups = $derived(
		groupSchemaChangesForUI(entry.schemaChanges)
			.map((group) => ({
				...group,
				rows: group.rows.filter((row) =>
					filteredRows.some((filtered) => filtered.id === row.id)
				)
			}))
			.filter((group) => group.rows.length > 0)
	);

	const summaryBits = $derived(
		[
			kindCounts.added || kindCounts.removed || kindCounts.modified
				? `+${kindCounts.added} / −${kindCounts.removed} / ~${kindCounts.modified}`
				: '',
			kindCounts.api_version ? `↻${kindCounts.api_version} version` : ''
		].filter(Boolean)
	);

	function toggleKindFilter(kind: SchemaKindFilter) {
		if (kindFilter.includes(kind)) {
			if (kindFilter.length === 1) return;
			kindFilter = kindFilter.filter((item) => item !== kind);
		} else {
			kindFilter = [...kindFilter, kind];
		}
	}

	function toggleCompanions(rowId: string) {
		if (expandedCompanionIds.includes(rowId)) {
			expandedCompanionIds = expandedCompanionIds.filter((id) => id !== rowId);
		} else {
			expandedCompanionIds = [...expandedCompanionIds, rowId];
		}
	}

	function schemaViewerHref(schemaName: string, kind: SchemaDisplayRow['kind']): string {
		const useSource = entry.status === 'removed' || kind === 'removed';
		const release = useSource ? sourceReleaseName : targetReleaseName;
		const specId = useSource ? (entry.sourceSpecId ?? entry.specId) : entry.specId;
		return buildOpenApiDiffSpecHref(specId, release, { schema: schemaName });
	}

	function openSchemaModal(row: SchemaDisplayRow) {
		const labels = {
			sourceLabel: sourceReleaseName,
			targetLabel: targetReleaseName
		};
		const changeKind =
			row.kind === 'api_version'
				? 'modified'
				: row.kind === 'added' || row.kind === 'removed' || row.kind === 'modified'
					? row.kind
					: undefined;
		const details =
			row.details && row.details.length > 0
				? row.details
				: row.kind === 'added' || row.kind === 'removed'
					? [syntheticPathDetailLine(row.kind, row.primaryName)]
					: row.fromName && row.toName
						? [
								`~ Modified: apiVersion :: ${row.fromName} → ${row.toName}`
							]
						: [];
		onOpenDiff({
			title: row.label,
			subtitle: row.primaryName,
			changeKind,
			...labels,
			details,
			secondaryAction: {
				href: schemaViewerHref(row.primaryName, row.kind),
				label: 'Open in API browser'
			}
		});
	}

	function rowBadgeKind(row: SchemaDisplayRow): 'added' | 'removed' | 'modified' {
		if (row.kind === 'api_version') return 'modified';
		return row.kind;
	}

	function rowBump(row: SchemaDisplayRow): string | null {
		return schemaPairBump(row) ?? (row.kind === 'api_version' ? entryVersionBump : null);
	}
</script>

<div class="oa-diff-detail__group oa-schema-diff">
	<h4 class="oa-diff-detail__group-title">
		Schemas
		<span class="oa-diff-detail__group-count">{summaryBits.join(' · ')}</span>
	</h4>

	<div class="oa-schema-diff__toolbar">
		<div class="oa-schema-diff__filters" role="group" aria-label="Schema change filters">
			{#each SCHEMA_KIND_FILTERS as item (item.kind)}
				{#if kindCounts[item.kind] > 0}
					<button
						type="button"
						onclick={() => toggleKindFilter(item.kind)}
						class="comparison-filter-chip oa-schema-diff__filter-chip {kindFilter.includes(item.kind)
							? `comparison-filter-chip--active ${item.chipClass}`
							: 'comparison-filter-chip--inactive'}"
						aria-pressed={kindFilter.includes(item.kind)}
					>
						<span>{kindCounts[item.kind]}</span>
						<span>{item.label}</span>
					</button>
				{/if}
			{/each}
		</div>

		<div class="oa-schema-diff__search-row">
			<div class="oa-schema-diff__search">
				<svg
					class="oa-schema-diff__search-icon"
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
					bind:value={searchQuery}
					placeholder="Filter schema names…"
					class="oa-schema-diff__search-input"
					aria-label="Filter schemas by name"
				/>
				{#if searchQuery}
					<button
						type="button"
						aria-label="Clear schema search"
						onclick={() => (searchQuery = '')}
						class="oa-schema-diff__search-clear"
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
			<span class="oa-schema-diff__match-count">{filteredRows.length} shown</span>
		</div>
	</div>

	{#if filteredRows.length === 0}
		<p class="oa-schema-diff__empty">No schemas match the current filters.</p>
	{:else}
		{#each uiGroups as group (group.kind)}
			<div class="oa-schema-diff__section">
				<h5 class="oa-schema-diff__section-title">
					{group.title}
					<span class="oa-diff-detail__group-count">{group.rows.length}</span>
				</h5>
				<ul class="oa-diff-detail__ops">
					{#each group.rows as row (row.id)}
						{@const fieldRows = row.details ? opFieldRowsFromDetails(row.details) : []}
						{@const bump = rowBump(row)}
						{@const companionsOpen = expandedCompanionIds.includes(row.id)}
						<li class="oa-diff-detail__op">
							<div class="oa-diff-detail__op-row">
								<button
									type="button"
									class="oa-diff-detail__schema-link font-mono oa-schema-diff__primary-link"
									onclick={(e) => {
										e.stopPropagation();
										openSchemaModal(row);
									}}
									title={row.primaryName}
								>
									{row.label}
								</button>
								{#if row.companions.length > 0}
									<button
										type="button"
										class="oa-schema-diff__companions-toggle"
										aria-expanded={companionsOpen}
										onclick={() => toggleCompanions(row.id)}
									>
										{companionsOpen ? 'Hide' : 'Show'}
										{row.companions.length}
										companion{row.companions.length === 1 ? '' : 's'}
									</button>
								{/if}
								{#if bump}
									<span class="oa-diff-detail__schema-api-version-bump">{bump}</span>
								{/if}
								<span
									class="oa-diff-detail__op-badge oa-diff-detail__op-badge--{rowBadgeKind(row)}"
								>
									{row.kind === 'api_version' ? 'version' : row.kind}
								</span>
							</div>

							{#if row.companions.length > 0 && companionsOpen}
								<ul class="oa-schema-diff__companions">
									{#each row.companions as companion (companion.name)}
										{@const companionBump = schemaPairBump(companion)}
										<li class="oa-schema-diff__companion">
											<button
												type="button"
												class="oa-diff-detail__schema-link font-mono"
												onclick={(e) => {
													e.stopPropagation();
													openSchemaModal({
														...row,
														label: companion.shortName,
														primaryName: companion.name
													});
												}}
												title={companion.name}
											>
												{companion.shortName}
											</button>
											{#if companionBump}
												<span class="oa-diff-detail__schema-api-version-bump"
													>{companionBump}</span
												>
											{/if}
										</li>
									{/each}
								</ul>
							{/if}

							{#if row.kind === 'modified' && fieldRows.length > 0}
								<div class="oa-diff-detail__op-diff release-notes-table-wrap">
									<table class="release-notes-table release-notes-table--modified oa-op-diff-table">
										<thead>
											<tr>
												<th class="release-notes-table__col-field">Field</th>
												<th class="release-notes-table__col-type">Type</th>
												<th class="release-notes-table__col-diff">Before → After</th>
											</tr>
										</thead>
										<tbody>
											{#each fieldRows as fieldRow (`${fieldRow.kind}:${fieldRow.field}`)}
												<tr
													class="oa-op-diff-table__row"
													onclick={() => onOpenFieldDiff(fieldRow, row.primaryName, row.details)}
												>
													<td class="release-notes-table__col-field">
														<span class="release-notes-field-label">{fieldRow.label}</span>
														<code class="release-notes-field-path">{fieldRow.field}</code>
													</td>
													<td class="release-notes-table__col-type">
														<span class={opFieldChangeBadgeClass(fieldRow.kind)}>
															{fieldRow.kind}
														</span>
													</td>
													<td class="release-notes-table__col-diff">
														{#if fieldRow.before != null || fieldRow.after != null}
															<span class="release-notes-diff">
																<span class="release-notes-diff__before"
																	>{fieldRow.before ?? '—'}</span
																>
																<span class="release-notes-diff__arrow">→</span>
																<span class="release-notes-diff__after"
																	>{fieldRow.after ?? '—'}</span
																>
															</span>
														{:else if fieldRow.kind === 'added'}
															<span class="release-notes-diff">
																<span class="release-notes-diff__before">—</span>
																<span class="release-notes-diff__arrow">→</span>
																<span class="release-notes-diff__after">added</span>
															</span>
														{:else if fieldRow.kind === 'removed'}
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
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	{/if}
</div>

<style>
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

	.oa-op-diff-table :global(.release-notes-table__col-diff) {
		white-space: normal;
		min-width: 12rem;
	}

	.oa-op-diff-table :global(.release-notes-diff) {
		word-break: break-word;
	}

	.oa-diff-detail__schema-link {
		display: inline-block;
		font-size: 0.75rem;
		padding: 0.15rem 0.45rem;
		border-radius: 0.35rem;
		border: none;
		background: var(--color-slate-100, #f1f5f9);
		color: var(--color-slate-800, #1e293b);
		cursor: pointer;
		text-align: left;
	}

	.oa-diff-detail__schema-link:hover {
		background: color-mix(in srgb, #2563eb 12%, transparent);
		color: #2563eb;
	}

	:global(.dark) .oa-diff-detail__schema-link {
		background: var(--color-slate-800, #1e293b);
		color: var(--color-slate-200, #e2e8f0);
	}

	.oa-diff-detail__schema-api-version-bump {
		font-family: var(--font-fira, ui-monospace, monospace);
		font-size: 0.75rem;
		color: var(--color-sky-700, #0369a1);
	}

	:global(.dark) .oa-diff-detail__schema-api-version-bump {
		color: #7dd3fc;
	}

	.oa-schema-diff__toolbar {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.oa-schema-diff__filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.oa-schema-diff__filter-chip {
		font-size: 0.7rem;
		padding: 0.2rem 0.45rem;
	}

	:global(.comparison-filter-chip--api-version.comparison-filter-chip--active) {
		background: color-mix(in srgb, #0ea5e9 18%, transparent);
		color: #0369a1;
		border-color: color-mix(in srgb, #0ea5e9 35%, transparent);
	}

	:global(.dark .comparison-filter-chip--api-version.comparison-filter-chip--active) {
		color: #7dd3fc;
	}

	.oa-schema-diff__search-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
	}

	.oa-schema-diff__search {
		position: relative;
		flex: 1;
		min-width: 10rem;
	}

	.oa-schema-diff__search-icon {
		position: absolute;
		left: 0.55rem;
		top: 50%;
		transform: translateY(-50%);
		width: 0.9rem;
		height: 0.9rem;
		color: var(--color-slate-400, #94a3b8);
		pointer-events: none;
	}

	.oa-schema-diff__search-input {
		width: 100%;
		padding: 0.35rem 2rem 0.35rem 2rem;
		font-size: 0.75rem;
		border: 1px solid var(--color-slate-200, #e2e8f0);
		border-radius: 0.45rem;
		background: var(--color-white, #fff);
		color: inherit;
	}

	:global(.dark) .oa-schema-diff__search-input {
		border-color: var(--color-slate-700, #334155);
		background: var(--color-slate-900, #0f172a);
	}

	.oa-schema-diff__search-clear {
		position: absolute;
		right: 0.35rem;
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.15rem;
		border: none;
		background: transparent;
		color: var(--color-slate-400, #94a3b8);
		cursor: pointer;
	}

	.oa-schema-diff__match-count {
		font-size: 0.7rem;
		color: var(--color-slate-500, #64748b);
		white-space: nowrap;
	}

	.oa-schema-diff__empty {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-slate-500, #64748b);
	}

	.oa-schema-diff__section {
		margin-bottom: 0.75rem;
	}

	.oa-schema-diff__section-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.45rem;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--color-slate-500, #64748b);
	}

	:global(.dark) .oa-schema-diff__section-title {
		color: var(--color-slate-400, #94a3b8);
	}

	.oa-schema-diff__primary-link {
		font-size: 0.8125rem;
		font-weight: 600;
		padding: 0;
		background: transparent;
	}

	.oa-schema-diff__primary-link:hover {
		background: transparent;
	}

	.oa-schema-diff__companions-toggle {
		font-size: 0.65rem;
		font-weight: 600;
		padding: 0.15rem 0.45rem;
		border-radius: 999px;
		border: 1px solid var(--color-slate-200, #e2e8f0);
		background: var(--color-slate-50, #f8fafc);
		color: var(--color-slate-600, #475569);
		cursor: pointer;
	}

	:global(.dark) .oa-schema-diff__companions-toggle {
		border-color: var(--color-slate-700, #334155);
		background: var(--color-slate-800, #1e293b);
		color: var(--color-slate-300, #cbd5e1);
	}

	.oa-schema-diff__companions {
		list-style: none;
		margin: 0.45rem 0 0;
		padding: 0.35rem 0 0 0.65rem;
		border-left: 2px solid var(--color-slate-200, #e2e8f0);
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	:global(.dark) .oa-schema-diff__companions {
		border-left-color: var(--color-slate-700, #334155);
	}

	.oa-schema-diff__companion {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.65rem;
	}

	:global(.oa-op-diff-table__row) {
		cursor: pointer;
	}

	:global(.oa-op-diff-table__row:hover) {
		background: color-mix(in srgb, #2563eb 6%, transparent);
	}
</style>
