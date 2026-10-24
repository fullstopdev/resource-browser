<script lang="ts">
	import AppHeader from '$lib/components/AppHeader.svelte';
	import ResourceModal from '$lib/components/ResourceModal.svelte';
	import type { ResourceViewMode } from '$lib/resourceView';
	import { displayGroup, displayKind } from '$lib/resourceSearch';
	import type { CrdResource, EdaRelease } from '$lib/structure';
	import { crdParamForResource } from '$lib/urlState';
	import { getLatestVersion } from '$lib/versions';
	import { onMount } from 'svelte';

	export let allResources: CrdResource[] = [];
	export let selectedRelease: EdaRelease;
	export let allReleases: EdaRelease[] = [];
	export let onExitBrowse: () => void = () => {};
	/** Open ResourceModal for this CRD when catalog loads (from URL ?crd=). */
	export let initialCrd: string | null = null;
	/** API version for the initial modal open (from URL ?version=). */
	export let initialVersion: string | null = null;
	export let onResourceModalClose: (() => void) | undefined = undefined;
	export let onResourceModalOpen: ((crd: string, version?: string) => void) | undefined = undefined;
	export let onResourceVersionChange: ((version: string) => void) | undefined = undefined;

	let searchQuery = '';
	let typeFilter: 'all' | 'config' | 'state' = 'all';
	/** Sidebar selection: one API group, or '' for all. The search ignores it. */
	let selGroup = '';

	let modalOpen = false;
	let modalResource: CrdResource | null = null;
	let modalInitialViewMode: ResourceViewMode = 'schema';
	let openedInitialResource: string | null = null;
	/** Field path(s) to auto-expand/highlight in the modal, parsed from a `#field.path` deep link. */
	let modalHighlightPaths: string[] = [];

	/** Parse a `#spec.foo.bar` (or `#spec.foo|spec.baz`) URL fragment into highlight paths. */
	function parseHighlightHash(): string[] {
		if (typeof window === 'undefined') return [];
		const raw = window.location.hash.replace(/^#/, '').trim();
		if (!raw) return [];
		return raw
			.split('|')
			.map((p) => decodeURIComponent(p.trim()))
			.filter(Boolean);
	}

	// Keep modal resource in sync when release/manifest reloads
	$: if (modalOpen && modalResource) {
		const updated = allResources.find((r) => r.name === modalResource?.name);
		if (updated && updated !== modalResource) {
			modalResource = updated;
		}
	}

	/** `protocols.eda.nokia.com` → `protocols` */
	const shortGroup = (group: string) => group.replace(/\.eda\.nokia\.com$/, '');

	type Group = { group: string; short: string; title: string; resources: CrdResource[] };

	/** API titles from the release's OpenAPI index (`Routing Policies`), when it has one. */
	let groupTitles: Record<string, string> = {};
	let titlesFor = '';
	$: if (selectedRelease?.name && selectedRelease.name !== titlesFor) {
		titlesFor = selectedRelease.name;
		void loadTitles(selectedRelease.name);
	}
	async function loadTitles(release: string) {
		try {
			const resp = await fetch(`/openapi/${release}/api-index.json`);
			if (!resp.ok) return;
			const index = (await resp.json()) as { apis: Array<{ group: string; title: string }> };
			if (release !== titlesFor) return;
			groupTitles = Object.fromEntries(index.apis.map((a) => [a.group, a.title]));
		} catch {
			// Fall back to the group's first label.
		}
	}

	function groupTitle(group: string, titles: Record<string, string>): string {
		if (!group) return 'No API group';
		if (titles[group]) return titles[group]!;
		const first = group.split('.')[0] ?? group;
		return first.charAt(0).toUpperCase() + first.slice(1);
	}

	function isState(res: CrdResource) {
		return res.name.toLowerCase().includes('states');
	}

	/**
	 * Every CRD by API group, built from this release's CRD list, so the groups follow the release.
	 * Groups A–Z by short name (`aaa`, `core`, `services`); CRDs A–Z. An entry with no group (and
	 * CRDs listed without versions) still shows.
	 */
	$: groups = (() => {
		const byGroup = new Map<string, CrdResource[]>();
		for (const res of allResources) {
			const g = displayGroup(res);
			byGroup.set(g, [...(byGroup.get(g) ?? []), res]);
		}
		return [...byGroup]
			.map(([group, resources]) => ({
				group,
				short: group ? shortGroup(group) : 'other',
				title: groupTitle(group, groupTitles),
				resources: resources.sort((a, b) => displayKind(a).localeCompare(displayKind(b)))
			}))
			.sort((a, b) => (a.group ? 0 : 1) - (b.group ? 0 : 1) || a.short.localeCompare(b.short));
	})() as Group[];

	$: query = searchQuery.trim().toLowerCase();
	$: searching = query.length > 0;

	function matches(res: CrdResource, group: Group): boolean {
		if (typeFilter === 'state' && !isState(res)) return false;
		if (typeFilter === 'config' && isState(res)) return false;
		if (!searching) return true;
		const haystack = `${res.name} ${displayKind(res)} ${group.group} ${group.title}`.toLowerCase();
		return query.split(/\s+/).every((t) => haystack.includes(t));
	}

	// The search always covers every CRD; the group selection only applies when not searching.
	$: shownGroups = groups
		.filter((g) => searching || !selGroup || g.group === selGroup)
		.map((g) => ({ ...g, resources: g.resources.filter((r) => matches(r, g)) }))
		.filter((g) => g.resources.length > 0);
	$: shownCount = shownGroups.reduce((n, g) => n + g.resources.length, 0);
	$: current = groups.find((g) => g.group === selGroup) ?? null;

	function pick(group: string) {
		selGroup = group;
		searchQuery = '';
		document.getElementById('main-scroll')?.scrollTo({ top: 0 });
	}

	function resetFilters() {
		searchQuery = '';
		typeFilter = 'all';
	}

	/** `/` focuses the catalog search unless you're typing somewhere. */
	onMount(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== '/' || event.defaultPrevented || modalOpen) return;
			const t = event.target as HTMLElement | null;
			if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
			event.preventDefault();
			document.getElementById('crd-catalog-search')?.focus();
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	});

	const SEARCH_ICON = 'M21 21l-5-5m2-5.5a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z';

	function isAllDeprecated(res: CrdResource) {
		return res.versions.length > 0 && res.versions.every((v) => v.deprecated);
	}

	function openResourceModal(
		res: CrdResource,
		event?: Event,
		viewMode: ResourceViewMode = 'schema'
	) {
		event?.preventDefault();
		event?.stopPropagation();
		modalResource = res;
		modalInitialViewMode = viewMode;
		modalHighlightPaths = [];
		modalOpen = true;
		onResourceModalOpen?.(crdParamForResource(res));
	}

	function closeResourceModal() {
		modalOpen = false;
		modalResource = null;
		modalInitialViewMode = 'schema';
		modalHighlightPaths = [];
		onResourceModalClose?.();
	}

	$: if (initialCrd && initialCrd !== openedInitialResource && allResources.length > 0) {
		const res =
			allResources.find((r) => r.name === initialCrd) ||
			allResources.find((r) => displayKind(r).toLowerCase() === initialCrd.toLowerCase()) ||
			allResources.find((r) => r.name.split('.')[0].toLowerCase() === initialCrd.toLowerCase());
		openedInitialResource = initialCrd;
		if (res) {
			modalResource = res;
			modalHighlightPaths = parseHighlightHash();
			modalOpen = true;
		}
	}

	$: if (!initialCrd) {
		openedInitialResource = null;
	}
</script>

<div class="page-shell cat-page min-h-full">
	<!-- The header's release switcher changes the catalog's release. -->
	<AppHeader
		onLogoClick={(e) => {
			e.preventDefault();
			onExitBrowse();
		}}
	/>

	<div class="cat-shell">
		<aside class="cat-side" aria-label="API groups">
			<button
				type="button"
				class="row all"
				aria-current={!selGroup ? 'true' : undefined}
				on:click={() => pick('')}
			>
				<svg class="i" viewBox="0 0 24 24" aria-hidden="true"
					><path d="M4 5h7v6H4zM13 5h7v14h-7zM4 13h7v6H4z" /></svg
				>
				<span>All CRDs</span><small>{allResources.length}</small>
			</button>
			<p class="heading">API groups <span>{groups.length}</span></p>
			<ul>
				{#each groups as g (g.group)}
					<li>
						<button
							type="button"
							class="row grp"
							aria-current={selGroup === g.group ? 'true' : undefined}
							title={g.group || 'No API group'}
							on:click={() => pick(g.group)}
						>
							<span class="grp-name">{g.short}</span><small>{g.resources.length}</small>
						</button>
					</li>
				{/each}
			</ul>
		</aside>

		<main class="cat-main">
			<p class="crumb">
				CRDs <span aria-hidden="true">›</span>
				{#if current}<button type="button" class="crumb-link" on:click={() => pick('')}
						>Catalog</button
					>
					<span aria-hidden="true">›</span> <b>{current.short}</b>{:else}<b>Catalog</b>{/if}
			</p>
			<h1>
				{current ? current.title : 'CRD catalog'}
				<span class="rel">{selectedRelease?.name}</span>
			</h1>
			<p class="lede">
				{#if current}
					<code>{current.group || 'No API group'}</code> · {current.resources.length}
					{current.resources.length === 1 ? 'CRD' : 'CRDs'}
				{:else}
					{allResources.length} CRDs in {groups.length} API groups. Pick a group, or search them all.
				{/if}
			</p>

			<label class="sr-only" for="crd-group-select">API group</label>
			<select
				id="crd-group-select"
				class="group-select"
				value={selGroup}
				on:change={(e) => pick(e.currentTarget.value)}
			>
				<option value="">All API groups ({allResources.length})</option>
				{#each groups as g (g.group)}
					<option value={g.group}>{g.short} ({g.resources.length})</option>
				{/each}
			</select>

			<div class="bar">
				<div class="search">
					<label for="crd-catalog-search" class="sr-only">Search all CRDs</label>
					<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d={SEARCH_ICON} /></svg>
					<input
						id="crd-catalog-search"
						type="search"
						bind:value={searchQuery}
						placeholder="Search all {allResources.length} CRDs by kind or group"
						autocomplete="off"
						spellcheck="false"
					/>
					<kbd aria-hidden="true">/</kbd>
				</div>
				<div class="seg" role="group" aria-label="Resource type">
					{#each [{ id: 'all', label: 'All' }, { id: 'config', label: 'Config' }, { id: 'state', label: 'State' }] as chip (chip.id)}
						<button
							type="button"
							aria-pressed={typeFilter === chip.id}
							on:click={() => (typeFilter = chip.id as typeof typeFilter)}>{chip.label}</button
						>
					{/each}
				</div>
			</div>
			<p class="status" aria-live="polite">
				{#if searching}
					{shownCount}
					{shownCount === 1 ? 'match' : 'matches'} in {shownGroups.length}
					{shownGroups.length === 1 ? 'group' : 'groups'}{#if selGroup}&nbsp;· searching all API
						groups, not only {current?.short}{/if}
				{:else}
					{shownCount} {shownCount === 1 ? 'CRD' : 'CRDs'}
				{/if}
			</p>

			{#if shownGroups.length === 0}
				<div class="empty">
					<p>No CRD matches your search or filter.</p>
					<button type="button" on:click={resetFilters}>Clear filters</button>
				</div>
			{:else}
				<div class="tbl">
					<table>
						<thead>
							<tr>
								<th scope="col">Kind</th>
								<th scope="col">Scope</th>
								<th scope="col">Versions</th>
								<th scope="col">Name</th>
							</tr>
						</thead>
						{#each shownGroups as g (g.group)}
							<tbody>
								<tr class="grp-row">
									<th scope="colgroup" colspan="4">
										{#if !selGroup || searching}
											<button type="button" on:click={() => pick(g.group)}>{g.title}</button>
										{:else}
											<b>{g.title}</b>
										{/if}
										<span>{g.group || 'No API group'}</span>
										<small>{g.resources.length}</small>
									</th>
								</tr>
								{#each g.resources as res (res.name)}
									{@const latest = getLatestVersion(res)}
									<tr class="res">
										<td class="k">
											<button type="button" on:click={(e) => openResourceModal(res, e)}
												>{displayKind(res)}</button
											>{#if isAllDeprecated(res)}<span class="tag tag--dep">Deprecated</span
												>{/if}{#if isState(res)}<span class="tag">State</span>{/if}
										</td>
										<td class="sc">{res.scope ?? '—'}</td>
										<td class="v">
											{#if latest}
												<span class="ver">{latest}</span>
												{#each res.versions.filter((v) => v.name !== latest) as v (v.name)}
													<span class="ver ver--old" class:is-dep={v.deprecated}>{v.name}</span>
												{/each}
											{:else}
												<span class="none">no versions</span>
											{/if}
										</td>
										<td class="n">{res.name}</td>
									</tr>
								{/each}
							</tbody>
						{/each}
					</table>
				</div>
			{/if}
		</main>
	</div>
</div>

<ResourceModal
	open={modalOpen}
	resourceDef={modalResource}
	{selectedRelease}
	{allReleases}
	{initialVersion}
	initialViewMode={modalInitialViewMode}
	highlightPaths={modalHighlightPaths}
	onActiveVersionChange={onResourceVersionChange}
	onClose={closeResourceModal}
/>

<style>
	.cat-page {
		background: var(--rb-bg);
		color: var(--rb-ink);
		font-family: var(--rb-font);
	}

	.cat-shell {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		max-width: 90rem;
		margin: 0 auto;
		padding: 0 max(1rem, env(safe-area-inset-right, 0px)) 3rem
			max(1rem, env(safe-area-inset-left, 0px));
	}

	@media (min-width: 1024px) {
		.cat-shell {
			grid-template-columns: 15rem minmax(0, 1fr);
			gap: 2.5rem;
			padding-left: 2rem;
			padding-right: 2rem;
		}
	}

	.i {
		flex: none;
		width: 1.125rem;
		height: 1.125rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* sidebar: API groups from the release's CRDs */
	.cat-side {
		display: none;
	}

	@media (min-width: 1024px) {
		.cat-side {
			position: sticky;
			top: 0;
			display: block;
			align-self: start;
			max-height: 100vh;
			overflow-y: auto;
			padding: 1.5rem 0.25rem 2rem 0;
		}
	}

	.cat-side ul {
		display: grid;
		gap: 1px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.heading {
		display: flex;
		justify-content: space-between;
		margin: 1rem 0.625rem 0.25rem;
		font: 600 0.66rem var(--rb-font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--rb-ink-3);
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		min-height: 2rem;
		padding: 0.3125rem 0.625rem;
		border: 0;
		border-radius: 0.4375rem;
		background: none;
		color: var(--rb-ink-2);
		font: 500 0.86rem var(--rb-font);
		text-align: left;
		cursor: pointer;
	}

	.row.all {
		grid-template-columns: 1.125rem minmax(0, 1fr) auto;
		min-height: 2.25rem;
		color: var(--rb-ink);
		font-weight: 600;
	}

	.grp-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font: 500 0.82rem var(--rb-font-mono);
	}

	.row:hover {
		background: var(--rb-raised);
		color: var(--rb-ink);
	}

	.row[aria-current='true'] {
		background: var(--rb-signal-soft);
		color: var(--rb-signal);
		font-weight: 600;
	}

	.row[aria-current='true'] .grp-name {
		font-weight: 600;
	}

	small {
		font: 0.72rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	/* main */
	.cat-main {
		min-width: 0;
		padding-top: 1.75rem;
		container-type: inline-size;
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

	.crumb-link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--rb-ink-3);
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}

	h1 {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.625rem;
		margin: 0.375rem 0 0.25rem;
		font: 700 clamp(1.6rem, 3vw, 2.1rem) / 1.15 var(--rb-font-display);
		letter-spacing: -0.02em;
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
		color: var(--rb-ink-2);
		font-size: 0.95rem;
	}

	.lede code {
		font: 0.85rem var(--rb-font-mono);
		color: var(--rb-ink);
	}

	.group-select {
		width: 100%;
		height: 2.5rem;
		margin-top: 1rem;
		padding: 0 0.75rem;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.5rem;
		background: var(--rb-surface);
		color: var(--rb-ink);
		font: 500 0.9rem var(--rb-font);
	}

	@media (min-width: 1024px) {
		.group-select {
			display: none;
		}
	}

	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.625rem;
		margin-top: 1.25rem;
	}

	.search {
		position: relative;
		flex: 1 1 18rem;
	}

	.search > .i {
		position: absolute;
		left: 0.875rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--rb-ink-3);
		pointer-events: none;
	}

	.search input {
		width: 100%;
		height: 2.75rem;
		padding: 0 2.5rem 0 2.625rem;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.5rem;
		background: var(--rb-surface);
		color: var(--rb-ink);
		font: 0.94rem var(--rb-font);
	}

	.search input:focus {
		outline: 2px solid var(--rb-signal);
		outline-offset: 1px;
	}

	.search kbd {
		position: absolute;
		right: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		padding: 0 0.3rem;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.25rem;
		color: var(--rb-ink-3);
		font: 500 0.66rem var(--rb-font-mono);
	}

	.seg {
		display: inline-flex;
		overflow: hidden;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.5rem;
		background: var(--rb-surface);
	}

	.seg button {
		height: 2.625rem;
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

	.status {
		margin: 0.625rem 0 0;
		font: 0.75rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	/* table grouped by API group */
	.tbl {
		margin-top: 0.75rem;
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
		padding: 0.5rem 1rem;
		border-top: 1px solid var(--rb-line);
		vertical-align: baseline;
	}

	.grp-row th {
		padding: 0.75rem 1rem 0.4375rem;
		border-top: 1px solid var(--rb-line);
		background: var(--rb-bg);
		text-align: left;
		font-weight: 400;
	}

	.grp-row button,
	.grp-row b {
		padding: 0;
		border: 0;
		background: none;
		color: var(--rb-ink);
		font: 700 0.92rem var(--rb-font);
		cursor: pointer;
	}

	.grp-row b {
		cursor: default;
	}

	.grp-row button:hover {
		color: var(--rb-signal);
		text-decoration: underline;
	}

	.grp-row span {
		margin-left: 0.625rem;
		color: var(--rb-ink-3);
		font: 0.72rem var(--rb-font-mono);
	}

	.grp-row small {
		float: right;
	}

	.k button {
		padding: 0;
		border: 0;
		background: none;
		color: var(--rb-ink);
		font: 600 0.86rem var(--rb-font-mono);
		text-align: left;
		cursor: pointer;
	}

	.k button:hover {
		color: var(--rb-signal);
		text-decoration: underline;
	}

	.tag {
		margin-left: 0.4375rem;
		padding: 0.0625rem 0.3125rem;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.25rem;
		color: var(--rb-ink-3);
		font: 600 0.58rem var(--rb-font-mono);
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.tag--dep {
		border-color: color-mix(in srgb, var(--rb-removed) 45%, transparent);
		color: var(--rb-removed);
	}

	.sc {
		color: var(--rb-ink-2);
		font-size: 0.8rem;
		white-space: nowrap;
	}

	.v {
		white-space: nowrap;
	}

	.ver {
		display: inline-block;
		margin-right: 0.25rem;
		padding: 0.0625rem 0.375rem;
		border-radius: 0.25rem;
		background: var(--rb-signal-soft);
		color: var(--rb-signal);
		font: 600 0.74rem var(--rb-font-mono);
	}

	.ver--old {
		background: var(--rb-raised);
		color: var(--rb-ink-3);
		font-weight: 500;
	}

	.ver.is-dep {
		text-decoration: line-through;
	}

	.none {
		color: var(--rb-ink-3);
		font: italic 0.76rem var(--rb-font);
	}

	.n {
		color: var(--rb-ink-3);
		font: 0.74rem var(--rb-font-mono);
		overflow-wrap: anywhere;
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

		tr.res .v {
			grid-column: 2;
			grid-row: 1;
		}

		tr.res .sc {
			display: none;
		}

		tr.res .n {
			grid-column: 1 / -1;
		}

		.grp-row,
		.grp-row th {
			display: block;
		}
	}

	.empty {
		margin-top: 1rem;
		padding: 2.5rem 1rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.75rem;
		background: var(--rb-surface);
		color: var(--rb-ink-3);
		text-align: center;
	}

	.empty p {
		margin: 0;
	}

	.empty button {
		margin-top: 0.5rem;
		padding: 0;
		border: 0;
		background: none;
		color: var(--rb-signal);
		font: 600 0.9rem var(--rb-font);
		cursor: pointer;
	}

	.cat-page :focus-visible {
		outline: 2px solid var(--rb-signal);
		outline-offset: 2px;
	}
</style>
