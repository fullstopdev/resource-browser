<script lang="ts">
	import { tick } from 'svelte';
	import OpenApiMethodBadge from '$lib/openapi/components/OpenApiMethodBadge.svelte';
	import ApiActionDetail from '$lib/openapi/components/ApiActionDetail.svelte';
	import type { ApiAction, ApiActionGroup, ApiSection } from '$lib/openapi/apiReference';

	interface Props {
		section: ApiSection;
		apiTitle: string;
		spec: Record<string, unknown>;
		selected: ApiAction | null;
		onSelect: (action: ApiAction) => void;
		darkMode?: boolean;
		/** CRD catalog page for this resource, when the CRD exists in the release. */
		crdHref?: string;
		validateHref?: string;
		/** Links for the breadcrumb: overview, the API's category and the API itself. */
		crumbs?: { overview: string; category: string; categoryHref: string; apiHref: string };
	}

	let {
		section,
		apiTitle,
		spec,
		selected,
		onSelect,
		darkMode = false,
		crdHref,
		validateHref,
		crumbs
	}: Props = $props();

	const GROUPS: ApiActionGroup[] = ['Read', 'Write', 'Run', 'Other'];
	const grouped = $derived(
		GROUPS.map((g) => ({ group: g, actions: section.actions.filter((a) => a.group === g) })).filter(
			(g) => g.actions.length > 0
		)
	);

	let detailEl = $state<HTMLElement | null>(null);

	async function choose(action: ApiAction) {
		onSelect(action);
		await tick();
		// When the detail sits below the list, bring it into view.
		if (detailEl && detailEl.getBoundingClientRect().top > window.innerHeight * 0.6) {
			detailEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
		}
	}

	/** Arrow keys move between actions. */
	function listKeydown(event: KeyboardEvent) {
		const next = event.key === 'ArrowDown' || event.key === 'ArrowRight';
		if (!next && event.key !== 'ArrowUp' && event.key !== 'ArrowLeft') return;
		const rows = Array.from(
			(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.act')
		);
		const i = rows.indexOf(document.activeElement as HTMLElement);
		if (i < 0) return;
		event.preventDefault();
		rows[Math.max(0, Math.min(rows.length - 1, i + (next ? 1 : -1)))]?.focus();
	}

	/** Only the part of the path that tells actions apart: `bridgedomains/{name}/_revs`. */
	function shortPath(path: string): string {
		if (section.plural) {
			const i = path.lastIndexOf(`/${section.plural}`);
			if (i >= 0) return path.slice(i + 1);
		}
		return path.replace(/^\/core/, '');
	}

	const typeLabel = $derived(
		section.type === 'workflow'
			? 'Workflow'
			: section.type === 'platform'
				? 'API Server'
				: section.type === 'discovery'
					? 'API discovery'
					: 'Resource'
	);
</script>

<div class="view">
	<header class="head">
		<nav class="crumb" aria-label="Breadcrumb">
			{#if crumbs}<a href={crumbs.overview}>API</a>{:else}API{/if}
			<span aria-hidden="true">›</span>
			{#if crumbs}<a href={crumbs.categoryHref}>{crumbs.category}</a>
				<span aria-hidden="true">›</span>
				<a href={crumbs.apiHref}>{apiTitle}</a>{:else}{apiTitle}{/if}
			<span aria-hidden="true">›</span>
			<b>{section.title}</b>
		</nav>
		<div class="title-row">
			<div class="title-text">
				<h1>{section.title}</h1>
				<div class="chips">
					<span class="chip">{typeLabel}</span>
					{#if section.group}<span class="chip">{section.group}/{section.version}</span>{/if}
					{#if section.scope}<span class="chip">{section.scope}</span>{/if}
					<span class="chip"
						>{section.actions.length} {section.actions.length === 1 ? 'action' : 'actions'}</span
					>
				</div>
			</div>
			{#if crdHref || validateHref}
				<div class="links">
					{#if crdHref}<a class="btn" href={crdHref}>CRD schema</a>{/if}
					{#if validateHref}<a class="btn" href={validateHref}>Validate a manifest</a>{/if}
				</div>
			{/if}
		</div>
	</header>

	<div class="work">
		<!-- Arrow keys move between the action buttons inside. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<nav class="actions" aria-label="{section.title} actions" onkeydown={listKeydown}>
			{#each grouped as g (g.group)}
				<div class="group-row">
					<h2 class="group">{g.group}</h2>
					<ul>
						{#each g.actions as action (action.key)}
							{@const current = selected?.key === action.key}
							<li>
								<button
									type="button"
									class="act"
									title="{action.operation.method.toUpperCase()} {shortPath(action.operation.path)}"
									aria-current={current ? 'true' : undefined}
									aria-controls="api-action-panel"
									onclick={() => choose(action)}
								>
									<OpenApiMethodBadge method={action.operation.method} compact />
									<span class="act-label">{action.label}</span>
								</button>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</nav>

		<section id="api-action-panel" class="panel" bind:this={detailEl} aria-live="polite">
			{#if selected}
				{#key selected.key}
					<ApiActionDetail action={selected} {section} {spec} {darkMode} {crdHref} />
				{/key}
			{:else}
				<p class="panel-empty">Pick an action to see the request, its parameters and responses.</p>
			{/if}
		</section>
	</div>
</div>

<style>
	.view {
		container-type: inline-size;
		min-width: 0;
		padding-bottom: 2rem;
	}

	.crumb {
		margin: 0;
		font: 500 0.75rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	.crumb a {
		color: var(--rb-ink-3);
	}

	.crumb a:hover {
		color: var(--rb-signal);
	}

	.crumb b {
		font-weight: 500;
		color: var(--rb-ink-2);
	}

	.title-row {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.75rem 1.25rem;
		margin: 0.25rem 0 1.5rem;
	}

	.title-text {
		min-width: 0;
	}

	h1 {
		margin: 0 0 0.5rem;
		font: 700 clamp(1.5rem, 2.6vw, 1.9rem) / 1.15 var(--rb-font-display);
		letter-spacing: -0.02em;
		color: var(--rb-ink);
		overflow-wrap: anywhere;
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

	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		height: 2.25rem;
		padding: 0 0.8125rem;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.5rem;
		background: var(--rb-surface);
		color: var(--rb-ink);
		font: 600 0.84rem var(--rb-font);
		text-decoration: none;
	}

	.btn:hover {
		border-color: var(--rb-signal);
		color: var(--rb-signal);
	}

	.btn:focus-visible {
		outline: 2px solid var(--rb-signal);
		outline-offset: 1px;
	}

	/* Actions as a bar of buttons above the detail, grouped Read / Write / Run. */
	.work {
		display: grid;
		gap: 1.25rem;
	}

	.actions {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
		padding: 0.75rem 0.875rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.75rem;
		background: var(--rb-surface);
	}

	.group-row {
		display: grid;
		gap: 0.375rem;
		align-items: start;
	}

	@container (min-width: 40rem) {
		.group-row {
			grid-template-columns: 3.5rem minmax(0, 1fr);
			gap: 0.75rem;
		}

		.group-row + .group-row {
			padding-top: 0.5rem;
			border-top: 1px solid var(--rb-line);
		}
	}

	.group {
		margin: 0;
		padding-top: 0.4375rem;
		font: 600 0.66rem var(--rb-font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--rb-ink-3);
	}

	.actions ul {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.act {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		height: 2.125rem;
		padding: 0 0.75rem 0 0.375rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.5rem;
		background: var(--rb-bg);
		color: var(--rb-ink);
		font: inherit;
		cursor: pointer;
	}

	.act:hover {
		border-color: var(--rb-line-strong);
		background: var(--rb-raised);
	}

	.act:focus-visible {
		outline: 2px solid var(--rb-signal);
		outline-offset: 1px;
	}

	.act[aria-current='true'] {
		border-color: var(--rb-signal);
		background: var(--rb-signal-soft);
		box-shadow: inset 0 0 0 1px var(--rb-signal);
	}

	.act-label {
		font-weight: 600;
		font-size: 0.84rem;
		white-space: nowrap;
	}

	.act[aria-current='true'] .act-label {
		color: var(--rb-signal);
	}

	.panel {
		min-width: 0;
		scroll-margin-top: 4.5rem;
	}

	.panel-empty {
		margin: 0;
		padding: 2rem 0;
		color: var(--rb-ink-3);
		font-size: 0.9rem;
	}
</style>
