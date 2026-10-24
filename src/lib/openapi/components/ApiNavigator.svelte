<script lang="ts">
	import type { ApiIndex } from '$lib/openapi/apiReference';

	interface Props {
		index: ApiIndex | null;
		apiId: string;
		sectionKey: string;
		/** Link for an API (and section); null section = the API's first section. */
		href: (apiId: string, sectionKey?: string) => string;
		overviewHref: string;
		onNavigate?: () => void;
	}

	let { index, apiId, sectionKey, href, overviewHref, onNavigate }: Props = $props();

	let query = $state('');
	let activeHit = $state(0);
	let expanded = $state<Record<string, boolean>>({});

	const platform = $derived(index?.apis.find((a) => a.platform) ?? null);
	const apps = $derived(index?.apis.filter((a) => !a.platform) ?? []);

	type Hit = { apiId: string; apiTitle: string; key: string; title: string; type: string };
	const hits = $derived.by((): Hit[] => {
		const q = query.trim().toLowerCase();
		if (!q || !index) return [];
		const out: Array<Hit & { rank: number }> = [];
		for (const api of index.apis) {
			const apiMatch = `${api.title} ${api.group}`.toLowerCase().includes(q);
			for (const s of api.sections) {
				const t = s.title.toLowerCase();
				const rank = t === q ? 0 : t.startsWith(q) ? 1 : t.includes(q) ? 2 : apiMatch ? 3 : -1;
				if (rank >= 0)
					out.push({
						apiId: api.id,
						apiTitle: api.title,
						key: s.key,
						title: s.title,
						type: s.type,
						rank
					});
			}
		}
		return out.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title)).slice(0, 12);
	});

	$effect(() => {
		hits;
		activeHit = 0;
	});

	function isOpen(id: string): boolean {
		return expanded[id] ?? id === apiId;
	}

	function toggle(id: string) {
		expanded = { ...expanded, [id]: !isOpen(id) };
	}

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

<nav class="nav" aria-label="API reference">
	<div class="search">
		<label for="api-search" class="sr-only">Find a resource or API</label>
		<svg viewBox="0 0 24 24" aria-hidden="true"
			><path d="M21 21l-5-5m2-5.5a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z" /></svg
		>
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
		class="overview"
		href={overviewHref}
		aria-current={!apiId ? 'page' : undefined}
		onclick={onNavigate}>API overview</a
	>

	{#if platform}
		<p class="heading">Platform</p>
		<ul class="list">
			<li class="api">
				<button
					type="button"
					class="api-toggle"
					aria-expanded={isOpen(platform.id)}
					aria-controls="api-{platform.id}"
					onclick={() => toggle(platform.id)}
				>
					<span>Platform API <span class="count">/core</span></span>
					<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3 7.5 6 4.5 9" /></svg>
				</button>
				{#if isOpen(platform.id)}
					<ul class="sub" id="api-{platform.id}">
						{#each platform.sections as s (s.key)}
							<li>
								<a
									href={href(platform.id, s.key)}
									aria-current={apiId === platform.id && sectionKey === s.key ? 'page' : undefined}
									onclick={onNavigate}
								>
									<span>{s.title}</span><span class="count">{s.actions}</span>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		</ul>
	{/if}

	<p class="heading">Applications <span class="count">{apps.length}</span></p>
	<ul class="list">
		{#each apps as api (api.id)}
			<li class="api">
				<button
					type="button"
					class="api-toggle"
					aria-expanded={isOpen(api.id)}
					aria-controls="api-{api.id}"
					onclick={() => toggle(api.id)}
				>
					<span>{api.title}</span>
					<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3 7.5 6 4.5 9" /></svg>
				</button>
				{#if isOpen(api.id)}
					<ul class="sub" id="api-{api.id}">
						{#each api.sections as s (s.key)}
							<li>
								<a
									href={href(api.id, s.key)}
									aria-current={apiId === api.id && sectionKey === s.key ? 'page' : undefined}
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
</nav>

<style>
	.nav {
		display: grid;
		gap: 0.375rem;
		align-content: start;
		font-family: var(--rb-font);
	}

	.search {
		position: relative;
		margin-bottom: 0.375rem;
	}

	.search svg {
		position: absolute;
		left: 0.625rem;
		top: 0.6875rem;
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: var(--rb-ink-3);
		stroke-width: 1.8;
		stroke-linecap: round;
		pointer-events: none;
	}

	.search input {
		width: 100%;
		height: 2.375rem;
		padding: 0 2rem 0 2rem;
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

	.overview {
		display: block;
		padding: 0.5rem 0.625rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.5rem;
		background: var(--rb-surface);
		color: var(--rb-ink);
		font-weight: 600;
		font-size: 0.85rem;
		text-decoration: none;
	}

	.overview[aria-current='page'] {
		border-color: var(--rb-signal);
		color: var(--rb-signal);
	}

	.heading {
		display: flex;
		justify-content: space-between;
		margin: 0.75rem 0.5rem 0.125rem;
		font: 600 0.66rem var(--rb-font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--rb-ink-3);
	}

	.list,
	.sub {
		display: grid;
		gap: 1px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.sub {
		margin: 0.125rem 0 0.375rem 0.75rem;
		padding-left: 0.5rem;
		border-left: 1px solid var(--rb-line);
	}

	.list a,
	.api-toggle {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		min-height: 2rem;
		padding: 0.3125rem 0.5rem;
		border: 0;
		border-radius: 0.375rem;
		background: none;
		color: var(--rb-ink-2);
		font: 0.86rem var(--rb-font);
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}

	.list a:hover,
	.api-toggle:hover {
		background: var(--rb-raised);
		color: var(--rb-ink);
	}

	.list a[aria-current='page'] {
		background: var(--rb-signal-soft);
		color: var(--rb-signal);
		font-weight: 600;
	}

	.api-toggle {
		font-weight: 600;
		color: var(--rb-ink);
	}

	.api-toggle svg {
		width: 0.75rem;
		height: 0.75rem;
		flex-shrink: 0;
		fill: none;
		stroke: var(--rb-ink-3);
		stroke-width: 1.6;
		transition: transform 0.15s;
	}

	.api-toggle[aria-expanded='true'] svg {
		transform: rotate(90deg);
	}

	.count {
		font: 0.72rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	.tag {
		font: 600 0.6rem var(--rb-font-mono);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--rb-ink-3);
	}

	.nav :focus-visible {
		outline: 2px solid var(--rb-signal);
		outline-offset: -2px;
	}

	@media (prefers-reduced-motion: reduce) {
		.api-toggle svg {
			transition: none;
		}
	}
</style>
