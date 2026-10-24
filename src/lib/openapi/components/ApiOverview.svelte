<script lang="ts">
	import type { ApiIndex } from '$lib/openapi/apiReference';

	interface Props {
		index: ApiIndex;
		href: (apiId: string, sectionKey?: string) => string;
	}

	let { index, href }: Props = $props();

	const platform = $derived(index.apis.find((a) => a.platform) ?? null);
	const apps = $derived(index.apis.filter((a) => !a.platform));
	const totalOps = $derived(index.apis.reduce((n, a) => n + a.operationCount, 0));
	const resourceCount = $derived(
		apps.reduce((n, a) => n + a.sections.filter((s) => s.type === 'resource').length, 0)
	);
	const workflowCount = $derived(
		apps.reduce((n, a) => n + a.sections.filter((s) => s.type === 'workflow').length, 0)
	);

	// Filter the directory: an API whose name or group matches shows all its resources; otherwise
	// only the matching resources are listed.
	let filter = $state('');
	const q = $derived(filter.trim().toLowerCase());
	const shownApps = $derived(
		apps
			.map((api) => {
				if (!q || `${api.title} ${api.group}`.toLowerCase().includes(q)) return api;
				return { ...api, sections: api.sections.filter((s) => s.title.toLowerCase().includes(q)) };
			})
			.filter((api) => api.sections.length > 0)
	);
	const shownPlatform = $derived(
		platform
			? !q || 'platform core'.includes(q)
				? platform.sections
				: platform.sections.filter((s) => s.title.toLowerCase().includes(q))
			: []
	);
	const shownCount = $derived(shownApps.reduce((n, a) => n + a.sections.length, 0));

	/** `aaa.eda.nokia.com` → `aaa` */
	const shortGroup = (group: string) => group.replace(/\.eda\.nokia\.com$/, '');
</script>

<div class="overview">
	<header class="head">
		<p class="crumb">API <span aria-hidden="true">›</span> <b>Overview</b></p>
		<h1>EDA REST API · {index.release}</h1>
		<div class="chips">
			<span class="chip">{index.apis.length} APIs</span>
			<span class="chip">{resourceCount} resources</span>
			<span class="chip">{workflowCount} workflows</span>
			<span class="chip">{totalOps.toLocaleString('en')} endpoints</span>
		</div>
	</header>

	<dl class="basics">
		<div>
			<dt>Base path</dt>
			<dd>
				<code>/apps/&lt;group&gt;/&lt;version&gt;</code> · workflows <code>/workflows/v1/…</code> ·
				platform <code>/core</code>
			</dd>
		</div>
		<div>
			<dt>Auth</dt>
			<dd><code>Authorization: Bearer $TOKEN</code></dd>
		</div>
		<div>
			<dt>Namespaces</dt>
			<dd><code>…/namespaces/eda/bridgedomains</code>; without it, all namespaces</dd>
		</div>
	</dl>

	<div class="filter">
		<label for="api-dir-filter" class="sr-only">Filter APIs and resources</label>
		<svg viewBox="0 0 24 24" aria-hidden="true"
			><path d="M21 21l-5-5m2-5.5a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z" /></svg
		>
		<input
			id="api-dir-filter"
			type="search"
			placeholder="Filter {index.apis.length} APIs and {resourceCount + workflowCount} resources"
			autocomplete="off"
			spellcheck="false"
			bind:value={filter}
		/>
		{#if q}
			<span class="filter-count" aria-live="polite"
				>{shownApps.length} APIs · {shownCount + shownPlatform.length} matches</span
			>
		{/if}
	</div>

	{#if shownPlatform.length && platform}
		<section aria-labelledby="platform-h">
			<div class="sec-head">
				<h2 id="platform-h">Platform API</h2>
				<span>/core · {platform.operationCount} endpoints</span>
			</div>
			<ul class="links">
				{#each shownPlatform as s (s.key)}
					<li>
						<a href={href(platform.id, s.key)}>
							<span>{s.title}</span><span class="link-count">{s.actions}</span>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section aria-labelledby="apps-h">
		<div class="sec-head">
			<h2 id="apps-h">Application APIs</h2>
			<span>{apps.length} APIs · every resource and workflow</span>
		</div>
		{#if shownApps.length}
			<ul class="dir">
				{#each shownApps as api (api.id)}
					<li class="dir-row">
						<div class="dir-api">
							<a class="dir-title" href={href(api.id)}>{api.title}</a>
							<span class="dir-meta">{shortGroup(api.group)}/{api.version}</span>
						</div>
						<ul class="dir-kinds" aria-label="{api.title} resources">
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
		{:else}
			<p class="empty">
				Nothing matches "{filter.trim()}".
				<button type="button" onclick={() => (filter = '')}>Clear the filter</button>
			</p>
		{/if}
	</section>
</div>

<style>
	.overview {
		display: grid;
		gap: 1.5rem;
		padding-bottom: 2rem;
		min-width: 0;
	}

	.crumb {
		margin: 0;
		font: 500 0.75rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	.crumb b {
		font-weight: 500;
		color: var(--rb-ink-2);
	}

	h1 {
		margin: 0.25rem 0 0.5rem;
		font: 700 clamp(1.4rem, 2.6vw, 1.8rem) / 1.15 var(--rb-font-display);
		letter-spacing: -0.02em;
		color: var(--rb-ink);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.chip {
		padding: 0.1875rem 0.5rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.3125rem;
		background: var(--rb-raised);
		color: var(--rb-ink-2);
		font: 500 0.72rem var(--rb-font-mono);
	}

	.basics {
		display: grid;
		gap: 0.375rem 1.5rem;
		margin: 0;
		padding: 0.75rem 1rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.625rem;
		background: var(--rb-surface);
		font-size: 0.82rem;
	}

	.basics div {
		display: grid;
		grid-template-columns: 6.5rem minmax(0, 1fr);
		gap: 0.75rem;
		align-items: baseline;
	}

	.basics dt {
		font: 600 0.66rem var(--rb-font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--rb-ink-3);
	}

	.basics dd {
		margin: 0;
		color: var(--rb-ink-3);
		overflow-wrap: anywhere;
	}

	.basics code {
		font: 0.78rem var(--rb-font-mono);
		color: var(--rb-ink);
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
		padding: 0 10rem 0 2.375rem;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.5rem;
		background: var(--rb-surface);
		color: var(--rb-ink);
		font: 0.9rem var(--rb-font);
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

	.sec-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.625rem;
	}

	.sec-head h2 {
		margin: 0;
		font: 700 1.05rem var(--rb-font-display);
		color: var(--rb-ink);
	}

	.sec-head span {
		font: 0.75rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	/* Platform sections: a compact list, so the application APIs stay near the top. */
	.links {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.links a {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.5rem;
		background: var(--rb-surface);
		color: var(--rb-ink);
		font-weight: 600;
		font-size: 0.86rem;
		text-decoration: none;
	}

	.links a:hover {
		border-color: var(--rb-signal);
	}

	.links a:focus-visible {
		outline: 2px solid var(--rb-signal);
		outline-offset: 1px;
	}

	.link-count {
		font: 500 0.72rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	/* Directory: one row per API, every resource listed. */
	.dir {
		margin: 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--rb-line);
		border-radius: 0.625rem;
		background: var(--rb-surface);
		overflow: hidden;
	}

	.dir-row {
		display: grid;
		gap: 0.375rem 1.25rem;
		padding: 0.75rem 1rem;
	}

	.dir-row + .dir-row {
		border-top: 1px solid var(--rb-line);
	}

	@media (min-width: 760px) {
		.dir-row {
			grid-template-columns: 13rem minmax(0, 1fr);
		}
	}

	.dir-api {
		display: grid;
		align-content: start;
		gap: 0.0625rem;
		min-width: 0;
	}

	.dir-title {
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--rb-ink);
		text-decoration: none;
	}

	.dir-title:hover {
		color: var(--rb-signal);
	}

	.dir-meta {
		font: 0.72rem var(--rb-font-mono);
		color: var(--rb-ink-3);
		overflow-wrap: anywhere;
	}

	.dir-kinds {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.dir-kinds a {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.1875rem 0.5rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.3125rem;
		background: var(--rb-bg);
		color: var(--rb-ink-2);
		font: 500 0.78rem var(--rb-font-mono);
		text-decoration: none;
	}

	.dir-kinds a:hover {
		border-color: var(--rb-signal);
		color: var(--rb-signal);
	}

	.dir-kinds a.is-workflow {
		border-style: dashed;
	}

	.wf {
		font: 600 0.58rem var(--rb-font-mono);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--rb-ink-3);
	}

	.dir a:focus-visible,
	.empty button:focus-visible {
		outline: 2px solid var(--rb-signal);
		outline-offset: 1px;
	}

	.empty {
		margin: 0;
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
</style>
