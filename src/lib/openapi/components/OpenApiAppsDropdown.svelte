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
		width: 100%;
		font-family: var(--rb-font);
	}

	.openapi-apps-dropdown__trigger {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0 0.5rem;
		width: 100%;
		min-height: 2.75rem;
		padding: 0.375rem 0.625rem;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.5rem;
		background: var(--rb-surface);
		color: var(--rb-ink);
		text-align: left;
		cursor: pointer;
	}

	.openapi-apps-dropdown__trigger:disabled {
		cursor: default;
		opacity: 0.7;
	}

	.openapi-apps-dropdown__trigger:focus-visible {
		outline: 2px solid var(--rb-signal);
		outline-offset: 1px;
	}

	.openapi-apps-dropdown__trigger-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.openapi-apps-dropdown__trigger-meta {
		grid-column: 1;
		font: 0.7rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	.openapi-apps-dropdown__chevron {
		grid-column: 2;
		grid-row: 1 / span 2;
		color: var(--rb-ink-3);
		font-size: 0.75rem;
	}

	.openapi-apps-dropdown__panel {
		position: absolute;
		top: calc(100% + 0.375rem);
		left: 0;
		z-index: 60;
		width: max(100%, 22rem);
		max-width: calc(100vw - 2rem);
		padding: 0.375rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.625rem;
		background: var(--rb-surface);
		box-shadow: var(--rb-shadow-pop);
	}

	.openapi-apps-dropdown__search {
		width: 100%;
		height: 2.25rem;
		margin-bottom: 0.375rem;
		padding: 0 0.625rem;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.4375rem;
		background: var(--rb-surface);
		color: var(--rb-ink);
		font: 0.85rem var(--rb-font);
	}

	.openapi-apps-dropdown__search:focus {
		outline: 2px solid var(--rb-signal);
		outline-offset: 1px;
	}

	.openapi-apps-dropdown__empty {
		margin: 0;
		padding: 0.5rem;
		font-size: 0.85rem;
		color: var(--rb-ink-3);
	}

	.openapi-apps-dropdown__list {
		max-height: min(24rem, 60vh);
		overflow: auto;
	}

	.openapi-apps-dropdown__group-label {
		margin: 0.5rem 0.375rem 0.125rem;
		font: 600 0.64rem var(--rb-font-mono);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--rb-ink-3);
	}

	.openapi-apps-dropdown__item {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		width: 100%;
		padding: 0.375rem 0.5rem;
		border: 0;
		border-radius: 0.375rem;
		background: none;
		color: var(--rb-ink);
		text-align: left;
		font-size: 0.84rem;
		cursor: pointer;
	}

	.openapi-apps-dropdown__item:hover,
	.openapi-apps-dropdown__item:focus-visible {
		background: var(--rb-raised);
		outline: none;
	}

	.openapi-apps-dropdown__item--selected {
		background: var(--rb-signal-soft);
		color: var(--rb-signal);
		font-weight: 600;
	}

	.openapi-apps-dropdown__item-meta {
		display: inline-flex;
		gap: 0.5rem;
		flex-shrink: 0;
		font: 0.72rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}
</style>
