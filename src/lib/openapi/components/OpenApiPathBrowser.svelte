<script lang="ts">
	import { browser } from '$app/environment';
	import type { Snippet } from 'svelte';
	import OpenApiMethodBadge from '$lib/openapi/components/OpenApiMethodBadge.svelte';
	import OpenApiModal from '$lib/openapi/components/OpenApiModal.svelte';
	import OpenApiOperationDetail from '$lib/openapi/components/OpenApiOperationDetail.svelte';
	import { sanitizeSpecForDisplay } from '$lib/openapi/sanitizeSpecForDisplay';
	import {
		buildPathBrowserData,
		filterPathBrowserOperations,
		findOperationByDeepLinkId,
		formatOpenApiTagLabel,
		getOperationDeepLinkId,
		UNTAGGED_LABEL,
		type HttpMethod,
		type OpenApiOperation,
		type OpenApiTagGroup
	} from '$lib/openapi/pathBrowser';

	interface Props {
		spec: Record<string, unknown>;
		specId?: string;
		darkMode?: boolean;
		initialOperationId?: string;
		onOperationChange?: (operationId: string) => void;
		onSchemaGraphNavigate?: (schemaName: string) => void;
		onShowInSchemaGraph?: (operation: OpenApiOperation) => void;
		appsCatalog?: Snippet;
	}

	let {
		spec,
		specId = '',
		darkMode = false,
		initialOperationId = '',
		onOperationChange,
		onSchemaGraphNavigate,
		onShowInSchemaGraph,
		appsCatalog
	}: Props = $props();

	let searchInput = $state('');
	let debouncedSearch = $state('');
	let methodFilter = $state<HttpMethod | 'all'>('all');
	let selectedOperationId = $state('');
	let detailModalOpen = $state(false);
	let expandedTags = $state<Record<string, boolean>>({});
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	/** Tracks prior filter state so clearing search restores collapsed defaults. */
	let wasFiltering = false;

	const detailModalTitleId = 'openapi-path-detail-title';

	const sanitizedSpec = $derived(sanitizeSpecForDisplay(spec));
	const browserData = $derived(buildPathBrowserData(sanitizedSpec));
	const allOperations = $derived(browserData.tagGroups.flatMap((g) => g.operations));

	const isFiltering = $derived(Boolean(debouncedSearch.trim()) || methodFilter !== 'all');

	const filteredOperations = $derived(
		filterPathBrowserOperations(allOperations, debouncedSearch, methodFilter)
	);

	const filteredIds = $derived(new Set(filteredOperations.map((op) => op.id)));

	const visibleTagGroups = $derived.by((): OpenApiTagGroup[] => {
		if (!isFiltering) return browserData.tagGroups;
		return browserData.tagGroups
			.map((group) => ({
				...group,
				operations: group.operations.filter((op) => filteredIds.has(op.id))
			}))
			.filter((group) => group.operations.length > 0);
	});

	const selectedOperation = $derived(
		allOperations.find((op) => op.id === selectedOperationId) ??
			findOperationByDeepLinkId(allOperations, selectedOperationId) ??
			null
	);

	$effect(() => {
		const value = searchInput;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			debouncedSearch = value;
		}, 200);
		return () => {
			if (searchTimer) clearTimeout(searchTimer);
		};
	});

	$effect(() => {
		specId;
		sanitizedSpec;
		// All categories collapsed by default (defaultExpandedTags is empty).
		const defaults: Record<string, boolean> = {};
		for (const tag of browserData.defaultExpandedTags) {
			defaults[tag] = true;
		}
		expandedTags = defaults;
		selectedOperationId = '';
		detailModalOpen = false;
		wasFiltering = false;
	});

	$effect(() => {
		if (!browser || allOperations.length === 0) return;

		const hashId = initialOperationId || window.location.hash.slice(1);
		if (!hashId) return;

		const match = findOperationByDeepLinkId(allOperations, hashId);
		if (!match) return;
		if (match.id === selectedOperationId && detailModalOpen) return;

		selectOperation(match, false);
		const tag = match.tags[0] ?? UNTAGGED_LABEL;
		if (!expandedTags[tag]) {
			expandedTags = { ...expandedTags, [tag]: true };
		}
	});

	$effect(() => {
		const filtering = isFiltering;
		if (wasFiltering && !filtering) {
			expandedTags = collapsedExceptDeepLink();
		}
		wasFiltering = filtering;
	});

	function collapsedExceptDeepLink(): Record<string, boolean> {
		const next: Record<string, boolean> = {};
		const match =
			allOperations.find((op) => op.id === selectedOperationId) ??
			findOperationByDeepLinkId(allOperations, selectedOperationId);
		if (match) {
			next[match.tags[0] ?? UNTAGGED_LABEL] = true;
		}
		return next;
	}

	function isTagExpanded(tag: string): boolean {
		// While searching/filtering, auto-expand groups that still have matches
		// (visibleTagGroups already drops empty groups).
		if (isFiltering) return true;
		return expandedTags[tag] ?? false;
	}

	function toggleTag(tag: string) {
		if (isFiltering) return;
		expandedTags = { ...expandedTags, [tag]: !(expandedTags[tag] ?? false) };
	}

	const allTagsExpanded = $derived(
		visibleTagGroups.length > 0 && visibleTagGroups.every((g) => isTagExpanded(g.name))
	);

	function expandAllTags() {
		if (isFiltering || visibleTagGroups.length === 0) return;
		const next: Record<string, boolean> = { ...expandedTags };
		for (const group of visibleTagGroups) {
			next[group.name] = true;
		}
		expandedTags = next;
	}

	function collapseAllTags() {
		if (isFiltering) return;
		expandedTags = collapsedExceptDeepLink();
	}

	function selectOperation(operation: OpenApiOperation, updateHash = true) {
		const deepLinkId = getOperationDeepLinkId(operation);
		selectedOperationId = operation.id;
		detailModalOpen = true;
		onOperationChange?.(deepLinkId);

		if (!browser || !updateHash) return;
		const nextHash = `#${deepLinkId}`;
		if (window.location.hash === nextHash) return;
		history.replaceState(
			null,
			'',
			`${window.location.pathname}${window.location.search}${nextHash}`
		);
	}

	function closeDetailModal() {
		if (!detailModalOpen) return;
		detailModalOpen = false;
		if (!browser) return;
		if (!window.location.hash) return;
		history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
		window.dispatchEvent(new HashChangeEvent('hashchange'));
	}

	function operationSummary(op: OpenApiOperation): string {
		return op.summary || op.operationId || op.path;
	}
</script>

<div class="oa-path-browser oa-root" class:oa-path-browser--dark={darkMode}>
	{#if !browserData.securitySummary.isOpen && browserData.securitySummary.label}
		<div class="oa-path-browser__doc-meta">
			<span
				class="oa-path-browser__auth-badge"
				title="Document-level security (operations may override)"
			>
				{browserData.securitySummary.label}
			</span>
		</div>
	{/if}
	<div class="oa-path-browser__toolbar">
		{#if appsCatalog}
			{@render appsCatalog()}
		{/if}
		<label class="oa-path-browser__filter-label sr-only" for="openapi-path-search"
			>Search paths</label
		>
		<input
			id="openapi-path-search"
			class="oa-path-browser__search"
			type="search"
			placeholder="Path, operationId, summary, description, or tag…"
			bind:value={searchInput}
			autocomplete="off"
			spellcheck="false"
		/>
		<select
			class="oa-path-browser__method-filter"
			bind:value={methodFilter}
			aria-label="Filter by HTTP method"
		>
			<option value="all">All methods</option>
			<option value="get">GET</option>
			<option value="post">POST</option>
			<option value="put">PUT</option>
			<option value="patch">PATCH</option>
			<option value="delete">DELETE</option>
		</select>
		<span class="oa-path-browser__count" aria-live="polite">
			{filteredOperations.length} / {browserData.totalOperations}
		</span>
		{#if visibleTagGroups.length > 0 && !isFiltering}
			<button
				type="button"
				class="comparison-results__expand-btn oa-path-browser__expand-btn"
				onclick={allTagsExpanded ? collapseAllTags : expandAllTags}
			>
				{allTagsExpanded ? 'Collapse all' : 'Expand all'}
			</button>
		{/if}
	</div>

	{#if browserData.totalOperations === 0}
		<p class="oa-path-browser__empty">No paths defined in this specification.</p>
	{:else if visibleTagGroups.length === 0}
		<p class="oa-path-browser__empty">No paths match your search.</p>
	{:else}
		<div class="oa-path-browser__list-panel" aria-label="API paths">
			{#each visibleTagGroups as group (group.name)}
				<section class="oa-path-group">
					<button
						type="button"
						class="oa-path-group__header"
						aria-expanded={isTagExpanded(group.name)}
						onclick={() => toggleTag(group.name)}
					>
						<span class="oa-path-group__chevron" aria-hidden="true">
							{isTagExpanded(group.name) ? '▾' : '▸'}
						</span>
						<h3 class="oa-path-group__title">{formatOpenApiTagLabel(group.name)}</h3>
						<span class="oa-path-browser__count">{group.operations.length}</span>
					</button>
					{#if group.description && isTagExpanded(group.name)}
						<p class="oa-path-group__description">{group.description}</p>
					{/if}
					{#if isTagExpanded(group.name)}
						<ul class="oa-path-browser__list" role="listbox" aria-label={group.name}>
							{#each group.operations as operation (operation.id)}
								<li>
									<button
										type="button"
										role="option"
										class="oa-path-browser__item"
										class:oa-path-browser__item--selected={selectedOperation?.id ===
											operation.id && detailModalOpen}
										aria-selected={selectedOperation?.id === operation.id && detailModalOpen}
										onclick={() => selectOperation(operation)}
									>
										<OpenApiMethodBadge method={operation.method} compact />
										<span class="oa-path-browser__item-text">
											<span class="oa-path-browser__item-path">{operation.path}</span>
											<span class="oa-path-browser__item-summary"
												>{operationSummary(operation)}</span
											>
										</span>
										{#if operation.security.isPublic}
											<span class="oa-path-browser__public-badge" title="No authentication required"
												>Public</span
											>
										{/if}
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/each}
		</div>
	{/if}
</div>

{#snippet operationHeader()}
	<div class="oa-modal-header-text oa-op-modal-header">
		<h2 id={detailModalTitleId} class="oa-modal-title oa-modal-title--path">
			{#if selectedOperation}
				<OpenApiMethodBadge method={selectedOperation.method} />
				<span class="oa-modal-path">{selectedOperation.path}</span>
			{/if}
		</h2>
		{#if selectedOperation}
			<div class="oa-op-modal-header__meta">
				{#if selectedOperation.operationId}
					<p class="oa-modal-subtitle oa-op-modal-header__id">{selectedOperation.operationId}</p>
				{/if}
				<span
					class="oa-op-modal-header__auth"
					class:oa-op-modal-header__auth--public={selectedOperation.security.isPublic}
				>
					{selectedOperation.security.label}
				</span>
			</div>
		{/if}
	</div>
	<button
		type="button"
		class="oa-modal-close"
		aria-label="Close operation detail"
		onclick={closeDetailModal}
	>
		<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M6 18L18 6M6 6l12 12"
			/>
		</svg>
	</button>
{/snippet}

{#if detailModalOpen && selectedOperation}
	<div class="oa-root" class:dark={darkMode}>
		<OpenApiModal
			open={detailModalOpen}
			titleId={detailModalTitleId}
			{darkMode}
			size="docs"
			onClose={closeDetailModal}
			header={operationHeader}
		>
			{#key selectedOperation.id}
				<OpenApiOperationDetail
					operation={selectedOperation}
					spec={sanitizedSpec}
					{darkMode}
					{onSchemaGraphNavigate}
					{onShowInSchemaGraph}
				/>
			{/key}
		</OpenApiModal>
	</div>
{/if}

<style>
	.oa-path-browser {
		min-height: min(68vh, 860px);
		display: flex;
		flex-direction: column;
		font-family: var(--oa-font);
	}

	.oa-path-browser__doc-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: flex-end;
		gap: 0.5rem 1rem;
		margin-bottom: 0.65rem;
	}

	.oa-path-browser__auth-badge {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		border-radius: 9999px;
		padding: 0.2rem 0.55rem;
		font-size: 0.6875rem;
		font-weight: 700;
		line-height: 1.2;
		background: color-mix(in srgb, var(--oa-method-put, #d97706) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--oa-method-put, #d97706) 28%, transparent);
		color: var(--oa-method-put, #d97706);
	}

	.oa-path-browser__public-badge {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		align-self: center;
		border-radius: 9999px;
		padding: 0.12rem 0.4rem;
		font-size: 0.625rem;
		font-weight: 700;
		line-height: 1.2;
		background: color-mix(in srgb, var(--oa-method-post, #16a34a) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--oa-method-post, #16a34a) 28%, transparent);
		color: var(--oa-method-post, #16a34a);
	}

	.oa-path-browser__toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.55rem;
		margin-bottom: 0.75rem;
	}

	.oa-path-browser__expand-btn {
		flex-shrink: 0;
		font-size: 0.75rem;
		line-height: 1.25;
		color: var(--oa-text-muted, #64748b);
		background: var(--oa-panel, #fff);
		cursor: pointer;
	}

	.oa-path-browser--dark :global(.comparison-results__expand-btn) {
		border-color: rgba(56, 100, 150, 0.35);
		color: #94a3b8;
		background: transparent;
	}

	.oa-path-browser--dark :global(.comparison-results__expand-btn:hover) {
		background: rgba(7, 20, 40, 0.55);
		color: #e2e8f0;
	}

	.oa-path-browser__search {
		flex: 1 1 14rem;
		min-width: 0;
		min-height: 2.375rem;
		border: 1px solid var(--oa-panel-border);
		border-radius: var(--oa-radius);
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
		font-family: inherit;
		background: var(--oa-panel);
		color: var(--oa-text);
		box-shadow: 0 1px 0 color-mix(in srgb, var(--oa-panel-border) 35%, transparent);
	}

	.oa-path-browser__search:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--oa-focus-ring) 55%, var(--oa-panel-border));
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--oa-focus-ring) 18%, transparent);
	}

	.oa-path-browser__method-filter {
		min-height: 2.375rem;
		border: 1px solid var(--oa-panel-border);
		border-radius: var(--oa-radius);
		padding: 0.45rem 0.625rem;
		font-size: 0.8125rem;
		font-family: inherit;
		background: var(--oa-panel);
		color: var(--oa-text);
	}

	.oa-path-browser__count {
		border-radius: 9999px;
		background: color-mix(in srgb, var(--oa-chip-inactive) 88%, transparent);
		border: 1px solid color-mix(in srgb, var(--oa-panel-border) 80%, transparent);
		padding: 0.15rem 0.55rem;
		font-size: 0.6875rem;
		font-weight: 700;
		color: var(--oa-text-muted);
	}

	.oa-path-browser__list-panel {
		flex: 1 1 auto;
		min-height: min(62vh, 780px);
		border: 1px solid var(--oa-panel-border);
		border-radius: var(--oa-radius-lg);
		background: var(--oa-panel);
		box-shadow: var(--oa-panel-shadow);
		overflow: auto;
		padding: 0.3rem;
	}

	.oa-path-group + .oa-path-group {
		border-top: 1px solid color-mix(in srgb, var(--oa-panel-border) 65%, transparent);
		margin-top: 0.15rem;
		padding-top: 0.15rem;
	}

	.oa-path-group__header {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		width: 100%;
		padding: 0.5rem 0.45rem 0.35rem;
		border: none;
		border-radius: var(--oa-radius-sm);
		background: none;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
	}

	.oa-path-group__header:hover {
		background: color-mix(in srgb, var(--oa-focus-ring) 5%, transparent);
	}

	.oa-path-group__chevron {
		color: var(--oa-text-muted);
		font-size: 0.75rem;
	}

	.oa-path-group__title {
		margin: 0;
		flex: 1 1 auto;
		font-size: 0.6875rem;
		font-weight: 750;
		letter-spacing: 0.045em;
		text-transform: uppercase;
		color: var(--oa-text-muted);
	}

	.oa-path-group__description {
		margin: 0 0 0.4rem 1.35rem;
		font-size: 0.6875rem;
		color: var(--oa-text-muted);
		line-height: 1.4;
	}

	.oa-path-browser__list {
		list-style: none;
		margin: 0;
		padding: 0 0.15rem 0.45rem;
	}

	.oa-path-browser__item {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		width: 100%;
		padding: 0.5rem 0.55rem;
		margin-bottom: 0.15rem;
		border: 1px solid transparent;
		border-radius: var(--oa-radius);
		background: transparent;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			box-shadow 0.12s ease;
	}

	.oa-path-browser__item:hover {
		background: color-mix(in srgb, var(--oa-focus-ring) 7%, transparent);
		border-color: color-mix(in srgb, var(--oa-focus-ring) 16%, transparent);
	}

	.oa-path-browser__item--selected {
		background: color-mix(in srgb, var(--oa-focus-ring) 12%, transparent);
		border-color: color-mix(in srgb, var(--oa-focus-ring) 32%, transparent);
		box-shadow:
			inset 3px 0 0 var(--oa-focus-ring),
			0 1px 2px color-mix(in srgb, var(--oa-focus-ring) 12%, transparent);
	}

	.oa-path-browser__item:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--oa-focus-ring) 30%, transparent);
	}

	.oa-path-browser__item-text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
		flex: 1 1 auto;
	}

	.oa-path-browser__item-path {
		font-family: var(--oa-font-code);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--oa-text);
		word-break: break-all;
		letter-spacing: -0.01em;
	}

	.oa-path-browser__item-summary {
		font-size: 0.75rem;
		color: var(--oa-text-muted);
		line-height: 1.35;
	}

	.oa-path-browser__empty {
		padding: 2rem 0.75rem;
		font-size: 0.875rem;
		color: var(--oa-text-muted);
		text-align: center;
	}

	@media (max-width: 639px) {
		.oa-path-browser__toolbar {
			gap: 0.45rem;
		}

		.oa-path-browser__method-filter {
			flex: 1 1 auto;
		}
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	:global(.oa-op-modal-header) {
		min-width: 0;
		flex: 1;
	}

	:global(.oa-modal-title--path) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.625rem;
		font-size: 1rem;
		line-height: 1.35;
	}

	:global(.oa-modal-path) {
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.9375rem;
		font-weight: 600;
		word-break: break-all;
		min-width: 0;
		letter-spacing: -0.01em;
	}

	:global(.oa-op-modal-header__id) {
		margin: 0;
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--oa-text-muted, #64748b);
		word-break: break-all;
	}

	:global(.oa-op-modal-header__meta) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.65rem;
		margin-top: 0.35rem;
	}

	:global(.oa-op-modal-header__auth) {
		display: inline-flex;
		align-items: center;
		border-radius: 9999px;
		padding: 0.15rem 0.5rem;
		font-size: 0.6875rem;
		font-weight: 700;
		line-height: 1.2;
		background: color-mix(in srgb, var(--oa-method-put, #d97706) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--oa-method-put, #d97706) 28%, transparent);
		color: var(--oa-method-put, #d97706);
	}

	:global(.oa-op-modal-header__auth--public) {
		background: color-mix(in srgb, var(--oa-method-post, #16a34a) 12%, transparent);
		border-color: color-mix(in srgb, var(--oa-method-post, #16a34a) 28%, transparent);
		color: var(--oa-method-post, #16a34a);
	}
</style>
