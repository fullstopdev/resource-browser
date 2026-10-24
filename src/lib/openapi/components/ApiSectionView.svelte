<script lang="ts">
	import { tick } from 'svelte';
	import { copyToClipboard } from '$lib/copyToClipboard';
	import OpenApiMethodBadge from '$lib/openapi/components/OpenApiMethodBadge.svelte';
	import OpenApiOperationDetail from '$lib/openapi/components/OpenApiOperationDetail.svelte';
	import {
		curlForAction,
		type ApiAction,
		type ApiActionGroup,
		type ApiSection
	} from '$lib/openapi/apiReference';

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
	}

	let {
		section,
		apiTitle,
		spec,
		selected,
		onSelect,
		darkMode = false,
		crdHref,
		validateHref
	}: Props = $props();

	const GROUPS: ApiActionGroup[] = ['Read', 'Write', 'Run', 'Other'];
	const grouped = $derived(
		GROUPS.map((g) => ({ group: g, actions: section.actions.filter((a) => a.group === g) })).filter(
			(g) => g.actions.length > 0
		)
	);

	const curl = $derived(selected ? curlForAction(selected, section) : '');
	let copied = $state(false);
	let detailEl = $state<HTMLElement | null>(null);

	async function copyCurl() {
		if (!(await copyToClipboard(curl))) return;
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	async function choose(action: ApiAction) {
		onSelect(action);
		await tick();
		// Below the table on narrow screens: bring the panel into view.
		if (detailEl && window.matchMedia('(max-width: 1199px)').matches) {
			detailEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
		}
	}

	/** Arrow keys move between actions. */
	function tableKeydown(event: KeyboardEvent) {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		const rows = Array.from(
			(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.act')
		);
		const i = rows.indexOf(document.activeElement as HTMLElement);
		if (i < 0) return;
		event.preventDefault();
		rows[Math.max(0, Math.min(rows.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
	}

	function pathParts(path: string): Array<{ text: string; param: boolean }> {
		return path
			.split(/(\{[^}]+\})/)
			.filter(Boolean)
			.map((text) => ({ text, param: text.startsWith('{') }));
	}

	/** The path without the API prefix every row of this section shares. */
	function shortPath(path: string): string {
		const prefix = section.group ? path.indexOf(`/${section.group}/${section.version}`) : -1;
		if (prefix < 0) return path;
		return `…${path.slice(prefix + `/${section.group}/${section.version}`.length)}`;
	}

	const typeLabel = $derived(
		section.type === 'workflow'
			? 'Workflow'
			: section.type === 'platform'
				? 'Platform API'
				: section.type === 'discovery'
					? 'API discovery'
					: 'Resource'
	);
</script>

<div class="view">
	<header class="head">
		<p class="crumb">
			API <span aria-hidden="true">›</span>
			{apiTitle} <span aria-hidden="true">›</span>
			<b>{section.title}</b>
		</p>
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
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="actions" onkeydown={tableKeydown}>
			{#each grouped as g (g.group)}
				<h2 class="group">{g.group}</h2>
				<ul>
					{#each g.actions as action (action.key)}
						{@const current = selected?.key === action.key}
						<li>
							<button
								type="button"
								class="act"
								aria-current={current ? 'true' : undefined}
								aria-controls="api-action-panel"
								onclick={() => choose(action)}
							>
								<span class="act-label">{action.label}</span>
								<OpenApiMethodBadge method={action.operation.method} compact />
								<span class="act-path" title={action.operation.path}
									>{#each pathParts(shortPath(action.operation.path)) as part}{#if part.param}<em
												>{part.text}</em
											>{:else}{part.text}{/if}{/each}</span
								>
							</button>
						</li>
					{/each}
				</ul>
			{/each}
		</div>

		<section
			id="api-action-panel"
			class="panel"
			bind:this={detailEl}
			aria-label={selected ? selected.title : 'Action detail'}
		>
			{#if selected}
				<header class="panel-head">
					<h2>{selected.title}</h2>
					<p class="panel-path">
						<OpenApiMethodBadge method={selected.operation.method} />
						<code
							>{#each pathParts(selected.operation.path) as part}{#if part.param}<em>{part.text}</em
									>{:else}{part.text}{/if}{/each}</code
						>
					</p>
				</header>
				<div class="panel-body">
					<div class="term">
						<button type="button" class="copy" onclick={copyCurl}
							>{copied ? 'Copied' : 'Copy'}</button
						>
						<!-- Scrollable code must be reachable by keyboard (WCAG 2.1.1). -->
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<pre aria-label="Example request" tabindex="0"><code>{curl}</code></pre>
					</div>
					{#key selected.operation.id}
						<OpenApiOperationDetail operation={selected.operation} {spec} {darkMode} />
					{/key}
				</div>
			{:else}
				<p class="panel-empty">Pick an action to see the request, its parameters and responses.</p>
			{/if}
		</section>
	</div>
</div>

<style>
	.view {
		min-width: 0;
		padding-bottom: 2rem;
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

	.title-row {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.75rem 1.25rem;
		margin: 0.25rem 0 1.25rem;
	}

	.title-text {
		min-width: 0;
	}

	h1 {
		margin: 0 0 0.5rem;
		font: 700 clamp(1.45rem, 2.6vw, 1.85rem) / 1.15 var(--rb-font-display);
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

	.work {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.25rem;
		align-items: start;
	}

	@media (min-width: 1200px) {
		.work {
			grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
		}
	}

	.actions {
		overflow: hidden;
		border: 1px solid var(--rb-line);
		border-radius: 0.625rem;
		background: var(--rb-surface);
	}

	.group {
		margin: 0;
		padding: 0.625rem 0.875rem 0.375rem;
		border-bottom: 1px solid var(--rb-line);
		background: var(--rb-raised);
		font: 600 0.66rem var(--rb-font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--rb-ink-3);
	}

	.actions ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.act {
		display: grid;
		grid-template-columns: minmax(7.5rem, 11rem) auto minmax(0, 1fr);
		align-items: center;
		gap: 0.25rem 0.75rem;
		width: 100%;
		padding: 0.5625rem 0.875rem;
		border: 0;
		border-bottom: 1px solid var(--rb-line);
		background: none;
		color: inherit;
		text-align: left;
		font: inherit;
		cursor: pointer;
	}

	.actions ul:last-child li:last-child .act {
		border-bottom: 0;
	}

	.act:hover {
		background: var(--rb-raised);
	}

	.act:focus-visible {
		outline: 2px solid var(--rb-signal);
		outline-offset: -2px;
	}

	.act[aria-current='true'] {
		background: var(--rb-signal-soft);
		box-shadow: inset 2px 0 0 var(--rb-signal);
	}

	.act-label {
		font-weight: 600;
		font-size: 0.875rem;
		color: var(--rb-ink);
	}

	.act-path {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font: 0.76rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	.act-path em,
	.panel-path em {
		font-style: normal;
		color: var(--rb-code);
	}

	@media (max-width: 640px) {
		.act {
			grid-template-columns: auto minmax(0, 1fr);
		}
		.act-label {
			grid-column: 2;
			grid-row: 1;
		}
		.act :global(.openapi-method-badge) {
			grid-row: 1 / span 2;
		}
		.act-path {
			grid-column: 2;
		}
	}

	.panel {
		min-width: 0;
		overflow: hidden;
		border: 1px solid var(--rb-line);
		border-radius: 0.625rem;
		background: var(--rb-surface);
		scroll-margin-top: 4.5rem;
	}

	@media (min-width: 1200px) {
		.panel {
			position: sticky;
			top: 4.75rem;
			max-height: calc(100vh - 5.5rem);
			overflow: auto;
		}
	}

	.panel-head {
		display: grid;
		gap: 0.5rem;
		padding: 0.875rem 1rem 0.75rem;
		border-bottom: 1px solid var(--rb-line);
	}

	.panel-head h2 {
		margin: 0;
		font: 700 1.05rem var(--rb-font-display);
		color: var(--rb-ink);
	}

	.panel-path {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		margin: 0;
	}

	.panel-path code {
		font: 600 0.82rem/1.5 var(--rb-font-mono);
		color: var(--rb-ink);
		word-break: break-all;
	}

	.panel-body {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1rem;
		padding: 0.875rem 1rem 1.25rem;
	}

	.term {
		position: relative;
		min-width: 0;
		border-radius: 0.5rem;
		background: #0e1626;
	}

	.term pre {
		margin: 0;
		padding: 0.75rem 0.875rem;
		overflow-x: auto;
		color: #d7e2f4;
		font: 0.76rem/1.65 var(--rb-font-mono);
	}

	.copy {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		height: 1.75rem;
		padding: 0 0.5625rem;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 0.375rem;
		background: rgba(255, 255, 255, 0.08);
		color: #d7e2f4;
		font: 600 0.72rem var(--rb-font);
		cursor: pointer;
	}

	.copy:focus-visible {
		outline: 2px solid #8fb4ff;
		outline-offset: 1px;
	}

	.panel-empty {
		margin: 0;
		padding: 2rem 1rem;
		color: var(--rb-ink-3);
		font-size: 0.9rem;
	}
</style>
