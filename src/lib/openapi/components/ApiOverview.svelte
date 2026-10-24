<script lang="ts">
	import type { ApiIndex } from '$lib/openapi/apiReference';
	import type { OpenApiManifestEntry } from '$lib/openapi/types';
	import {
		API_CATEGORIES,
		POPULAR_RESOURCES,
		apiCategory,
		resourcePath,
		searchApiIndex,
		type ApiCategory
	} from '$lib/openapi/apiCategories';

	interface Props {
		index: ApiIndex;
		/** Every spec of the release, including ones with no endpoints. */
		manifest?: OpenApiManifestEntry[];
		href: (apiId: string, sectionKey?: string) => string;
		/** Selected category, or '' for the landing page. */
		category: string;
		categoryHref: (category: string) => string;
	}

	let { index, manifest = [], href, category, categoryHref }: Props = $props();

	type Api = ApiIndex['apis'][number];
	type Section = Api['sections'][number];

	const SEARCH_ICON = 'M21 21l-5-5m2-5.5a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z';

	const sectionCount = $derived(index.apis.reduce((n, a) => n + a.sections.length, 0));
	const apisIn = (id: string) => index.apis.filter((a) => apiCategory(a) === id);
	const categories = $derived(API_CATEGORIES.filter((c) => apisIn(c.id).length > 0));
	const current = $derived(categories.find((c) => c.id === category) ?? null);
	const currentIndex = $derived(current ? categories.indexOf(current) : -1);

	/** `aaa.eda.nokia.com` → `aaa` */
	const shortGroup = (group: string) => group.replace(/\.eda\.nokia\.com$/, '');
	const apiMeta = (api: Api) =>
		api.platform ? '/core' : `${shortGroup(api.group)}/${api.version}`;

	function tile(c: ApiCategory) {
		const apis = apisIn(c.id);
		const kinds = apis.flatMap((a) =>
			a.sections.filter((s) => s.type === 'resource').map((s) => s.title)
		);
		const examples = [
			...POPULAR_RESOURCES.filter((p) => kinds.includes(p)),
			...kinds.filter((k) => !POPULAR_RESOURCES.includes(k))
		].slice(0, 4);
		return {
			apis: apis.length,
			sections: apis.reduce((n, a) => n + a.sections.length, 0),
			examples
		};
	}

	const popular = $derived(
		POPULAR_RESOURCES.map((title) => {
			for (const api of index.apis) {
				const s = api.sections.find((x) => x.title === title && x.type === 'resource');
				if (s) return { title, api, s };
			}
			return null;
		}).filter((p) => p !== null)
	);

	/** Every spec in the release, A–Z, with the ones that publish no endpoints marked. */
	const allApis = $derived.by(() => {
		const listed = new Set(index.apis.map((a) => a.id));
		const empty = manifest
			.filter((e) => !listed.has(e.id))
			.map((e) => ({
				id: e.id,
				title: e.title.replace(/\s*Application APIs\.?$/i, '').replace(/\.$/, ''),
				meta: `${shortGroup(e.group)}/${e.apiVersion}`,
				count: 0
			}));
		return [
			...index.apis.map((a) => ({
				id: a.id,
				title: a.title,
				meta: apiMeta(a),
				count: a.sections.length
			})),
			...empty
		].sort((a, b) => a.title.localeCompare(b.title));
	});

	/* ---------- search (landing) ---------- */
	let query = $state('');
	let active = $state(0);
	const hits = $derived(searchApiIndex(index.apis, query, 8));
	$effect(() => {
		hits;
		active = 0;
	});

	function searchKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' && hits.length) {
			event.preventDefault();
			active = (active + 1) % hits.length;
		} else if (event.key === 'ArrowUp' && hits.length) {
			event.preventDefault();
			active = (active - 1 + hits.length) % hits.length;
		} else if (event.key === 'Enter' && hits[active]) {
			event.preventDefault();
			document.getElementById(`api-find-${active}`)?.click();
		} else if (event.key === 'Escape') {
			query = '';
		}
	}

	/* ---------- category table ---------- */
	let filter = $state('');
	let show = $state<'all' | 'resources' | 'workflows'>('all');
	$effect(() => {
		category;
		filter = '';
		show = 'all';
	});

	const rows = $derived.by(() => {
		if (!current) return [];
		const q = filter.trim().toLowerCase();
		return apisIn(current.id)
			.map((api) => {
				const apiMatch = !q || `${api.title} ${api.group}`.toLowerCase().includes(q);
				const sections = api.sections.filter(
					(s) =>
						(show === 'all' || (show === 'workflows') === (s.type === 'workflow')) &&
						(apiMatch || s.title.toLowerCase().includes(q))
				);
				return { api, sections };
			})
			.filter((r) => r.sections.length > 0);
	});
	const currentTotal = $derived(
		current ? apisIn(current.id).reduce((n, a) => n + a.sections.length, 0) : 0
	);

	function scopeLabel(api: Api, s: Section): string {
		if (api.platform) return '—';
		return s.scope === 'Namespaced' ? 'Namespaced' : s.scope === 'Cluster' ? 'Cluster' : '—';
	}

	function pathParts(path: string): Array<{ text: string; param: boolean }> {
		return path
			.split(/(\{[^}]+\})/)
			.filter(Boolean)
			.map((text) => ({ text, param: text.startsWith('{') }));
	}
</script>

{#snippet icon(path: string)}
	<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d={path} /></svg>
{/snippet}

<div class="ov">
	{#if !current}
		<!-- Landing: search, categories, popular resources, every API A–Z -->
		<header>
			<p class="crumb">API <span aria-hidden="true">›</span> <b>Overview</b></p>
			<h1>EDA REST API <span class="rel">{index.release}</span></h1>
			<p class="lede">
				{index.apis.length} APIs · {sectionCount} resources and workflows · every request with a ready
				curl example.
			</p>
			<div class="search">
				<label for="api-find" class="sr-only">Search resources and APIs</label>
				{@render icon(SEARCH_ICON)}
				<input
					id="api-find"
					type="search"
					placeholder="Search {sectionCount} resources and {index.apis.length} APIs, e.g. BGPPeer"
					autocomplete="off"
					spellcheck="false"
					bind:value={query}
					onkeydown={searchKeydown}
					role="combobox"
					aria-expanded={query.trim().length > 0}
					aria-controls="api-find-results"
					aria-autocomplete="list"
				/>
				{#if query.trim()}
					<ul id="api-find-results" class="hits" role="listbox" aria-label="Matching resources">
						{#each hits as hit, i (hit.apiId + hit.key)}
							<li role="option" aria-selected={i === active}>
								<a id="api-find-{i}" href={href(hit.apiId, hit.key)} class:is-active={i === active}>
									<b>{hit.title}</b>
									<span
										>{hit.apiTitle} · {API_CATEGORIES.find((c) => c.id === hit.category)
											?.title}</span
									>
									<em
										>{hit.type === 'workflow'
											? 'workflow'
											: hit.scope === 'Namespaced'
												? 'Namespaced'
												: hit.scope === 'Cluster'
													? 'Cluster'
													: ''}</em
									>
								</a>
							</li>
						{:else}
							<li class="hits-empty">No resource or API matches "{query.trim()}".</li>
						{/each}
					</ul>
				{/if}
			</div>
		</header>

		<section aria-labelledby="cats-h">
			<div class="h2row">
				<h2 id="cats-h">Browse by category</h2>
				<span>{categories.length} categories</span>
			</div>
			<ul class="tiles">
				{#each categories as c (c.id)}
					{@const t = tile(c)}
					<li>
						<a class="tile" href={categoryHref(c.id)}>
							<span class="tile-icon">{@render icon(c.icon)}</span>
							<b>{c.title}</b>
							<span class="tile-blurb">{c.blurb}</span>
							<span class="tile-stats"
								>{t.apis}
								{t.apis === 1 ? 'API' : 'APIs'} · {t.sections}
								{t.sections === 1 ? 'resource' : 'resources'}</span
							>
							{#if t.examples.length}
								<span class="tile-ex">
									{#each t.examples as e (e)}<span>{e}</span>{/each}
								</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		</section>

		{#if popular.length}
			<section aria-labelledby="pop-h">
				<h2 id="pop-h">Popular resources</h2>
				<ul class="pop">
					{#each popular as p (p.title)}
						<li>
							<a href={href(p.api.id, p.s.key)}>{p.title}<small>{p.api.title}</small></a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section aria-labelledby="all-h">
			<div class="h2row">
				<h2 id="all-h">All APIs A–Z</h2>
				<span>{allApis.length} specs in {index.release}</span>
			</div>
			<ul class="az">
				{#each allApis as a (a.id)}
					<li>
						{#if a.count}
							<a href={href(a.id)}
								><span class="az-name">{a.title}</span><span class="az-meta">{a.meta}</span><span
									class="az-n">{a.count}</span
								></a
							>
						{:else}
							<span class="az-empty" title="This spec publishes no endpoints in {index.release}"
								><span class="az-name">{a.title}</span><span class="az-meta">{a.meta}</span><span
									class="az-n">no endpoints</span
								></span
							>
						{/if}
					</li>
				{/each}
			</ul>
		</section>

		<section class="basics" aria-labelledby="basics-h">
			<h2 id="basics-h">Calling the API</h2>
			<dl>
				<div>
					<dt>Paths</dt>
					<dd>
						Resources <code>/apps/&lt;group&gt;/&lt;version&gt;/…</code>, workflows
						<code>/workflows/v1/…</code>, API server <code>/core/…</code>
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
	{:else}
		<!-- Category: every resource of its APIs in one table -->
		<header>
			<p class="crumb">
				<a href={categoryHref('')}>API</a> <span aria-hidden="true">›</span>
				<b>{current.title}</b>
			</p>
			<div class="cat-head">
				<span class="cat-icon">{@render icon(current.icon)}</span>
				<div>
					<h1>{current.title} <span class="rel">{index.release}</span></h1>
					<p class="lede">
						{current.blurb}
						{apisIn(current.id).length} APIs, {currentTotal} resources and workflows.
					</p>
				</div>
			</div>
		</header>

		<div class="bar">
			<div class="filter">
				<label for="api-cat-filter" class="sr-only">Filter {current.title}</label>
				{@render icon(SEARCH_ICON)}
				<input
					id="api-cat-filter"
					type="search"
					placeholder="Filter {currentTotal} in {current.title}"
					autocomplete="off"
					spellcheck="false"
					bind:value={filter}
				/>
			</div>
			<div class="seg" role="group" aria-label="Show">
				{#each ['all', 'resources', 'workflows'] as const as m (m)}
					<button type="button" aria-pressed={show === m} onclick={() => (show = m)}
						>{m[0]!.toUpperCase() + m.slice(1)}</button
					>
				{/each}
			</div>
		</div>

		{#if rows.length}
			<div class="tbl">
				<table>
					<thead>
						<tr>
							<th scope="col">Resource</th>
							<th scope="col">Scope</th>
							<th scope="col" class="num">Actions</th>
							<th scope="col">Path</th>
						</tr>
					</thead>
					{#each rows as r (r.api.id)}
						<tbody>
							<tr class="api-row">
								<th scope="colgroup" colspan="4">
									<a href={href(r.api.id)}>{r.api.title}</a>
									<span>{apiMeta(r.api)}</span>
								</th>
							</tr>
							{#each r.sections as s (s.key)}
								<tr class="res">
									<td class="k">
										<a href={href(r.api.id, s.key)}>{s.title}</a>{#if s.type === 'workflow'}<span
												class="wf">workflow</span
											>{/if}
									</td>
									<td class="sc">{scopeLabel(r.api, s)}</td>
									<td class="num">{s.actions}</td>
									<td class="p"
										>{#each pathParts(resourcePath(r.api, s)) as part}{#if part.param}<em
													>{part.text}</em
												>{:else}{part.text}{/if}{/each}</td
									>
								</tr>
							{/each}
						</tbody>
					{/each}
				</table>
			</div>
		{:else}
			<p class="empty">
				Nothing matches "{filter.trim()}" in {current.title}.
				<button
					type="button"
					onclick={() => {
						filter = '';
						show = 'all';
					}}>Clear the filter</button
				>
			</p>
		{/if}

		<nav class="pn" aria-label="Other categories">
			{#if currentIndex > 0}
				{@const prev = categories[currentIndex - 1]!}
				<a href={categoryHref(prev.id)}><small>← Previous</small><b>{prev.title}</b></a>
			{:else}
				<span></span>
			{/if}
			{#if currentIndex < categories.length - 1}
				{@const next = categories[currentIndex + 1]!}
				<a class="pn-next" href={categoryHref(next.id)}><small>Next →</small><b>{next.title}</b></a>
			{/if}
		</nav>
	{/if}
</div>

<style>
	.ov {
		min-width: 0;
		padding-bottom: 2.5rem;
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
		align-items: center;
		gap: 0.25rem 0.625rem;
		margin: 0.375rem 0 0.25rem;
		font: 700 clamp(1.6rem, 3vw, 2.1rem) / 1.15 var(--rb-font-display);
		letter-spacing: -0.02em;
		color: var(--rb-ink);
	}

	.rel {
		padding: 0.125rem 0.4375rem;
		border-radius: 0.3125rem;
		background: var(--rb-signal-soft);
		color: var(--rb-signal);
		font: 600 0.78rem var(--rb-font-mono);
		letter-spacing: 0;
	}

	.lede {
		margin: 0;
		max-width: 70ch;
		color: var(--rb-ink-2);
		font-size: 0.95rem;
		line-height: 1.5;
	}

	.i {
		width: 1.15rem;
		height: 1.15rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	section {
		margin-top: 2.25rem;
	}

	h2 {
		margin: 0 0 0.875rem;
		font: 700 1.05rem var(--rb-font-display);
		color: var(--rb-ink);
	}

	.h2row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.25rem 1rem;
	}

	.h2row span {
		margin-bottom: 0.875rem;
		font: 0.75rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	/* search */
	.search,
	.filter {
		position: relative;
	}

	.search {
		max-width: 44rem;
		margin-top: 1.25rem;
	}

	.search > .i,
	.filter > .i {
		position: absolute;
		left: 1rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--rb-ink-3);
		pointer-events: none;
	}

	.search input,
	.filter input {
		width: 100%;
		border: 1px solid var(--rb-line-strong);
		background: var(--rb-surface);
		color: var(--rb-ink);
	}

	.search input {
		height: 3.125rem;
		padding: 0 1rem 0 2.875rem;
		border-radius: 0.625rem;
		font: 500 1rem var(--rb-font);
		box-shadow: 0 10px 30px -20px rgba(10, 30, 80, 0.35);
	}

	.search input:focus,
	.filter input:focus {
		outline: 2px solid var(--rb-signal);
		outline-offset: 1px;
	}

	.hits {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(100% + 0.375rem);
		z-index: 20;
		max-height: 24rem;
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
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0 1rem;
		padding: 0.4375rem 0.625rem;
		border-radius: 0.375rem;
		color: var(--rb-ink);
		text-decoration: none;
	}

	.hits a:hover,
	.hits a.is-active {
		background: var(--rb-raised);
	}

	.hits b {
		font-weight: 600;
	}

	.hits span {
		font: 0.72rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	.hits em {
		grid-row: 1 / 3;
		grid-column: 2;
		align-self: center;
		font: normal 0.7rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	.hits-empty {
		padding: 0.625rem;
		font-size: 0.875rem;
		color: var(--rb-ink-3);
	}

	/* category tiles */
	.tiles,
	.pop,
	.az {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tiles {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.875rem;
	}

	@container (min-width: 36rem) {
		.tiles {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@container (min-width: 60rem) {
		.tiles {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	.tiles li {
		display: flex;
	}

	.tile {
		display: grid;
		grid-template-columns: 2.5rem minmax(0, 1fr);
		align-content: start;
		gap: 0.25rem 0.875rem;
		width: 100%;
		padding: 1.0625rem 1.125rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.75rem;
		background: var(--rb-surface);
		color: var(--rb-ink);
		text-decoration: none;
		transition:
			border-color 0.15s,
			box-shadow 0.15s,
			transform 0.15s;
	}

	.tile:hover {
		border-color: var(--rb-signal);
		box-shadow: 0 16px 34px -26px rgba(10, 30, 80, 0.55);
		transform: translateY(-1px);
	}

	.tile-icon {
		grid-row: 1 / 4;
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 0.5625rem;
		background: var(--rb-signal-soft);
		color: var(--rb-signal);
	}

	.tile-icon .i {
		width: 1.3rem;
		height: 1.3rem;
	}

	.tile b {
		font-size: 1rem;
		font-weight: 600;
	}

	.tile-blurb {
		font-size: 0.84rem;
		line-height: 1.45;
		color: var(--rb-ink-3);
	}

	.tile-stats {
		font: 500 0.72rem var(--rb-font-mono);
		color: var(--rb-ink-2);
	}

	.tile-ex {
		grid-column: 2;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3125rem;
		margin-top: 0.5rem;
	}

	.tile-ex span {
		padding: 0.0625rem 0.375rem;
		border-radius: 0.25rem;
		background: var(--rb-raised);
		color: var(--rb-ink-2);
		font: 0.72rem var(--rb-font-mono);
	}

	/* popular */
	.pop {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4375rem;
	}

	.pop a {
		display: inline-flex;
		align-items: center;
		gap: 0.4375rem;
		height: 2.125rem;
		padding: 0 0.75rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.5rem;
		background: var(--rb-surface);
		color: var(--rb-ink);
		font: 500 0.82rem var(--rb-font-mono);
		text-decoration: none;
	}

	.pop a:hover {
		border-color: var(--rb-signal);
		color: var(--rb-signal);
	}

	.pop small {
		font: 0.68rem var(--rb-font);
		color: var(--rb-ink-3);
	}

	/* A–Z */
	.az {
		columns: 1;
		column-gap: 1.5rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.75rem;
		background: var(--rb-surface);
	}

	@container (min-width: 40rem) {
		.az {
			columns: 2;
		}
	}

	@container (min-width: 64rem) {
		.az {
			columns: 3;
		}
	}

	.az li {
		break-inside: avoid;
	}

	.az a,
	.az-empty {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0 0.75rem;
		padding: 0.375rem 0.5rem;
		border-radius: 0.375rem;
		color: var(--rb-ink);
		text-decoration: none;
	}

	.az a:hover {
		background: var(--rb-raised);
	}

	.az a:hover .az-name {
		color: var(--rb-signal);
	}

	.az-name {
		font-weight: 600;
		font-size: 0.875rem;
	}

	.az-meta {
		grid-column: 1;
		font: 0.7rem var(--rb-font-mono);
		color: var(--rb-ink-3);
		overflow-wrap: anywhere;
	}

	.az-n {
		grid-column: 2;
		grid-row: 1 / 3;
		align-self: center;
		font: 0.72rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	.az-empty .az-name {
		color: var(--rb-ink-3);
		font-weight: 500;
	}

	/* calling the API */
	.basics {
		padding: 1rem 1.125rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.75rem;
		background: var(--rb-surface);
	}

	.basics h2 {
		margin-bottom: 0.625rem;
		font-size: 0.95rem;
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
		padding-top: 0.125rem;
		font: 600 0.66rem var(--rb-font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--rb-ink-3);
	}

	.basics dd {
		margin: 0;
		font-size: 0.85rem;
		color: var(--rb-ink-3);
		overflow-wrap: anywhere;
	}

	.basics code {
		font: 0.8rem var(--rb-font-mono);
		color: var(--rb-ink);
	}

	/* category page */
	.cat-head {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
	}

	.cat-icon {
		flex: none;
		display: grid;
		place-items: center;
		width: 3rem;
		height: 3rem;
		margin-top: 0.375rem;
		border-radius: 0.6875rem;
		background: var(--rb-signal-soft);
		color: var(--rb-signal);
	}

	.cat-icon .i {
		width: 1.5rem;
		height: 1.5rem;
	}

	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.625rem;
		margin-top: 1.25rem;
	}

	.filter {
		flex: 1 1 18rem;
	}

	.filter input {
		height: 2.625rem;
		padding: 0 1rem 0 2.75rem;
		border-radius: 0.5rem;
		font: 0.92rem var(--rb-font);
	}

	.seg {
		display: inline-flex;
		overflow: hidden;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.5rem;
		background: var(--rb-surface);
	}

	.seg button {
		height: 2.5rem;
		padding: 0 0.875rem;
		border: 0;
		background: none;
		color: var(--rb-ink-2);
		font: 600 0.82rem var(--rb-font);
		cursor: pointer;
	}

	.seg button + button {
		border-left: 1px solid var(--rb-line);
	}

	.seg button[aria-pressed='true'] {
		background: var(--rb-ink);
		color: var(--rb-bg);
	}

	.tbl {
		margin-top: 1rem;
		overflow: hidden;
		border: 1px solid var(--rb-line);
		border-radius: 0.75rem;
		background: var(--rb-surface);
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	thead th {
		padding: 0.625rem 1rem;
		border-bottom: 1px solid var(--rb-line);
		background: var(--rb-raised);
		color: var(--rb-ink-3);
		font: 600 0.66rem var(--rb-font-mono);
		letter-spacing: 0.08em;
		text-align: left;
		text-transform: uppercase;
	}

	td {
		padding: 0.5625rem 1rem;
		border-top: 1px solid var(--rb-line);
		vertical-align: baseline;
	}

	.api-row th {
		padding: 0.75rem 1rem 0.4375rem;
		border-top: 1px solid var(--rb-line);
		background: var(--rb-bg);
		text-align: left;
	}

	.api-row a {
		color: var(--rb-ink);
		font-weight: 700;
		text-decoration: none;
	}

	.api-row a:hover {
		color: var(--rb-signal);
		text-decoration: underline;
	}

	.api-row span {
		margin-left: 0.625rem;
		color: var(--rb-ink-3);
		font: 400 0.72rem var(--rb-font-mono);
	}

	.k a {
		color: var(--rb-ink);
		font: 600 0.86rem var(--rb-font-mono);
		text-decoration: none;
	}

	.k a:hover {
		color: var(--rb-signal);
		text-decoration: underline;
	}

	.wf {
		margin-left: 0.4375rem;
		padding: 0.0625rem 0.3125rem;
		border: 1px dashed var(--rb-line-strong);
		border-radius: 0.25rem;
		color: var(--rb-ink-3);
		font: 600 0.58rem var(--rb-font-mono);
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.sc {
		color: var(--rb-ink-2);
		font-size: 0.8rem;
		white-space: nowrap;
	}

	.num {
		text-align: right;
		color: var(--rb-ink-3);
		font: 0.8rem var(--rb-font-mono);
	}

	thead th.num {
		font: 600 0.66rem var(--rb-font-mono);
		text-align: right;
	}

	.p {
		color: var(--rb-ink-3);
		font: 0.76rem var(--rb-font-mono);
		overflow-wrap: anywhere;
	}

	.p em {
		font-style: normal;
		color: var(--rb-code);
	}

	@container (max-width: 47.99rem) {
		thead {
			display: none;
		}

		tr.res {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 0.125rem 0.75rem;
			padding: 0.5625rem 1rem;
			border-top: 1px solid var(--rb-line);
		}

		tr.res td {
			padding: 0;
			border: 0;
		}

		tr.res .sc {
			grid-column: 2;
			grid-row: 1;
		}

		tr.res .num {
			display: none;
		}

		tr.res .p {
			grid-column: 1 / -1;
		}

		.api-row,
		.api-row th {
			display: block;
		}
	}

	.empty {
		margin: 1rem 0 0;
		padding: 1.5rem 0;
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

	.pn {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 1.5rem;
	}

	.pn a {
		display: grid;
		min-width: 0;
		padding: 0.6875rem 1rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.625rem;
		background: var(--rb-surface);
		color: var(--rb-ink);
		text-decoration: none;
	}

	.pn a:hover {
		border-color: var(--rb-signal);
	}

	.pn small {
		color: var(--rb-ink-3);
		font: 0.7rem var(--rb-font-mono);
	}

	.pn b {
		font-weight: 600;
	}

	.pn-next {
		text-align: right;
	}

	.ov a:focus-visible,
	.ov button:focus-visible {
		outline: 2px solid var(--rb-signal);
		outline-offset: 2px;
	}

	@media (prefers-reduced-motion: reduce) {
		.tile {
			transition: none;
		}

		.tile:hover {
			transform: none;
		}
	}
</style>
