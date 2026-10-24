<script lang="ts">
	import type { ApiIndex } from '$lib/openapi/apiReference';
	import { apiCategory, groupApisByCategory, searchApiIndex } from '$lib/openapi/apiCategories';

	interface Props {
		index: ApiIndex | null;
		apiId: string;
		sectionKey: string;
		/** Link for an API (and section); null section = the API's first section. */
		href: (apiId: string, sectionKey?: string) => string;
		overviewHref: string;
		categoryHref: (category: string) => string;
		/** Category shown on the overview, if any. */
		category?: string;
		onNavigate?: () => void;
	}

	let {
		index,
		apiId,
		sectionKey,
		href,
		overviewHref,
		categoryHref,
		category = '',
		onNavigate
	}: Props = $props();

	const OVERVIEW_ICON = 'M4 5h7v6H4zM13 5h7v14h-7zM4 13h7v6H4z';

	let query = $state('');
	let activeHit = $state(0);

	const groups = $derived(groupApisByCategory(index?.apis ?? []));
	const currentApi = $derived(index?.apis.find((a) => a.id === apiId) ?? null);
	/** The open category: the current API's, or the one shown on the overview. */
	const openCategory = $derived(currentApi ? apiCategory(currentApi) : category);
	const hits = $derived(searchApiIndex(index?.apis ?? [], query, 12));

	$effect(() => {
		hits;
		activeHit = 0;
	});

	function searchKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' && hits.length) {
			event.preventDefault();
			activeHit = (activeHit + 1) % hits.length;
		} else if (event.key === 'ArrowUp' && hits.length) {
			event.preventDefault();
			activeHit = (activeHit - 1 + hits.length) % hits.length;
		} else if (event.key === 'Enter' && hits[activeHit]) {
			event.preventDefault();
			document.getElementById(`api-hit-${activeHit}`)?.click();
		} else if (event.key === 'Escape') {
			query = '';
		}
	}

	function picked() {
		query = '';
		onNavigate?.();
	}
</script>

{#snippet icon(path: string)}
	<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d={path} /></svg>
{/snippet}

<nav class="nav" aria-label="API reference">
	<div class="search">
		<label for="api-search" class="sr-only">Find a resource or API</label>
		{@render icon('M21 21l-5-5m2-5.5a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z')}
		<input
			id="api-search"
			type="search"
			placeholder="Find a resource or API"
			autocomplete="off"
			spellcheck="false"
			bind:value={query}
			onkeydown={searchKeydown}
			role="combobox"
			aria-expanded={hits.length > 0}
			aria-controls="api-search-results"
			aria-autocomplete="list"
		/>
		<kbd aria-hidden="true">/</kbd>
		{#if query.trim()}
			<ul id="api-search-results" class="hits" role="listbox" aria-label="Matching resources">
				{#each hits as hit, i (hit.apiId + hit.key)}
					<li role="option" aria-selected={i === activeHit}>
						<a
							id="api-hit-{i}"
							href={href(hit.apiId, hit.key)}
							class:is-active={i === activeHit}
							onclick={picked}
						>
							<span class="hit-title">{hit.title}</span>
							<span class="hit-meta"
								>{hit.apiTitle}{hit.type === 'workflow' ? ' · workflow' : ''}</span
							>
						</a>
					</li>
				{:else}
					<li class="hits-empty">No resource or API matches "{query.trim()}".</li>
				{/each}
			</ul>
		{/if}
	</div>

	<a
		class="row overview"
		href={overviewHref}
		aria-current={!apiId && !category ? 'page' : undefined}
		onclick={onNavigate}>{@render icon(OVERVIEW_ICON)}<span>API overview</span></a
	>

	<p class="heading">Categories</p>
	<ul class="cats">
		{#each groups as g (g.category.id)}
			{@const open = g.category.id === openCategory}
			<li>
				<a
					class="row cat"
					class:is-open={open}
					href={categoryHref(g.category.id)}
					aria-current={!apiId && category === g.category.id ? 'page' : undefined}
					onclick={onNavigate}
				>
					{@render icon(g.category.icon)}<span>{g.category.title}</span><small
						>{g.apis.length}</small
					>
				</a>
				{#if open}
					<ul class="apis">
						{#each g.apis as api (api.id)}
							{@const isCurrent = api.id === apiId}
							<li>
								<a
									class="api"
									class:is-current={isCurrent}
									href={href(api.id)}
									aria-current={isCurrent && !sectionKey ? 'page' : undefined}
									onclick={onNavigate}
									><span>{api.title}</span><small>{api.sections.length}</small></a
								>
								{#if isCurrent}
									<ul class="sections">
										{#each api.sections as s (s.key)}
											<li>
												<a
													href={href(api.id, s.key)}
													aria-current={sectionKey === s.key ? 'page' : undefined}
													onclick={onNavigate}
												>
													<span>{s.title}</span>
													{#if s.type === 'workflow'}<span class="tag">workflow</span>{/if}
												</a>
											</li>
										{/each}
									</ul>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ul>
</nav>

<style>
	.nav {
		display: grid;
		gap: 0.25rem;
		align-content: start;
		font-family: var(--rb-font);
	}

	.i {
		flex: none;
		width: 1.125rem;
		height: 1.125rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.search {
		position: relative;
		margin-bottom: 0.5rem;
	}

	.search > .i {
		position: absolute;
		left: 0.625rem;
		top: 0.6875rem;
		width: 1rem;
		height: 1rem;
		color: var(--rb-ink-3);
		pointer-events: none;
	}

	.search input {
		width: 100%;
		height: 2.375rem;
		padding: 0 2rem;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.5rem;
		background: var(--rb-surface);
		color: var(--rb-ink);
		font: 0.875rem var(--rb-font);
	}

	.search input:focus {
		outline: 2px solid var(--rb-signal);
		outline-offset: 1px;
	}

	.search kbd {
		position: absolute;
		right: 0.5rem;
		top: 0.625rem;
		padding: 0 0.3rem;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.25rem;
		background: var(--rb-surface);
		color: var(--rb-ink-3);
		font: 500 0.66rem var(--rb-font-mono);
	}

	.hits {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(100% + 0.375rem);
		z-index: 40;
		max-height: 22rem;
		margin: 0;
		padding: 0.375rem;
		overflow: auto;
		list-style: none;
		background: var(--rb-surface);
		border: 1px solid var(--rb-line);
		border-radius: 0.625rem;
		box-shadow: var(--rb-shadow-pop);
	}

	.hits a {
		display: grid;
		gap: 0.0625rem;
		padding: 0.4375rem 0.5rem;
		border-radius: 0.375rem;
		color: var(--rb-ink);
		text-decoration: none;
	}

	.hits a:hover,
	.hits a.is-active {
		background: var(--rb-raised);
	}

	.hit-title {
		font-weight: 600;
		font-size: 0.875rem;
	}

	.hit-meta {
		font: 0.72rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	.hits-empty {
		padding: 0.5rem;
		font-size: 0.85rem;
		color: var(--rb-ink-3);
	}

	.heading {
		margin: 1rem 0.625rem 0.25rem;
		font: 600 0.66rem var(--rb-font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--rb-ink-3);
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.cats {
		display: grid;
		gap: 0.0625rem;
	}

	.row {
		display: grid;
		grid-template-columns: 1.125rem minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.625rem;
		min-height: 2.25rem;
		padding: 0.375rem 0.625rem;
		border-radius: 0.4375rem;
		color: var(--rb-ink-2);
		font-size: 0.875rem;
		font-weight: 500;
		text-decoration: none;
	}

	.overview {
		color: var(--rb-ink);
		font-weight: 600;
	}

	.row:hover {
		background: var(--rb-raised);
		color: var(--rb-ink);
	}

	.row .i {
		color: var(--rb-ink-3);
	}

	.cat.is-open {
		color: var(--rb-ink);
		font-weight: 600;
	}

	.row[aria-current='page'] {
		background: var(--rb-signal-soft);
		color: var(--rb-signal);
		font-weight: 600;
	}

	.row[aria-current='page'] .i,
	.cat.is-open .i {
		color: var(--rb-signal);
	}

	small {
		font: 0.72rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	.apis {
		margin: 0.125rem 0 0.5rem 1.4375rem;
		padding-left: 0.625rem;
		border-left: 1px solid var(--rb-line);
	}

	.api,
	.sections a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		min-height: 1.875rem;
		padding: 0.25rem 0.5rem;
		border-radius: 0.375rem;
		color: var(--rb-ink-2);
		font-size: 0.85rem;
		text-decoration: none;
	}

	.api:hover,
	.sections a:hover {
		background: var(--rb-raised);
		color: var(--rb-ink);
	}

	.api.is-current {
		color: var(--rb-ink);
		font-weight: 600;
	}

	.api[aria-current='page'],
	.sections a[aria-current='page'] {
		background: var(--rb-signal-soft);
		color: var(--rb-signal);
		font-weight: 600;
	}

	.sections {
		margin: 0.125rem 0 0.375rem 0.5rem;
		padding-left: 0.5rem;
		border-left: 1px solid var(--rb-line);
	}

	.sections a {
		font-size: 0.82rem;
	}

	.tag {
		font: 600 0.58rem var(--rb-font-mono);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--rb-ink-3);
	}

	.nav a:focus-visible {
		outline: 2px solid var(--rb-signal);
		outline-offset: -2px;
	}
</style>
