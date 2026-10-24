<script lang="ts">
	import { browser } from '$app/environment';
	import { tick, type Snippet } from 'svelte';
	import OpenApiMethodBadge from '$lib/openapi/components/OpenApiMethodBadge.svelte';
	import OpenApiOperationDetail from '$lib/openapi/components/OpenApiOperationDetail.svelte';
	import { sanitizeSpecForDisplay } from '$lib/openapi/sanitizeSpecForDisplay';
	import {
		buildPathBrowserData,
		filterPathBrowserOperations,
		findOperationByDeepLinkId,
		formatOpenApiTagLabel,
		getOperationDeepLinkId,
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

	/** Methods with a toggle; others (head, options) always show. */
	const METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];

	let searchInput = $state('');
	let debouncedSearch = $state('');
	let enabledMethods = $state<Set<HttpMethod>>(new Set(METHODS));
	let selectedOperationId = $state('');
	let detailOpen = $state(false);
	let browseOpen = $state(false);
	let activeTag = $state('');
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let searchEl = $state<HTMLInputElement | null>(null);
	let listEl = $state<HTMLDivElement | null>(null);
	let detailEl = $state<HTMLElement | null>(null);
	/** The row that opened the detail, to give focus back on close. */
	let openerId = '';

	const detailTitleId = 'openapi-path-detail-title';

	const sanitizedSpec = $derived(sanitizeSpecForDisplay(spec));
	const browserData = $derived(buildPathBrowserData(sanitizedSpec));
	const allOperations = $derived(browserData.tagGroups.flatMap((g) => g.operations));

	const methodCounts = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const op of allOperations) counts[op.method] = (counts[op.method] ?? 0) + 1;
		return counts;
	});

	const isFiltering = $derived(
		Boolean(debouncedSearch.trim()) || METHODS.some((m) => !enabledMethods.has(m))
	);

	const filteredOperations = $derived(
		filterPathBrowserOperations(allOperations, debouncedSearch, 'all').filter(
			(op) => !METHODS.includes(op.method) || enabledMethods.has(op.method)
		)
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

	function tagAnchor(tag: string): string {
		return `oa-tag-${tag.replace(/[^A-Za-z0-9_-]/g, '-')}`;
	}

	$effect(() => {
		const value = searchInput;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			debouncedSearch = value;
		}, 150);
		return () => {
			if (searchTimer) clearTimeout(searchTimer);
		};
	});

	// A new spec starts with nothing open and no filters.
	$effect(() => {
		specId;
		sanitizedSpec;
		selectedOperationId = '';
		detailOpen = false;
		searchInput = '';
		enabledMethods = new Set(METHODS);
		activeTag = browserData.tagGroups[0]?.name ?? '';
	});

	// Deep link: #operationId opens that endpoint.
	$effect(() => {
		if (!browser || allOperations.length === 0) return;
		const hashId = initialOperationId || window.location.hash.slice(1);
		if (!hashId) return;
		const match = findOperationByDeepLinkId(allOperations, hashId);
		if (!match) return;
		if (match.id === selectedOperationId && detailOpen) return;
		void selectOperation(match, false);
		void tick().then(() =>
			listEl
				?.querySelector<HTMLElement>(`[data-op-id="${CSS.escape(match.id)}"]`)
				?.scrollIntoView({ block: 'center' })
		);
	});

	// Highlight the tag whose section is at the top of the list while scrolling.
	$effect(() => {
		if (!browser || !listEl) return;
		visibleTagGroups;
		const sections = Array.from(listEl.querySelectorAll<HTMLElement>('[data-tag]'));
		if (sections.length === 0) return;
		const observer = new IntersectionObserver(
			(entries) => {
				const top = entries
					.filter((e) => e.isIntersecting)
					.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
				if (top) activeTag = (top.target as HTMLElement).dataset.tag ?? activeTag;
			},
			{ rootMargin: '-80px 0px -70% 0px' }
		);
		for (const section of sections) observer.observe(section);
		return () => observer.disconnect();
	});

	async function selectOperation(operation: OpenApiOperation, updateHash = true) {
		const deepLinkId = getOperationDeepLinkId(operation);
		selectedOperationId = operation.id;
		openerId = operation.id;
		detailOpen = true;
		onOperationChange?.(deepLinkId);
		await tick();
		detailEl?.querySelector<HTMLElement>(`#${detailTitleId}`)?.focus();

		if (!browser || !updateHash) return;
		const nextHash = `#${deepLinkId}`;
		if (window.location.hash === nextHash) return;
		history.replaceState(
			history.state,
			'',
			`${window.location.pathname}${window.location.search}${nextHash}`
		);
	}

	async function closeDetail() {
		if (!detailOpen) return;
		detailOpen = false;
		if (browser && window.location.hash) {
			history.replaceState(
				history.state,
				'',
				`${window.location.pathname}${window.location.search}`
			);
			window.dispatchEvent(new HashChangeEvent('hashchange'));
		}
		await tick();
		listEl?.querySelector<HTMLElement>(`[data-op-id="${CSS.escape(openerId)}"]`)?.focus();
	}

	function toggleMethod(method: HttpMethod) {
		const next = new Set(enabledMethods);
		if (next.has(method)) next.delete(method);
		else next.add(method);
		enabledMethods = next;
	}

	function clearFilters() {
		searchInput = '';
		debouncedSearch = '';
		enabledMethods = new Set(METHODS);
	}

	function jumpToTag(tag: string) {
		activeTag = tag;
		browseOpen = false;
		document.getElementById(tagAnchor(tag))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}

	/** Arrow keys move between endpoint rows. */
	function listKeydown(event: KeyboardEvent) {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		const rows = Array.from(listEl?.querySelectorAll<HTMLElement>('[data-op-id]') ?? []);
		const i = rows.indexOf(document.activeElement as HTMLElement);
		if (i < 0) return;
		event.preventDefault();
		rows[Math.max(0, Math.min(rows.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
	}

	/** `/` focuses the endpoint filter here (capture phase, ahead of the header's Jump to a CRD). */
	function windowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && detailOpen) {
			event.preventDefault();
			void closeDetail();
			return;
		}
		if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
		event.preventDefault();
		searchEl?.focus();
	}

	function pathParts(path: string): Array<{ text: string; param: boolean }> {
		return path
			.split(/(\{[^}]+\})/)
			.filter(Boolean)
			.map((text) => ({ text, param: text.startsWith('{') }));
	}

	function operationSummary(op: OpenApiOperation): string {
		return op.summary || op.operationId || '';
	}
</script>

<svelte:window onkeydowncapture={windowKeydown} />

<div
	class="oa-bench oa-root"
	class:oa-bench--detail={detailOpen && !!selectedOperation}
	class:dark={darkMode}
>
	<aside class="oa-side" class:oa-side--open={browseOpen} aria-label="Browse this API">
		{#if appsCatalog}
			<div class="oa-side__block">
				<p class="oa-side__label">API</p>
				{@render appsCatalog()}
			</div>
		{/if}
		<div class="oa-side__block">
			<label class="oa-side__label" for="openapi-path-search">Filter</label>
			<div class="oa-side__search">
				<input
					id="openapi-path-search"
					bind:this={searchEl}
					type="search"
					placeholder="Path, operationId or summary"
					bind:value={searchInput}
					autocomplete="off"
					spellcheck="false"
				/>
				<kbd aria-hidden="true">/</kbd>
			</div>
		</div>
		<div class="oa-side__block">
			<p class="oa-side__label" id="oa-methods-label">Methods</p>
			<div class="oa-methods" role="group" aria-labelledby="oa-methods-label">
				{#each METHODS as method (method)}
					<button
						type="button"
						class="oa-method-toggle oa-method-toggle--{method}"
						aria-pressed={enabledMethods.has(method)}
						disabled={!methodCounts[method]}
						onclick={() => toggleMethod(method)}
					>
						{method.toUpperCase()} <span>{methodCounts[method] ?? 0}</span>
					</button>
				{/each}
			</div>
		</div>
		{#if !browserData.securitySummary.isOpen && browserData.securitySummary.label}
			<p class="oa-side__auth" title="Document-level security (operations may override)">
				Auth: <b>{browserData.securitySummary.label}</b>
			</p>
		{/if}
		<nav class="oa-side__block oa-side__tags-block" aria-label="Tags">
			<p class="oa-side__label">Tags</p>
			<ul class="oa-tags">
				{#each visibleTagGroups as group (group.name)}
					<li>
						<a
							href="#{tagAnchor(group.name)}"
							class:is-active={activeTag === group.name}
							aria-current={activeTag === group.name ? 'location' : undefined}
							onclick={(e) => {
								e.preventDefault();
								jumpToTag(group.name);
							}}
						>
							<span>{formatOpenApiTagLabel(group.name)}</span>
							<span class="oa-tags__count">{group.operations.length}</span>
						</a>
					</li>
				{/each}
			</ul>
		</nav>
	</aside>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="oa-list" bind:this={listEl} onkeydown={listKeydown}>
		<div class="oa-list__bar">
			<button
				type="button"
				class="oa-browse-toggle"
				aria-expanded={browseOpen}
				onclick={() => (browseOpen = !browseOpen)}
			>
				{browseOpen ? 'Hide filters and tags' : 'Filters and tags'}
			</button>
			<span class="oa-list__count" aria-live="polite">
				{filteredOperations.length === browserData.totalOperations
					? `${browserData.totalOperations} endpoints`
					: `${filteredOperations.length} of ${browserData.totalOperations} endpoints`}
			</span>
			{#if isFiltering}
				<button type="button" class="oa-link-btn" onclick={clearFilters}>Clear filters</button>
			{/if}
		</div>

		{#if browserData.totalOperations === 0}
			<p class="oa-list__empty">This specification defines no paths.</p>
		{:else if visibleTagGroups.length === 0}
			<div class="oa-list__empty">
				<p>No endpoint matches{debouncedSearch.trim() ? ` "${debouncedSearch.trim()}"` : ''}.</p>
				<button type="button" class="oa-btn-sm" onclick={clearFilters}>Clear filters</button>
			</div>
		{:else}
			{#each visibleTagGroups as group (group.name)}
				<section class="oa-group" id={tagAnchor(group.name)} data-tag={group.name}>
					<h3 class="oa-group__title">
						{formatOpenApiTagLabel(group.name)}
						<span>{group.operations.length}</span>
					</h3>
					{#if group.description}
						<p class="oa-group__desc">{group.description}</p>
					{/if}
					<ul class="oa-ops">
						{#each group.operations as operation (operation.id)}
							{@const current = detailOpen && selectedOperation?.id === operation.id}
							<li>
								<button
									type="button"
									class="oa-op"
									class:is-current={current}
									data-op-id={operation.id}
									aria-current={current ? 'true' : undefined}
									aria-controls={current ? 'oa-detail' : undefined}
									onclick={() => selectOperation(operation)}
								>
									<OpenApiMethodBadge method={operation.method} compact />
									<span class="oa-op__path"
										>{#each pathParts(operation.path) as part}{#if part.param}<em>{part.text}</em
												>{:else}{part.text}{/if}{/each}</span
									>
									{#if operation.deprecated}
										<span class="oa-op__tag oa-op__tag--deprecated">Deprecated</span>
									{:else if operation.security.isPublic}
										<span class="oa-op__tag" title="No authentication required">Public</span>
									{/if}
									{#if operationSummary(operation)}
										<span class="oa-op__summary">{operationSummary(operation)}</span>
									{/if}
								</button>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		{/if}
	</div>

	{#if detailOpen && selectedOperation}
		<aside id="oa-detail" class="oa-detail" bind:this={detailEl} aria-labelledby={detailTitleId}>
			<header class="oa-detail__head">
				<OpenApiMethodBadge method={selectedOperation.method} />
				<h2 id={detailTitleId} class="oa-detail__path" tabindex="-1">
					{#each pathParts(selectedOperation.path) as part}{#if part.param}<em>{part.text}</em
							>{:else}{part.text}{/if}{/each}
				</h2>
				<button
					type="button"
					class="oa-detail__close"
					aria-label="Close endpoint detail"
					onclick={closeDetail}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18L18 6M6 6l12 12" /></svg>
				</button>
				{#if selectedOperation.operationId}
					<p class="oa-detail__id">{selectedOperation.operationId}</p>
				{/if}
			</header>
			<div class="oa-detail__body">
				{#key selectedOperation.id}
					<OpenApiOperationDetail
						operation={selectedOperation}
						spec={sanitizedSpec}
						{darkMode}
						{onSchemaGraphNavigate}
						{onShowInSchemaGraph}
					/>
				{/key}
			</div>
		</aside>
	{/if}
</div>

<style>
	/* Workbench: sidebar | endpoint list | endpoint detail (third column on wide screens). */
	.oa-bench {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0 1.5rem;
		align-items: start;
		font-family: var(--rb-font);
		color: var(--rb-ink);
	}

	@media (min-width: 900px) {
		.oa-bench {
			grid-template-columns: 16.5rem minmax(0, 1fr);
		}
	}

	@media (min-width: 1280px) {
		.oa-bench--detail {
			grid-template-columns: 15rem minmax(0, 1fr) minmax(26rem, 36rem);
		}
	}

	/* sidebar */
	.oa-side {
		display: none;
		gap: 1rem;
		align-content: start;
		padding-bottom: 1rem;
	}

	.oa-side--open {
		display: grid;
	}

	@media (min-width: 900px) {
		.oa-side {
			display: grid;
			position: sticky;
			top: 4.75rem;
			max-height: calc(100vh - 5.5rem);
			overflow: auto;
			padding-right: 0.25rem;
		}
	}

	.oa-side__block {
		display: grid;
		gap: 0.375rem;
		min-width: 0;
	}

	.oa-side__label {
		margin: 0;
		font: 600 0.66rem var(--rb-font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--rb-ink-3);
	}

	.oa-side__search {
		position: relative;
	}

	.oa-side__search input {
		width: 100%;
		height: 2.25rem;
		padding: 0 2rem 0 0.625rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.5rem;
		background: var(--rb-raised);
		color: var(--rb-ink);
		font: 0.85rem var(--rb-font);
	}

	.oa-side__search input:focus {
		outline: 2px solid var(--rb-signal);
		outline-offset: 1px;
		background: var(--rb-surface);
	}

	.oa-side__search kbd {
		position: absolute;
		right: 0.5rem;
		top: 50%;
		transform: translateY(-50%);
		font: 500 0.66rem var(--rb-font-mono);
		padding: 0 0.3rem;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.25rem;
		color: var(--rb-ink-3);
		background: var(--rb-surface);
	}

	.oa-methods {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3125rem;
	}

	.oa-method-toggle {
		display: inline-flex;
		gap: 0.3rem;
		align-items: center;
		min-height: 1.875rem;
		padding: 0 0.5rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.3125rem;
		background: var(--rb-surface);
		color: var(--rb-ink-3);
		font: 700 0.68rem var(--rb-font-mono);
		cursor: pointer;
	}

	.oa-method-toggle span {
		font-weight: 500;
	}

	.oa-method-toggle:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.oa-method-toggle[aria-pressed='true'] {
		border-color: transparent;
	}
	.oa-method-toggle--get[aria-pressed='true'] {
		background: var(--oa-method-get-bg);
		color: var(--oa-method-get);
	}
	.oa-method-toggle--post[aria-pressed='true'] {
		background: var(--oa-method-post-bg);
		color: var(--oa-method-post);
	}
	.oa-method-toggle--put[aria-pressed='true'] {
		background: var(--oa-method-put-bg);
		color: var(--oa-method-put);
	}
	.oa-method-toggle--patch[aria-pressed='true'] {
		background: var(--oa-method-patch-bg);
		color: var(--oa-method-patch);
	}
	.oa-method-toggle--delete[aria-pressed='true'] {
		background: var(--oa-method-delete-bg);
		color: var(--oa-method-delete);
	}

	.oa-side__auth {
		margin: 0;
		font-size: 0.8rem;
		color: var(--rb-ink-3);
	}

	.oa-side__auth b {
		font: 600 0.75rem var(--rb-font-mono);
		color: var(--oa-method-put);
	}

	.oa-tags {
		display: grid;
		gap: 1px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.oa-tags a {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.3125rem 0.5rem;
		border-radius: 0.375rem;
		font-size: 0.84rem;
		color: var(--rb-ink-2);
		text-decoration: none;
	}

	.oa-tags a:hover {
		background: var(--rb-raised);
	}

	.oa-tags a.is-active {
		background: var(--rb-signal-soft);
		color: var(--rb-signal);
		font-weight: 600;
	}

	.oa-tags__count {
		font: 0.72rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	/* list */
	.oa-list {
		min-width: 0;
		padding-bottom: 2rem;
	}

	.oa-list__bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		margin-bottom: 0.25rem;
		font-size: 0.82rem;
		color: var(--rb-ink-3);
	}

	.oa-browse-toggle {
		min-height: 2.25rem;
		padding: 0 0.75rem;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.5rem;
		background: var(--rb-surface);
		color: var(--rb-ink);
		font: 600 0.82rem var(--rb-font);
		cursor: pointer;
	}

	@media (min-width: 900px) {
		.oa-browse-toggle {
			display: none;
		}
	}

	.oa-list__count {
		font-family: var(--rb-font-mono);
		font-size: 0.75rem;
	}

	.oa-link-btn {
		border: 0;
		background: none;
		padding: 0;
		color: var(--rb-signal);
		font: 600 0.82rem var(--rb-font);
		cursor: pointer;
	}

	.oa-list__empty {
		display: grid;
		justify-items: start;
		gap: 0.5rem;
		margin: 0;
		padding: 2rem 0;
		color: var(--rb-ink-3);
	}

	.oa-list__empty p {
		margin: 0;
	}

	.oa-btn-sm {
		height: 2rem;
		padding: 0 0.75rem;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.4375rem;
		background: var(--rb-surface);
		color: var(--rb-ink);
		font: 600 0.8rem var(--rb-font);
		cursor: pointer;
	}

	.oa-group {
		scroll-margin-top: 4.75rem;
	}

	.oa-group__title {
		position: sticky;
		top: 3.5rem;
		z-index: 2;
		display: flex;
		align-items: baseline;
		gap: 0.625rem;
		margin: 0;
		padding: 0.875rem 0 0.5rem;
		background: var(--rb-bg);
		font: 700 0.95rem var(--rb-font-display);
		color: var(--rb-ink);
	}

	@media (min-width: 640px) {
		.oa-group__title {
			top: 4rem;
		}
	}

	.oa-group__title span {
		font: 500 0.72rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	.oa-group__desc {
		margin: -0.25rem 0 0.5rem;
		font-size: 0.82rem;
		color: var(--rb-ink-3);
		max-width: 80ch;
	}

	.oa-ops {
		margin: 0 0 0.5rem;
		padding: 0;
		list-style: none;
		border: 1px solid var(--rb-line);
		border-radius: 0.625rem;
		background: var(--rb-surface);
		overflow: hidden;
	}

	.oa-ops li + li {
		border-top: 1px solid var(--rb-line);
	}

	.oa-op {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.125rem 0.75rem;
		width: 100%;
		padding: 0.5625rem 0.75rem;
		border: 0;
		background: none;
		color: inherit;
		text-align: left;
		font: inherit;
		cursor: pointer;
	}

	.oa-op:hover {
		background: var(--rb-raised);
	}

	.oa-op:focus-visible {
		outline: 2px solid var(--rb-signal);
		outline-offset: -2px;
	}

	.oa-op.is-current {
		background: var(--rb-signal-soft);
		box-shadow: inset 2px 0 0 var(--rb-signal);
	}

	.oa-op__path {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font: 500 0.83rem var(--rb-font-mono);
		color: var(--rb-ink);
	}

	.oa-op__path em,
	.oa-detail__path em {
		font-style: normal;
		color: var(--rb-code);
	}

	.oa-op__tag {
		grid-column: 3;
		grid-row: 1;
		padding: 0.1875rem 0.375rem;
		border-radius: 0.25rem;
		background: var(--rb-ok-soft);
		color: var(--rb-ok);
		font: 600 0.62rem var(--rb-font-mono);
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.oa-op__tag--deprecated {
		background: var(--rb-raised);
		color: var(--rb-removed);
	}

	.oa-op__summary {
		grid-column: 2 / -1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.8rem;
		color: var(--rb-ink-3);
	}

	/* detail */
	.oa-detail {
		position: fixed;
		inset: 0;
		z-index: 70;
		overflow: auto;
		background: var(--rb-surface);
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}

	@media (min-width: 900px) and (max-width: 1279px) {
		.oa-detail {
			inset: 0 0 0 auto;
			width: min(40rem, 92vw);
			border-left: 1px solid var(--rb-line);
			box-shadow: var(--rb-shadow-pop);
		}
	}

	@media (min-width: 1280px) {
		.oa-detail {
			position: sticky;
			top: 4.75rem;
			z-index: 1;
			max-height: calc(100vh - 5.5rem);
			border: 1px solid var(--rb-line);
			border-radius: 0.75rem;
		}
	}

	.oa-detail__head {
		position: sticky;
		top: 0;
		z-index: 1;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.25rem 0.625rem;
		padding: 0.875rem 1rem 0.75rem;
		padding-top: max(0.875rem, env(safe-area-inset-top, 0px));
		background: var(--rb-surface);
		border-bottom: 1px solid var(--rb-line);
	}

	.oa-detail__path {
		margin: 0;
		font: 600 0.92rem var(--rb-font-mono);
		color: var(--rb-ink);
		word-break: break-all;
	}

	.oa-detail__path:focus {
		outline: none;
	}

	.oa-detail__id {
		grid-column: 2 / -1;
		margin: 0;
		font: 0.75rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	.oa-detail__close {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.5rem;
		background: var(--rb-surface);
		color: var(--rb-ink-2);
		cursor: pointer;
	}

	.oa-detail__close svg {
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
	}

	.oa-detail__close:focus-visible {
		outline: 2px solid var(--rb-signal);
		outline-offset: 1px;
	}

	.oa-detail__body {
		padding: 0.875rem 1rem 1.5rem;
		min-width: 0;
	}
</style>
