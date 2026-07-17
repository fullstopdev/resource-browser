<script lang="ts">
	import { copyToClipboard } from '$lib/copyToClipboard';
	import {
		isLargeExample,
		type OpenApiExample
	} from '$lib/openapi/openApiExamples';

	interface Props {
		examples: OpenApiExample[];
		darkMode?: boolean;
		/** Section heading when multiple or single anonymous example. */
		title?: string;
		/** Label for the copy button (e.g. Copy JSON / Copy YAML). */
		copyLabel?: string;
	}

	let {
		examples,
		darkMode = false,
		title = 'Example',
		copyLabel = 'Copy JSON'
	}: Props = $props();

	let expanded = $state<Record<string, boolean>>({});
	let copiedKey = $state<string | null>(null);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;

	const items = $derived(examples.filter((e) => e.formatted.length > 0 || e.formatted === 'null'));

	$effect(() => {
		examples;
		expanded = {};
		copiedKey = null;
		if (copyTimer) {
			clearTimeout(copyTimer);
			copyTimer = undefined;
		}
	});

	function exampleKey(example: OpenApiExample, index: number): string {
		return `${example.name || 'example'}:${index}`;
	}

	function isExpanded(example: OpenApiExample, index: number): boolean {
		const key = exampleKey(example, index);
		if (key in expanded) return expanded[key]!;
		return !isLargeExample(example);
	}

	function toggle(example: OpenApiExample, index: number) {
		const key = exampleKey(example, index);
		expanded = { ...expanded, [key]: !isExpanded(example, index) };
	}

	async function handleCopy(example: OpenApiExample, index: number) {
		const ok = await copyToClipboard(example.formatted);
		if (!ok) return;
		const key = exampleKey(example, index);
		copiedKey = key;
		if (copyTimer) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => {
			copiedKey = null;
			copyTimer = undefined;
		}, 1500);
	}

	function heading(example: OpenApiExample): string {
		if (example.summary) return example.summary;
		if (example.name) return example.name;
		return title;
	}
</script>

{#if items.length > 0}
	<div class="oa-example" class:oa-example--dark={darkMode}>
		{#each items as example, index (exampleKey(example, index))}
			{@const open = isExpanded(example, index)}
			{@const key = exampleKey(example, index)}
			{@const large = isLargeExample(example)}
			<section class="oa-example__block">
				<header class="oa-example__head">
					<button
						type="button"
						class="oa-example__toggle"
						aria-expanded={open}
						onclick={() => toggle(example, index)}
					>
						<span class="oa-example__chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
						<span class="oa-example__label">
							{#if open}
								{heading(example)}
							{:else}
								Show {heading(example).toLowerCase()}
							{/if}
						</span>
					</button>
					<button
						type="button"
						class="oa-example__copy"
						class:oa-example__copy--done={copiedKey === key}
						aria-label={copiedKey === key ? 'Example copied' : copyLabel}
						title={copiedKey === key ? 'Copied' : copyLabel}
						onclick={() => void handleCopy(example, index)}
					>
						{copiedKey === key ? 'Copied' : copyLabel}
					</button>
				</header>
				{#if example.description && open}
					<p class="oa-example__desc">{example.description}</p>
				{/if}
				{#if open}
					<pre class="oa-example__pre"><code>{example.formatted}</code></pre>
				{:else if large}
					<p class="oa-example__hint">
						Large example ({example.size.toLocaleString()} chars) — expand to view
					</p>
				{/if}
			</section>
		{/each}
	</div>
{/if}

<style>
	.oa-example {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.oa-example__block {
		border: 1px solid color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 90%, transparent);
		border-radius: var(--oa-radius, 0.5rem);
		background: color-mix(in srgb, var(--oa-canvas-bottom, #f1f5f9) 55%, var(--oa-panel, #fff));
		overflow: hidden;
	}

	.oa-example--dark .oa-example__block {
		background: color-mix(in srgb, var(--oa-canvas-top, rgba(15, 42, 72, 0.55)) 45%, transparent);
		border-color: var(--oa-panel-border, rgba(56, 100, 150, 0.35));
	}

	.oa-example__head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.55rem 0.4rem 0.65rem;
		min-height: 2rem;
	}

	.oa-example__toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		flex: 1 1 auto;
		min-width: 0;
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--oa-text-muted, #64748b);
		cursor: pointer;
		text-align: left;
	}

	.oa-example__toggle:hover {
		color: var(--oa-text, #0f172a);
	}

	.oa-example__chevron {
		flex-shrink: 0;
		font-size: 0.625rem;
		opacity: 0.8;
	}

	.oa-example__label {
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--oa-text-muted, #64748b);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.oa-example__copy {
		flex-shrink: 0;
		margin-left: auto;
		border: 1px solid var(--oa-panel-border, #e2e8f0);
		border-radius: var(--oa-radius-sm, 0.375rem);
		background: var(--oa-panel, #fff);
		padding: 0.2rem 0.5rem;
		font-family: inherit;
		font-size: 0.625rem;
		font-weight: 600;
		color: var(--oa-text-muted, #64748b);
		cursor: pointer;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			color 0.12s ease;
	}

	.oa-example--dark .oa-example__copy {
		background: color-mix(in srgb, var(--oa-panel) 80%, transparent);
		border-color: var(--oa-panel-border, rgba(56, 100, 150, 0.35));
	}

	.oa-example__copy:hover {
		border-color: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 40%, var(--oa-panel-border));
		color: var(--oa-text, #0f172a);
	}

	.oa-example__copy--done {
		border-color: color-mix(in srgb, #16a34a 45%, transparent);
		background: color-mix(in srgb, #16a34a 12%, transparent);
		color: #16a34a;
	}

	.oa-example--dark .oa-example__copy--done {
		color: #86efac;
	}

	.oa-example__desc {
		margin: 0;
		padding: 0 0.65rem 0.4rem;
		font-size: 0.75rem;
		color: var(--oa-text-muted, #64748b);
		line-height: 1.4;
	}

	.oa-example__hint {
		margin: 0;
		padding: 0 0.65rem 0.55rem;
		font-size: 0.6875rem;
		color: var(--oa-text-muted, #94a3b8);
	}

	.oa-example__pre {
		margin: 0;
		padding: 0.55rem 0.7rem 0.7rem;
		overflow-x: auto;
		max-height: 22rem;
		overflow-y: auto;
		border-top: 1px solid color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 75%, transparent);
		background: color-mix(in srgb, #0f172a 4%, var(--oa-panel, #fff));
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.6875rem;
		line-height: 1.45;
		color: var(--oa-text, #0f172a);
	}

	.oa-example--dark .oa-example__pre {
		background: color-mix(in srgb, #000 28%, transparent);
		border-top-color: var(--oa-panel-border, rgba(56, 100, 150, 0.35));
		color: color-mix(in srgb, var(--oa-text, #e2e8f0) 92%, #fff);
	}

	.oa-example__pre code {
		font-family: inherit;
		font-size: inherit;
		white-space: pre;
	}
</style>
