<script lang="ts">
	import type { ApiIndex } from '$lib/openapi/apiReference';
	import {
		API_CATEGORIES,
		apiCategory,
		groupApisByCategory,
		type ApiCategoryId
	} from '$lib/openapi/apiCategories';

	interface Props {
		index: ApiIndex;
		href: (apiId: string, sectionKey?: string) => string;
		/** Selected category, or '' for all. */
		category: string;
		categoryHref: (category: string) => string;
	}

	let { index, href, category, categoryHref }: Props = $props();

	type Api = ApiIndex['apis'][number];

	const totalOps = $derived(index.apis.reduce((n, a) => n + a.operationCount, 0));
	const apps = $derived(index.apis.filter((a) => !a.platform));
	const resourceCount = $derived(
		apps.reduce((n, a) => n + a.sections.filter((s) => s.type === 'resource').length, 0)
	);
	const workflowCount = $derived(
		apps.reduce((n, a) => n + a.sections.filter((s) => s.type === 'workflow').length, 0)
	);

	const counts = $derived(
		Object.fromEntries(
			API_CATEGORIES.map((c) => [c.id, index.apis.filter((a) => apiCategory(a) === c.id).length])
		) as Record<ApiCategoryId, number>
	);
	const tabs = $derived(API_CATEGORIES.filter((c) => counts[c.id] > 0));
	const current = $derived(tabs.find((c) => c.id === category) ?? null);

	// The filter keeps an API with all its resources when its name or group matches, otherwise only
	// the resources that match.
	let filter = $state('');
	const q = $derived(filter.trim().toLowerCase());

	function narrow(api: Api): Api {
		if (!q || `${api.title} ${api.group}`.toLowerCase().includes(q)) return api;
		return { ...api, sections: api.sections.filter((s) => s.title.toLowerCase().includes(q)) };
	}

	const groups = $derived(
		groupApisByCategory(
			index.apis
				.filter((a) => !current || apiCategory(a) === current.id)
				.map(narrow)
				.filter((a) => a.sections.length > 0)
		)
	);
	const matchCount = $derived(
		groups.reduce((n, g) => n + g.apis.reduce((m, a) => m + a.sections.length, 0), 0)
	);

	/** `aaa.eda.nokia.com` → `aaa` */
	const shortGroup = (group: string) => group.replace(/\.eda\.nokia\.com$/, '');
</script>

<div class="overview">
	<header class="head">
		<p class="crumb">
			API <span aria-hidden="true">›</span>
			{#if current}<a href={categoryHref('')}>Overview</a> <span aria-hidden="true">›</span>
				<b>{current.title}</b>{:else}<b>Overview</b>{/if}
		</p>
		<h1>{current ? current.title : `EDA REST API`} <span class="rel">{index.release}</span></h1>
		<p class="lede">
			{#if current}
				{current.blurb}
			{:else}
				{index.apis.length} APIs, {resourceCount} resources and {workflowCount} workflows ·
				{totalOps.toLocaleString('en')} endpoints. Pick a category or filter by name.
			{/if}
		</p>
	</header>

	<div class="toolbar">
		<div class="filter">
			<label for="api-dir-filter" class="sr-only">Filter APIs and resources</label>
			<svg viewBox="0 0 24 24" aria-hidden="true"
				><path d="M21 21l-5-5m2-5.5a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z" /></svg
			>
			<input
				id="api-dir-filter"
				type="search"
				placeholder="Filter by API or resource, e.g. bgp, interface, alarm"
				autocomplete="off"
				spellcheck="false"
				bind:value={filter}
			/>
			{#if q}
				<span class="filter-count" aria-live="polite">{matchCount} matches</span>
			{/if}
		</div>

		<nav class="tabs" aria-label="API categories">
			<a href={categoryHref('')} aria-current={!current ? 'page' : undefined}
				>All <span>{index.apis.length}</span></a
			>
			{#each tabs as c (c.id)}
				<a href={categoryHref(c.id)} aria-current={current?.id === c.id ? 'page' : undefined}
					>{c.title} <span>{counts[c.id]}</span></a
				>
			{/each}
		</nav>
	</div>

	{#each groups as g (g.category.id)}
		<section class="cat" aria-labelledby="cat-{g.category.id}">
			{#if !current}
				<div class="cat-head">
					<h2 id="cat-{g.category.id}">
						<a href={categoryHref(g.category.id)}>{g.category.title}</a>
					</h2>
					<p>{g.category.blurb}</p>
				</div>
			{:else}
				<h2 id="cat-{g.category.id}" class="sr-only">{g.category.title}</h2>
			{/if}
			<ul class="cards">
				{#each g.apis as api (api.id)}
					<li class="card" class:card--wide={api.sections.length > 14}>
						<div class="card-head">
							<a class="card-title" href={href(api.id)}>{api.title}</a>
							<span class="card-count">{api.sections.length}</span>
						</div>
						<p class="card-meta">
							{api.platform ? '/core' : `${shortGroup(api.group)}/${api.version}`}
						</p>
						<ul class="kinds" aria-label="{api.title} resources">
							{#each api.sections as s (s.key)}
								<li>
									<a href={href(api.id, s.key)} class:is-workflow={s.type === 'workflow'}
										>{s.title}{#if s.type === 'workflow'}<span class="wf">workflow</span>{/if}</a
									>
								</li>
							{/each}
						</ul>
					</li>
				{/each}
			</ul>
		</section>
	{:else}
		<p class="empty">
			Nothing matches "{filter.trim()}"{current ? ` in ${current.title}` : ''}.
			<button type="button" onclick={() => (filter = '')}>Clear the filter</button>
		</p>
	{/each}

	<section class="basics" aria-labelledby="basics-h">
		<h2 id="basics-h">Calling the API</h2>
		<dl>
			<div>
				<dt>Paths</dt>
				<dd>
					Resources <code>/apps/&lt;group&gt;/&lt;version&gt;/…</code>, workflows
					<code>/workflows/v1/…</code>, platform <code>/core/…</code>
				</dd>
			</div>
			<div>
				<dt>Auth</dt>
				<dd><code>Authorization: Bearer $TOKEN</code> on every request</dd>
			</div>
			<div>
				<dt>Namespaces</dt>
				<dd>
					<code>…/namespaces/eda/bridgedomains</code>; without <code>/namespaces/…</code> a list covers
					all namespaces
				</dd>
			</div>
		</dl>
	</section>
</div>

<style>
	.overview {
		display: grid;
		gap: 1.5rem;
		padding-bottom: 2rem;
		min-width: 0;
		container-type: inline-size;
	}

	.crumb {
		margin: 0;
		font: 500 0.75rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	.crumb a {
		color: var(--rb-ink-3);
	}

	.crumb b {
		font-weight: 500;
		color: var(--rb-ink-2);
	}

	h1 {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.625rem;
		margin: 0.375rem 0 0.375rem;
		font: 700 clamp(1.5rem, 2.8vw, 2rem) / 1.15 var(--rb-font-display);
		letter-spacing: -0.02em;
		color: var(--rb-ink);
	}

	.rel {
		padding: 0.125rem 0.4375rem;
		border-radius: 0.3125rem;
		background: var(--rb-signal-soft);
		color: var(--rb-signal);
		font: 600 0.8rem var(--rb-font-mono);
		letter-spacing: 0;
	}

	.lede {
		margin: 0;
		max-width: 70ch;
		font-size: 0.92rem;
		line-height: 1.5;
		color: var(--rb-ink-2);
	}

	/* toolbar: filter + category tabs, sticky while scrolling the list */
	.toolbar {
		position: sticky;
		top: 0;
		z-index: 5;
		display: grid;
		gap: 0.625rem;
		margin: 0 -0.25rem;
		padding: 0.5rem 0.25rem 0.625rem;
		background: var(--rb-bg);
		border-bottom: 1px solid var(--rb-line);
	}

	.filter {
		position: relative;
		display: flex;
		align-items: center;
	}

	.filter svg {
		position: absolute;
		left: 0.75rem;
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: var(--rb-ink-3);
		stroke-width: 1.8;
		stroke-linecap: round;
		pointer-events: none;
	}

	.filter input {
		width: 100%;
		height: 2.625rem;
		padding: 0 7.5rem 0 2.375rem;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.5rem;
		background: var(--rb-surface);
		color: var(--rb-ink);
		font: 0.92rem var(--rb-font);
	}

	.filter input:focus {
		outline: 2px solid var(--rb-signal);
		outline-offset: 1px;
	}

	.filter-count {
		position: absolute;
		right: 0.75rem;
		font: 0.72rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	.tabs {
		display: flex;
		gap: 0.375rem;
		overflow-x: auto;
		scrollbar-width: thin;
	}

	@container (min-width: 52rem) {
		.tabs {
			flex-wrap: wrap;
			overflow: visible;
		}
	}

	.tabs a {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.375rem;
		height: 2rem;
		padding: 0 0.75rem;
		border: 1px solid var(--rb-line);
		border-radius: 999px;
		background: var(--rb-surface);
		color: var(--rb-ink-2);
		font: 600 0.82rem var(--rb-font);
		text-decoration: none;
		white-space: nowrap;
	}

	.tabs a span {
		font: 500 0.7rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	.tabs a:hover {
		border-color: var(--rb-signal);
		color: var(--rb-signal);
	}

	.tabs a[aria-current='page'] {
		border-color: var(--rb-ink);
		background: var(--rb-ink);
		color: var(--rb-bg);
	}

	.tabs a[aria-current='page'] span {
		color: color-mix(in srgb, var(--rb-bg) 75%, transparent);
	}

	/* categories and API cards */
	.cat {
		display: grid;
		gap: 0.75rem;
		scroll-margin-top: 7rem;
	}

	.cat-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.75rem;
	}

	.cat-head h2 {
		margin: 0;
		font: 700 1.05rem var(--rb-font-display);
	}

	.cat-head h2 a {
		color: var(--rb-ink);
		text-decoration: none;
	}

	.cat-head h2 a:hover {
		color: var(--rb-signal);
	}

	.cat-head p {
		margin: 0;
		font-size: 0.84rem;
		color: var(--rb-ink-3);
	}

	.cards {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	@container (min-width: 40rem) {
		.cards {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.card--wide {
			grid-column: 1 / -1;
		}
	}

	@container (min-width: 64rem) {
		.cards {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
		padding: 0.875rem 1rem 1rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.75rem;
		background: var(--rb-surface);
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}

	.card:hover {
		border-color: var(--rb-line-strong);
		box-shadow: 0 14px 30px -24px rgba(10, 30, 80, 0.5);
	}

	.card-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.card-title {
		font-weight: 700;
		font-size: 0.98rem;
		color: var(--rb-ink);
		text-decoration: none;
	}

	.card-title:hover {
		color: var(--rb-signal);
	}

	.card-count {
		font: 500 0.7rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	.card-meta {
		margin: 0 0 0.625rem;
		font: 0.72rem var(--rb-font-mono);
		color: var(--rb-ink-3);
		overflow-wrap: anywhere;
	}

	.kinds {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3125rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.kinds a {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.375rem;
		background: var(--rb-bg);
		color: var(--rb-ink);
		font: 500 0.78rem var(--rb-font-mono);
		text-decoration: none;
	}

	.kinds a:hover {
		border-color: var(--rb-signal);
		background: var(--rb-signal-soft);
		color: var(--rb-signal);
	}

	.kinds a.is-workflow {
		border-style: dashed;
	}

	.wf {
		font: 600 0.56rem var(--rb-font-mono);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--rb-ink-3);
	}

	.empty {
		margin: 0;
		padding: 2rem 0;
		color: var(--rb-ink-3);
		font-size: 0.9rem;
	}

	.empty button {
		margin-left: 0.5rem;
		padding: 0;
		border: 0;
		background: none;
		color: var(--rb-signal);
		font: 600 0.9rem var(--rb-font);
		cursor: pointer;
	}

	/* calling the API: reference notes at the end */
	.basics {
		padding: 1rem 1.125rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.75rem;
		background: var(--rb-surface);
	}

	.basics h2 {
		margin: 0 0 0.625rem;
		font: 700 0.95rem var(--rb-font-display);
		color: var(--rb-ink);
	}

	.basics dl {
		display: grid;
		gap: 0.5rem;
		margin: 0;
	}

	.basics dl div {
		display: grid;
		gap: 0.125rem 1rem;
	}

	@container (min-width: 40rem) {
		.basics dl div {
			grid-template-columns: 7rem minmax(0, 1fr);
		}
	}

	.basics dt {
		font: 600 0.66rem var(--rb-font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--rb-ink-3);
	}

	.basics dd {
		margin: 0;
		font-size: 0.84rem;
		color: var(--rb-ink-3);
		overflow-wrap: anywhere;
	}

	.basics code {
		font: 0.78rem var(--rb-font-mono);
		color: var(--rb-ink);
	}

	.overview a:focus-visible,
	.empty button:focus-visible {
		outline: 2px solid var(--rb-signal);
		outline-offset: 1px;
	}

	@media (prefers-reduced-motion: reduce) {
		.card {
			transition: none;
		}
	}
</style>
