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

	<section class="howto" aria-labelledby="howto-h">
		<h2 id="howto-h" class="sr-only">How to call the API</h2>
		<div>
			<h3>Paths</h3>
			<p>
				Resources live under <code>/apps/&lt;group&gt;/&lt;version&gt;</code>, workflows under
				<code>/workflows/v1/&lt;group&gt;/&lt;version&gt;</code>, and the platform under
				<code>/core</code>.
			</p>
		</div>
		<div>
			<h3>Authentication</h3>
			<p>
				Send <code>Authorization: Bearer $TOKEN</code> with every request. Endpoints marked
				<b>Public</b> need no token.
			</p>
		</div>
		<div>
			<h3>Namespaces</h3>
			<p>
				Most resources are namespaced: <code>…/namespaces/eda/bridgedomains</code>. Lists without
				<code>/namespaces/…</code> cover all namespaces.
			</p>
		</div>
	</section>

	{#if platform}
		<section aria-labelledby="platform-h">
			<div class="sec-head">
				<h2 id="platform-h">Platform API</h2>
				<span>/core · {platform.operationCount} endpoints</span>
			</div>
			<ul class="links">
				{#each platform.sections as s (s.key)}
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
			<span>{apps.length} APIs</span>
		</div>
		<ul class="grid">
			{#each apps as api (api.id)}
				{@const names = api.sections.map((s) => s.title)}
				<li>
					<a class="card" href={href(api.id)}>
						<span class="card-title">{api.title}</span>
						<span class="card-meta">{api.group}/{api.version}</span>
						<span class="card-kinds"
							>{names.slice(0, 6).join(', ')}{names.length > 6
								? ` +${names.length - 6} more`
								: ''}</span
						>
					</a>
				</li>
			{/each}
		</ul>
	</section>
</div>

<style>
	.overview {
		display: grid;
		gap: 1.75rem;
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

	.howto {
		display: grid;
		gap: 0.75rem;
	}

	@media (min-width: 720px) {
		.howto {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	.howto div {
		padding: 0.875rem 1rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.625rem;
		background: var(--rb-surface);
	}

	.howto h3 {
		margin: 0 0 0.25rem;
		font-size: 0.875rem;
		color: var(--rb-ink);
	}

	.howto p {
		margin: 0;
		font-size: 0.84rem;
		line-height: 1.5;
		color: var(--rb-ink-3);
	}

	.howto code {
		font: 0.78rem var(--rb-font-mono);
		color: var(--rb-ink);
		overflow-wrap: anywhere;
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

	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.625rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	@media (min-width: 640px) {
		.grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (min-width: 1100px) {
		.grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	.grid li {
		display: flex;
	}

	.card {
		display: grid;
		align-content: start;
		gap: 0.25rem;
		width: 100%;
		padding: 0.8125rem 0.875rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.625rem;
		background: var(--rb-surface);
		color: inherit;
		text-decoration: none;
		transition: border-color 0.15s;
	}

	.card:hover {
		border-color: var(--rb-signal);
	}

	.card:focus-visible {
		outline: 2px solid var(--rb-signal);
		outline-offset: 1px;
	}

	.card-title {
		font-weight: 600;
		font-size: 0.92rem;
		color: var(--rb-ink);
	}

	.card-meta {
		font: 0.72rem var(--rb-font-mono);
		color: var(--rb-ink-3);
		overflow-wrap: anywhere;
	}

	.card-kinds {
		font-size: 0.8rem;
		line-height: 1.45;
		color: var(--rb-ink-2);
	}

	@media (prefers-reduced-motion: reduce) {
		.card {
			transition: none;
		}
	}
</style>
