<script lang="ts">
	import {
		compareOpenApiManifestGroups,
		formatOpenApiManifestLabel,
		type OpenApiManifestEntry
	} from '$lib/openapi';

	interface Props {
		manifest: OpenApiManifestEntry[];
		selectedSpecId: string;
		darkMode?: boolean;
		loading?: boolean;
		disabled?: boolean;
		onSpecChange: (specId: string) => void;
	}

	let {
		manifest,
		selectedSpecId,
		darkMode = false,
		loading = false,
		disabled = false,
		onSpecChange
	}: Props = $props();

	let open = $state(false);
	let appFilter = $state('');
	let rootEl = $state<HTMLDivElement | null>(null);
	let searchEl = $state<HTMLInputElement | null>(null);

	type GroupedManifest = { group: string; entries: OpenApiManifestEntry[] };

	const groupedManifest = $derived.by((): GroupedManifest[] => {
		const q = appFilter.trim().toLowerCase();
		const byGroup = new Map<string, OpenApiManifestEntry[]>();
		for (const entry of manifest) {
			if (q) {
				const hay = `${entry.title} ${entry.group} ${entry.id} ${entry.apiVersion}`.toLowerCase();
				if (!hay.includes(q)) continue;
			}
			const list = byGroup.get(entry.group) ?? [];
			list.push(entry);
			byGroup.set(entry.group, list);
		}
		return Array.from(byGroup.entries())
			.sort(([a], [b]) => compareOpenApiManifestGroups(a, b))
			.map(([group, entries]) => ({
				group,
				entries: [...entries].sort((a, b) => a.title.localeCompare(b.title))
			}));
	});

	const selectedEntry = $derived(manifest.find((e) => e.id === selectedSpecId) ?? null);

	const buttonLabel = $derived.by(() => {
		if (loading) return 'Loading APIs…';
		if (selectedEntry) return formatOpenApiManifestLabel(selectedEntry);
		return 'Apps and Resources';
	});

	function toggleOpen() {
		if (disabled || loading) return;
		open = !open;
		if (open) {
			queueMicrotask(() => searchEl?.focus());
		}
	}

	function close() {
		open = false;
	}

	function selectEntry(id: string) {
		onSpecChange(id);
		appFilter = '';
		close();
	}

	function onWindowPointerDown(event: PointerEvent) {
		if (!open || !rootEl) return;
		const target = event.target;
		if (target instanceof Node && !rootEl.contains(target)) close();
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) {
			event.preventDefault();
			event.stopPropagation();
			close();
		}
	}
</script>

<svelte:window
	onpointerdown={open ? onWindowPointerDown : undefined}
	onkeydown={open ? onWindowKeydown : undefined}
/>

<div
	class="openapi-apps-dropdown"
	class:openapi-apps-dropdown--dark={darkMode}
	class:openapi-apps-dropdown--open={open}
	bind:this={rootEl}
>
	<button
		type="button"
		class="openapi-apps-dropdown__trigger"
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-label="Apps and Resources"
		disabled={disabled || loading || manifest.length === 0}
		onclick={toggleOpen}
	>
		<span class="openapi-apps-dropdown__trigger-label">{buttonLabel}</span>
		{#if selectedEntry}
			<span class="openapi-apps-dropdown__trigger-meta">{selectedEntry.pathCount} paths</span>
		{/if}
		<span class="openapi-apps-dropdown__chevron" aria-hidden="true">{open ? '▴' : '▾'}</span>
	</button>

	{#if open}
		<div class="openapi-apps-dropdown__panel" role="presentation">
			<label class="sr-only" for="openapi-apps-dropdown-filter">Filter apps</label>
			<input
				id="openapi-apps-dropdown-filter"
				class="openapi-apps-dropdown__search"
				type="search"
				placeholder="Filter apps…"
				bind:value={appFilter}
				bind:this={searchEl}
				autocomplete="off"
				spellcheck="false"
			/>

			{#if groupedManifest.length === 0}
				<p class="openapi-apps-dropdown__empty">
					{appFilter.trim() ? 'No apps match your filter.' : 'No APIs in this release.'}
				</p>
			{:else}
				<div class="openapi-apps-dropdown__list" role="listbox" aria-label="Apps and Resources">
					{#each groupedManifest as { group, entries } (group)}
						<section class="openapi-apps-dropdown__group">
							<h4 class="openapi-apps-dropdown__group-label">{group}</h4>
							{#each entries as entry (entry.id)}
								<button
									type="button"
									role="option"
									aria-selected={selectedSpecId === entry.id}
									class="openapi-apps-dropdown__item"
									class:openapi-apps-dropdown__item--selected={selectedSpecId === entry.id}
									onclick={() => selectEntry(entry.id)}
								>
									<span class="openapi-apps-dropdown__item-title"
										>{formatOpenApiManifestLabel(entry)}</span
									>
									<span class="openapi-apps-dropdown__item-meta">
										<span class="openapi-apps-dropdown__item-version">{entry.apiVersion}</span>
										<span>{entry.pathCount} paths</span>
									</span>
								</button>
							{/each}
						</section>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.openapi-apps-dropdown {
		position: relative;
		flex: 0 1 16rem;
		min-width: min(100%, 11rem);
		max-width: 18rem;
		font-family: var(--oa-font, 'NokiaPureText', ui-sans-serif, system-ui, sans-serif);
	}

	.openapi-apps-dropdown__trigger {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		width: 100%;
		min-height: 2.375rem;
		padding: 0.45rem 0.625rem;
		border: 1px solid var(--oa-panel-border, #cbd5e1);
		border-radius: var(--oa-radius, 0.5rem);
		background: var(--oa-panel, #ffffff);
		color: var(--oa-text, #0f172a);
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		font-size: 0.8125rem;
		font-weight: 650;
		box-shadow: 0 1px 0 color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 40%, transparent);
		transition:
			border-color 0.12s ease,
			box-shadow 0.12s ease;
	}

	.openapi-apps-dropdown__trigger:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 40%, var(--oa-panel-border));
	}

	.openapi-apps-dropdown__trigger:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.openapi-apps-dropdown--dark .openapi-apps-dropdown__trigger {
		border-color: var(--oa-panel-border, rgba(56, 100, 150, 0.35));
		background: var(--oa-panel, #1e293b);
		color: var(--oa-text, #e2e8f0);
	}

	.openapi-apps-dropdown--open .openapi-apps-dropdown__trigger {
		border-color: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 45%, var(--oa-panel-border));
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--oa-focus-ring, #2563eb) 16%, transparent);
	}

	.openapi-apps-dropdown__trigger-label {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.openapi-apps-dropdown__trigger-meta {
		flex-shrink: 0;
		border-radius: 9999px;
		background: color-mix(in srgb, var(--oa-chip-inactive, #e2e8f0) 90%, transparent);
		padding: 0.1rem 0.4rem;
		font-size: 0.625rem;
		font-weight: 700;
		color: var(--oa-text-muted, #475569);
	}

	.openapi-apps-dropdown--dark .openapi-apps-dropdown__trigger-meta {
		background: color-mix(in srgb, var(--oa-panel-border) 70%, transparent);
		color: var(--oa-text-muted, #cbd5e1);
	}

	.openapi-apps-dropdown__chevron {
		flex-shrink: 0;
		color: var(--oa-text-muted, #64748b);
		font-size: 0.75rem;
	}

	.openapi-apps-dropdown__panel {
		position: absolute;
		top: calc(100% + 0.35rem);
		left: 0;
		z-index: 40;
		display: flex;
		flex-direction: column;
		width: max(100%, 18rem);
		max-width: min(22rem, 92vw);
		max-height: min(24rem, 60vh);
		overflow: hidden;
		border: 1px solid var(--oa-panel-border, #e2e8f0);
		border-radius: var(--oa-radius-lg, 0.625rem);
		background: var(--oa-panel, #ffffff);
		box-shadow: var(--oa-panel-shadow, 0 12px 28px rgba(15, 23, 42, 0.16));
	}

	.openapi-apps-dropdown--dark .openapi-apps-dropdown__panel {
		border-color: var(--oa-panel-border, rgba(56, 100, 150, 0.45));
		background: color-mix(in srgb, var(--oa-panel, #0f172a) 96%, transparent);
		box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
	}

	.openapi-apps-dropdown__search {
		margin: 0.625rem 0.625rem 0.375rem;
		width: calc(100% - 1.25rem);
		border: 1px solid var(--oa-panel-border, #cbd5e1);
		border-radius: var(--oa-radius, 0.5rem);
		padding: 0.45rem 0.625rem;
		font-size: 0.8125rem;
		font-family: inherit;
		background: var(--oa-panel, #ffffff);
		color: var(--oa-text, #0f172a);
	}

	.openapi-apps-dropdown--dark .openapi-apps-dropdown__search {
		border-color: var(--oa-panel-border, rgba(56, 100, 150, 0.45));
		background: color-mix(in srgb, var(--oa-panel) 90%, transparent);
		color: var(--oa-text, #e2e8f0);
	}

	.openapi-apps-dropdown__list {
		flex: 1 1 auto;
		min-height: 0;
		overflow: auto;
		padding: 0.25rem 0.5rem 0.625rem;
	}

	.openapi-apps-dropdown__empty {
		padding: 1rem 0.875rem;
		font-size: 0.8125rem;
		color: var(--oa-text-muted, #64748b);
		text-align: center;
	}

	.openapi-apps-dropdown__group + .openapi-apps-dropdown__group {
		margin-top: 0.5rem;
	}

	.openapi-apps-dropdown__group-label {
		margin: 0 0 0.25rem 0.25rem;
		font-size: 0.6875rem;
		font-weight: 750;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--oa-text-muted, #64748b);
	}

	.openapi-apps-dropdown__item {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		width: 100%;
		margin-bottom: 0.2rem;
		padding: 0.5rem 0.55rem;
		border: 1px solid transparent;
		border-radius: var(--oa-radius, 0.5rem);
		background: transparent;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			box-shadow 0.12s ease;
	}

	.openapi-apps-dropdown__item:hover {
		background: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 7%, transparent);
		border-color: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 18%, transparent);
	}

	.openapi-apps-dropdown__item--selected {
		background: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 12%, transparent);
		border-color: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 35%, transparent);
		box-shadow: inset 3px 0 0 var(--oa-focus-ring, #2563eb);
	}

	.openapi-apps-dropdown__item-title {
		font-size: 0.8125rem;
		font-weight: 650;
		color: var(--oa-text, #0f172a);
	}

	.openapi-apps-dropdown__item-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		font-size: 0.6875rem;
		color: var(--oa-text-muted, #64748b);
	}

	.openapi-apps-dropdown__item-version {
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		border-radius: 9999px;
		padding: 0.05rem 0.4rem;
		background: color-mix(in srgb, var(--oa-chip-inactive, #e2e8f0) 90%, transparent);
		color: var(--oa-text, #334155);
	}

	.openapi-apps-dropdown--dark .openapi-apps-dropdown__item-version {
		background: color-mix(in srgb, var(--oa-panel-border) 70%, transparent);
		color: var(--oa-text-muted, #cbd5e1);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
