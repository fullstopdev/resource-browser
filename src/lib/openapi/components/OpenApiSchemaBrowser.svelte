<script lang="ts">
	import { sanitizeSpecForDisplay } from '$lib/openapi/sanitizeSpecForDisplay';
	import {
		buildSchemaExplorer,
		countEdaExtensionsInTree,
		countNestedSchemaEntries,
		createSchemaExplorerHydrator,
		filterSchemaExplorer,
		findSchemaExplorerEntry,
		flattenSchemaExplorer,
		getSchemaExplorerPath,
		groupSchemaExplorer,
		listSchemaNames,
		loadCrdCatalogLinks,
		type SchemaExplorerEntry
	} from '$lib/openapi/schemaBrowser';
	import { classifySchemaName } from '$lib/openapi/schemaPresentation';
	import OpenApiSchemaDetail from '$lib/openapi/components/OpenApiSchemaDetail.svelte';

	interface Props {
		spec: Record<string, unknown>;
		darkMode?: boolean;
		highlightSchema?: string;
		resourcesReleaseFolder?: string;
		onSchemaSelect?: (schemaName: string) => void;
	}

	let {
		spec,
		darkMode = false,
		highlightSchema = '',
		resourcesReleaseFolder = '',
		onSchemaSelect
	}: Props = $props();

	let filter = $state('');
	let debouncedFilter = $state('');
	let expandedGroups = $state<Record<string, boolean>>({});
	let expandedTrees = $state<Record<string, boolean>>({});
	let selectedSchemaName = $state('');
	let crdCatalogLinks = $state<Map<string, string>>(new Map());
	let initializedKey = $state('');
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	const sanitizedSpec = $derived(sanitizeSpecForDisplay(spec));

	const entries = $derived(buildSchemaExplorer(sanitizedSpec, { crdCatalogLinks }));

	const hydrator = $derived(createSchemaExplorerHydrator(sanitizedSpec, { crdCatalogLinks }));

	const isFiltering = $derived(debouncedFilter.trim().length > 0);

	const visibleEntries = $derived(
		filterSchemaExplorer(entries, debouncedFilter, isFiltering ? hydrator : undefined)
	);

	const groupedEntries = $derived(groupSchemaExplorer(visibleEntries));

	const visibleCount = $derived(
		isFiltering ? visibleEntries.length : flattenSchemaExplorer(visibleEntries).length
	);

	const selectedEntry = $derived.by(() => {
		const base =
			findSchemaExplorerEntry(entries, selectedSchemaName) ??
			visibleEntries.find((e) => e.name === selectedSchemaName) ??
			null;
		return base ? hydrator.hydrate(base) : null;
	});

	const selectedPath = $derived(
		selectedSchemaName ? getSchemaExplorerPath(entries, selectedSchemaName) : []
	);

	const selectedPathNames = $derived(new Set(selectedPath.map((e) => e.name)));

	$effect(() => {
		if (!resourcesReleaseFolder) return;
		const kinds = listSchemaNames(sanitizedSpec)
			.map((name) => classifySchemaName(name).kind)
			.filter((kind): kind is string => Boolean(kind));
		if (kinds.length === 0) return;

		let cancelled = false;

		void (async () => {
			const links = await loadCrdCatalogLinks(resourcesReleaseFolder, kinds);
			if (!cancelled) crdCatalogLinks = links;
		})();

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const value = filter;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			debouncedFilter = value;
		}, 200);
		return () => {
			if (searchTimer) clearTimeout(searchTimer);
		};
	});

	function pickDefaultSchema(entries: SchemaExplorerEntry[]): string {
		const flat = flattenSchemaExplorer(entries);
		if (highlightSchema && flat.some((e) => e.name === highlightSchema)) {
			return highlightSchema;
		}
		return (
			flat.find((e) => e.name === 'QueryResponse')?.name ??
			flat.find((e) => e.presentation.isQueryRelated)?.name ??
			flat[0]?.name ??
			''
		);
	}

	function expandAncestorsOf(name: string) {
		const path = getSchemaExplorerPath(entries, name);
		if (path.length === 0) return;
		let changed = false;
		const next = { ...expandedTrees };
		for (const ancestor of path.slice(0, -1)) {
			if (!next[ancestor.name]) {
				next[ancestor.name] = true;
				changed = true;
			}
		}
		// Always assigning a new object here previously infinite-looped via $effect.
		if (changed) expandedTrees = next;
	}

	$effect(() => {
		const flat = flattenSchemaExplorer(entries);
		const key = `${flat.length}:${visibleEntries.length}:${highlightSchema}:${debouncedFilter}`;
		if (initializedKey === key) return;
		initializedKey = key;

		const visibleFlat = flattenSchemaExplorer(visibleEntries);
		if (
			!selectedSchemaName ||
			!visibleFlat.some((e) => e.name === selectedSchemaName)
		) {
			selectedSchemaName = pickDefaultSchema(visibleEntries);
		} else if (highlightSchema && flat.some((e) => e.name === highlightSchema)) {
			selectedSchemaName = highlightSchema;
		}

		const nextExpanded: Record<string, boolean> = { ...expandedGroups };
		if (visibleFlat.some((e) => e.presentation.category === 'query')) {
			nextExpanded.query = true;
		}
		expandedGroups = nextExpanded;

		if (selectedSchemaName) expandAncestorsOf(selectedSchemaName);
	});

	$effect(() => {
		if (selectedSchemaName && !isFiltering) {
			expandAncestorsOf(selectedSchemaName);
		}
	});

	function isGroupExpanded(category: string): boolean {
		return expandedGroups[category] ?? true;
	}

	function toggleGroup(category: string) {
		expandedGroups = { ...expandedGroups, [category]: !isGroupExpanded(category) };
	}

	const allGroupsExpanded = $derived(
		groupedEntries.length > 0 && groupedEntries.every((g) => isGroupExpanded(g.category))
	);

	function expandAllGroups() {
		if (isFiltering || groupedEntries.length === 0) return;
		const next: Record<string, boolean> = { ...expandedGroups };
		for (const group of groupedEntries) {
			next[group.category] = true;
		}
		expandedGroups = next;
	}

	function collapseAllGroups() {
		if (isFiltering) return;
		const next: Record<string, boolean> = {};
		for (const group of groupedEntries) {
			next[group.category] = false;
		}
		expandedGroups = next;
	}

	function isTreeExpanded(name: string): boolean {
		return expandedTrees[name] ?? false;
	}

	function toggleTree(name: string) {
		expandedTrees = { ...expandedTrees, [name]: !isTreeExpanded(name) };
	}

	function selectSchema(entry: SchemaExplorerEntry) {
		selectedSchemaName = entry.name;
		if (entry.nestedEntries?.length) {
			expandedTrees = { ...expandedTrees, [entry.name]: true };
		}
		expandAncestorsOf(entry.name);
		onSchemaSelect?.(entry.name);
	}

	function edaCount(entry: SchemaExplorerEntry): number {
		return (entry.edaExtension ? 1 : 0) + countEdaExtensionsInTree(entry.properties);
	}
</script>

{#snippet schemaRow(entry: SchemaExplorerEntry, depth: number, isLast: boolean)}
	{@const eda = edaCount(entry)}
	{@const nestedCount = countNestedSchemaEntries(entry)}
	{@const hasChildren = Boolean(entry.nestedEntries?.length)}
	{@const treeOpen = isFiltering || isTreeExpanded(entry.name)}
	{@const onPath = selectedPathNames.has(entry.name)}
	<li
		class="openapi-schema-browser__node"
		class:openapi-schema-browser__node--last={isLast}
		style:--nest-depth={depth}
	>
		<div
			class="openapi-schema-browser__row-wrap"
			class:openapi-schema-browser__row-wrap--on-path={onPath && selectedEntry?.name !== entry.name}
		>
			{#if hasChildren && !isFiltering}
				<button
					type="button"
					class="openapi-schema-browser__tree-toggle"
					aria-expanded={treeOpen}
					aria-label={treeOpen ? `Collapse ${entry.presentation.label}` : `Expand ${entry.presentation.label}`}
					onclick={(e) => {
						e.stopPropagation();
						toggleTree(entry.name);
					}}
				>
					{treeOpen ? '▾' : '▸'}
				</button>
			{:else}
				<span class="openapi-schema-browser__tree-spacer" aria-hidden="true">
					{depth > 0 ? '·' : ''}
				</span>
			{/if}
			<button
				type="button"
				class="openapi-schema-browser__row"
				class:openapi-schema-browser__row--selected={selectedEntry?.name === entry.name}
				class:openapi-schema-browser__row--highlight={highlightSchema === entry.name}
				class:openapi-schema-browser__row--query={entry.presentation.isQueryRelated}
				class:openapi-schema-browser__row--nested={entry.isNested}
				class:openapi-schema-browser__row--on-path={onPath && selectedEntry?.name !== entry.name}
				aria-current={selectedEntry?.name === entry.name ? 'true' : undefined}
				onclick={() => selectSchema(entry)}
			>
				<span class="openapi-schema-browser__row-label">{entry.presentation.label}</span>
				<span class="openapi-schema-browser__row-type">{entry.type}</span>
				{#if nestedCount > 0 && !isFiltering}
					<span
						class="openapi-schema-browser__nested-count"
						title="{nestedCount} nested component schema{nestedCount === 1 ? '' : 's'}"
					>
						{nestedCount}
					</span>
				{/if}
				{#if eda > 0}
					<span class="openapi-schema-browser__eda-badge" title="EDA UI metadata">
						{eda}
					</span>
				{/if}
			</button>
		</div>
		{#if hasChildren && treeOpen && !isFiltering}
			<ul class="openapi-schema-browser__list openapi-schema-browser__list--nested">
				{#each entry.nestedEntries ?? [] as nested, index (nested.name)}
					{@render schemaRow(nested, depth + 1, index === (entry.nestedEntries?.length ?? 0) - 1)}
				{/each}
			</ul>
		{/if}
	</li>
{/snippet}

<div class="openapi-schema-browser oa-root" class:openapi-schema-browser--dark={darkMode}>
	<div class="openapi-schema-browser__toolbar">
		<label class="openapi-schema-browser__filter-label" for="openapi-schema-filter">
			Search schemas
		</label>
		<input
			id="openapi-schema-filter"
			class="openapi-schema-browser__filter"
			type="search"
			placeholder="Search by kind, field name, or description…"
			bind:value={filter}
			autocomplete="off"
			spellcheck="false"
		/>
		<span class="openapi-schema-browser__count" aria-live="polite">
			{visibleCount} shown
		</span>
		{#if groupedEntries.length > 0 && !isFiltering}
			<button
				type="button"
				class="comparison-results__expand-btn openapi-schema-browser__expand-btn"
				onclick={allGroupsExpanded ? collapseAllGroups : expandAllGroups}
			>
				{allGroupsExpanded ? 'Collapse all' : 'Expand all'}
			</button>
		{/if}
	</div>

	{#if entries.length === 0}
		<p class="openapi-schema-browser__empty">No schemas defined in this specification.</p>
	{:else if visibleEntries.length === 0}
		<p class="openapi-schema-browser__empty">No schemas match your filter.</p>
	{:else}
		<div class="openapi-schema-browser__layout">
			<aside class="openapi-schema-browser__sidebar" aria-label="Schema catalog">
				{#each groupedEntries as group (group.category)}
					<section class="openapi-schema-group">
						<button
							type="button"
							class="openapi-schema-group__header"
							aria-expanded={isGroupExpanded(group.category)}
							onclick={() => toggleGroup(group.category)}
						>
							<span class="openapi-schema-group__chevron" aria-hidden="true">
								{isGroupExpanded(group.category) ? '▾' : '▸'}
							</span>
							<h3 class="openapi-schema-group__title">{group.label}</h3>
							<span class="openapi-schema-browser__count">{group.entries.length}</span>
						</button>

						{#if isGroupExpanded(group.category)}
							<ul class="openapi-schema-browser__list">
								{#each group.entries as entry, index (entry.name)}
									{@render schemaRow(entry, 0, index === group.entries.length - 1)}
								{/each}
							</ul>
						{/if}
					</section>
				{/each}
			</aside>

			<div class="openapi-schema-browser__detail" aria-label="Schema details">
				{#if selectedEntry}
					{#key selectedEntry.name}
						<OpenApiSchemaDetail
							entry={selectedEntry}
							ancestryPath={selectedPath}
							spec={sanitizedSpec}
							{darkMode}
							initialFocusPath={highlightSchema === selectedEntry.name ? highlightSchema : ''}
							onNestedSelect={selectSchema}
						/>
					{/key}
				{:else}
					<p class="openapi-schema-browser__empty">Select a schema from the list.</p>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.openapi-schema-browser {
		min-height: min(68vh, 860px);
		font-family: 'NokiaPureText', ui-sans-serif, system-ui, sans-serif;
	}

	.openapi-schema-browser__toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.625rem;
		margin-bottom: 0.875rem;
	}

	.openapi-schema-browser__expand-btn {
		flex-shrink: 0;
		font-size: 0.75rem;
		line-height: 1.25;
		color: #64748b;
		background: #fff;
		cursor: pointer;
	}

	.openapi-schema-browser--dark :global(.comparison-results__expand-btn) {
		border-color: rgba(56, 100, 150, 0.35);
		color: #94a3b8;
		background: transparent;
	}

	.openapi-schema-browser--dark :global(.comparison-results__expand-btn:hover) {
		background: rgba(7, 20, 40, 0.55);
		color: #e2e8f0;
	}

	.openapi-schema-browser__filter-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: #64748b;
	}

	.openapi-schema-browser--dark .openapi-schema-browser__filter-label {
		color: #94a3b8;
	}

	.openapi-schema-browser__filter {
		flex: 1 1 14rem;
		min-width: 0;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
		font-family: inherit;
		background: #ffffff;
		color: #0f172a;
	}

	.openapi-schema-browser--dark .openapi-schema-browser__filter {
		border-color: rgba(56, 100, 150, 0.35);
		background: #1e293b;
		color: #e2e8f0;
	}

	.openapi-schema-browser__count {
		border-radius: 9999px;
		background: #e2e8f0;
		padding: 0.125rem 0.5rem;
		font-size: 0.6875rem;
		font-weight: 700;
		color: #475569;
	}

	.openapi-schema-browser--dark .openapi-schema-browser__count {
		background: rgba(56, 100, 150, 0.35);
		color: #cbd5e1;
	}

	.openapi-schema-browser__empty {
		padding: 2rem 0.75rem;
		font-size: 0.875rem;
		color: #64748b;
		text-align: center;
	}

	.openapi-schema-browser--dark .openapi-schema-browser__empty {
		color: #94a3b8;
	}

	.openapi-schema-browser__layout {
		display: grid;
		grid-template-columns: minmax(14rem, 22rem) minmax(0, 1fr);
		gap: 0.875rem;
		min-height: min(62vh, 780px);
	}

	@media (max-width: 900px) {
		.openapi-schema-browser__layout {
			grid-template-columns: 1fr;
		}
	}

	.openapi-schema-browser__sidebar {
		border: 1px solid #e2e8f0;
		border-radius: 0.625rem;
		background: #ffffff;
		overflow: auto;
		max-height: min(62vh, 780px);
		position: sticky;
		top: 0.5rem;
		align-self: start;
		padding: 0.375rem;
	}

	.openapi-schema-browser--dark .openapi-schema-browser__sidebar {
		border-color: rgba(56, 100, 150, 0.35);
		background: rgba(15, 23, 42, 0.85);
	}

	.openapi-schema-group + .openapi-schema-group {
		border-top: 1px solid #f1f5f9;
	}

	.openapi-schema-browser--dark .openapi-schema-group + .openapi-schema-group {
		border-top-color: rgba(56, 100, 150, 0.2);
	}

	.openapi-schema-group__header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.375rem 0.25rem;
		border: none;
		background: none;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
	}

	.openapi-schema-group__chevron {
		color: #64748b;
		font-size: 0.75rem;
	}

	.openapi-schema-group__title {
		margin: 0;
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #475569;
	}

	.openapi-schema-browser--dark .openapi-schema-group__title {
		color: #94a3b8;
	}

	.openapi-schema-browser__list {
		list-style: none;
		margin: 0;
		padding: 0 0 0.5rem;
	}

	.openapi-schema-browser__list--nested {
		position: relative;
		margin: 0;
		padding: 0 0 0 0.75rem;
		margin-left: 0.7rem;
		border-left: 1px solid #cbd5e1;
	}

	.openapi-schema-browser--dark .openapi-schema-browser__list--nested {
		border-left-color: rgba(56, 100, 150, 0.45);
	}

	.openapi-schema-browser__node {
		position: relative;
	}

	.openapi-schema-browser__list--nested > .openapi-schema-browser__node::before {
		content: '';
		position: absolute;
		left: -0.75rem;
		top: 0.9rem;
		width: 0.55rem;
		border-top: 1px solid #cbd5e1;
	}

	.openapi-schema-browser--dark .openapi-schema-browser__list--nested > .openapi-schema-browser__node::before {
		border-top-color: rgba(56, 100, 150, 0.45);
	}

	.openapi-schema-browser__list--nested > .openapi-schema-browser__node--last {
		border-left: 1px solid transparent;
	}

	.openapi-schema-browser__row-wrap {
		display: flex;
		align-items: flex-start;
		gap: 0.125rem;
	}

	.openapi-schema-browser__tree-toggle,
	.openapi-schema-browser__tree-spacer {
		flex: 0 0 1.1rem;
		width: 1.1rem;
		height: 1.75rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: none;
		background: none;
		font-size: 0.6875rem;
		color: #64748b;
		cursor: pointer;
		font-family: inherit;
	}

	.openapi-schema-browser__tree-spacer {
		cursor: default;
		color: #94a3b8;
	}

	.openapi-schema-browser--dark .openapi-schema-browser__tree-toggle {
		color: #94a3b8;
	}

	.openapi-schema-browser__row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		flex: 1 1 auto;
		min-width: 0;
		padding: 0.4rem 0.5rem;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		transition: background 0.12s ease;
	}

	.openapi-schema-browser__row--nested .openapi-schema-browser__row-label {
		font-weight: 500;
		font-size: 0.78125rem;
	}

	.openapi-schema-browser__row:hover {
		background: rgba(37, 99, 235, 0.06);
	}

	.openapi-schema-browser--dark .openapi-schema-browser__row:hover {
		background: rgba(96, 165, 250, 0.08);
	}

	.openapi-schema-browser__row--selected {
		background: rgba(37, 99, 235, 0.1);
		box-shadow: inset 3px 0 0 #2563eb;
	}

	.openapi-schema-browser--dark .openapi-schema-browser__row--selected {
		background: rgba(96, 165, 250, 0.12);
		box-shadow: inset 3px 0 0 #60a5fa;
	}

	.openapi-schema-browser__row--on-path {
		background: rgba(37, 99, 235, 0.04);
	}

	.openapi-schema-browser--dark .openapi-schema-browser__row--on-path {
		background: rgba(96, 165, 250, 0.06);
	}

	.openapi-schema-browser__row--highlight {
		box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.35);
	}

	.openapi-schema-browser__row--query:not(.openapi-schema-browser__row--selected) {
		background: rgba(5, 150, 105, 0.04);
	}

	.openapi-schema-browser__row-label {
		flex: 1 1 6rem;
		min-width: 0;
		font-size: 0.8125rem;
		font-weight: 600;
		color: #0f172a;
	}

	.openapi-schema-browser--dark .openapi-schema-browser__row-label {
		color: #f1f5f9;
	}

	.openapi-schema-browser__row-type {
		font-family: 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.625rem;
		color: #2563eb;
	}

	.openapi-schema-browser--dark .openapi-schema-browser__row-type {
		color: #93c5fd;
	}

	.openapi-schema-browser__nested-count {
		border-radius: 9999px;
		padding: 0.05rem 0.35rem;
		font-size: 0.625rem;
		font-weight: 700;
		background: #e2e8f0;
		color: #475569;
	}

	.openapi-schema-browser--dark .openapi-schema-browser__nested-count {
		background: rgba(56, 100, 150, 0.35);
		color: #cbd5e1;
	}

	.openapi-schema-browser__eda-badge {
		border-radius: 9999px;
		padding: 0.05rem 0.35rem;
		font-size: 0.625rem;
		font-weight: 700;
		background: rgba(37, 99, 235, 0.12);
		color: #2563eb;
	}

	.openapi-schema-browser--dark .openapi-schema-browser__eda-badge {
		background: rgba(96, 165, 250, 0.15);
		color: #93c5fd;
	}

	.openapi-schema-browser__detail {
		display: flex;
		flex-direction: column;
		border: 1px solid #e2e8f0;
		border-radius: 0.625rem;
		background: #ffffff;
		overflow: hidden;
		max-height: min(62vh, 780px);
		padding: 1rem;
		min-height: 0;
	}

	.openapi-schema-browser--dark .openapi-schema-browser__detail {
		border-color: rgba(56, 100, 150, 0.35);
		background: rgba(15, 23, 42, 0.85);
	}
</style>
