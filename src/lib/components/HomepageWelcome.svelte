<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import type { CrdResource, EdaRelease } from '$lib/structure';
	import { searchResources } from '$lib/resourceSearch';
	import { buildCatalogCrdPath, buildComparisonPath } from '$lib/urlState';
	import { buildOpenApiCatalogPath, resolveOpenApiReleaseName } from '$lib/openapi/urlState';
	import type { OpenApiReleasesConfig } from '$lib/openapi/types';
	import { getLatestVersion } from '$lib/versions';
	import { loadStaticYaml } from '$lib/yaml/safeYaml';
	import { fetchReleaseNotesIndex } from '$lib/release-notes/loadStatic';
	import openapiReleasesYaml from '$lib/openapi-releases.yaml?raw';
	import { splitByMajor } from '$lib/releaseLines';
	import type { Writable } from 'svelte/store';

	type ReleaseGroup = {
		label: string;
		releases: EdaRelease[];
	};

	export let groupedReleases: ReleaseGroup[];
	export let selectedRelease: Writable<EdaRelease>;
	export let crdMetaStore: Writable<CrdResource[]>;
	export let onResourceSelect: (resourceName: string) => void | Promise<void>;
	export let onBrowseRelease: (release: EdaRelease) => void | Promise<void>;

	const openApiReleases =
		(loadStaticYaml(openapiReleasesYaml) as OpenApiReleasesConfig).releases ?? [];

	$: openApiReleaseName = resolveOpenApiReleaseName(openApiReleases, $selectedRelease.name);
	$: allReleases = groupedReleases.flatMap((g) => g.releases);
	$: majorRows = splitByMajor(allReleases, 4);
	$: crdCount = $crdMetaStore.length;
	$: groupCount = new Set($crdMetaStore.map((r) => r.group ?? r.name.split('.').slice(1).join('.')))
		.size;

	const POPULAR = ['Fabric', 'BridgeDomain', 'TopoNode', 'Interface', 'BGPPeer', 'Router'];

	/* ---------- "More" menus, one per major row ---------- */
	let moreOpen: string | null = null;
	let panelEl: HTMLElement;

	function pickRelease(release: EdaRelease) {
		moreOpen = null;
		void onBrowseRelease(release);
	}

	function windowClick(event: MouseEvent) {
		if (!moreOpen) return;
		const menu = panelEl?.querySelector(`[data-more="${moreOpen}"]`);
		if (menu && !event.composedPath().includes(menu)) moreOpen = null;
	}

	function moreKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !moreOpen) return;
		const major = moreOpen;
		moreOpen = null;
		panelEl?.querySelector<HTMLElement>(`[data-more="${major}"] button`)?.focus();
	}

	/** Short caption under a release: what it changed in CRDs. */
	function caption(release: EdaRelease, changesTo: Record<string, ChangeSummary>): string {
		const c = changesTo[release.name];
		if (!c) return '';
		const parts = [
			c.added ? `+${c.added}` : '',
			c.modified ? `~${c.modified}` : '',
			c.removed ? `−${c.removed}` : ''
		].filter(Boolean);
		return parts.length ? parts.join(' ') : 'unchanged';
	}

	/* ---------- search ---------- */
	let heroSearch = '';
	let searchFocused = false;
	let highlightedIndex = 0;

	$: filteredResources = searchResources($crdMetaStore, heroSearch);
	$: showSearchResults = searchFocused && heroSearch.trim().length > 0;
	$: if (filteredResources.length === 0) {
		highlightedIndex = 0;
	} else if (highlightedIndex >= filteredResources.length) {
		highlightedIndex = filteredResources.length - 1;
	}

	function shortName(name: string) {
		return name.split('.')[0];
	}

	function groupName(name: string) {
		return name.split('.').slice(1).join('.');
	}

	function isDeprecated(resource: CrdResource) {
		return resource.versions.length > 0 && resource.versions.every((v) => v.deprecated);
	}

	async function pickResource(resource: CrdResource) {
		heroSearch = '';
		searchFocused = false;
		await onResourceSelect(resource.name);
	}

	function pickPopular(kind: string) {
		const resource = $crdMetaStore.find((r) => r.kind === kind);
		if (resource) void pickResource(resource);
		else void goto(buildCatalogCrdPath({ release: $selectedRelease.name, kind }));
	}

	function handleSearchKeydown(event: KeyboardEvent) {
		if (!showSearchResults || filteredResources.length === 0) {
			if (event.key === 'Enter' && filteredResources[0]) {
				event.preventDefault();
				void pickResource(filteredResources[0]);
			}
			return;
		}
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			highlightedIndex = (highlightedIndex + 1) % filteredResources.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			highlightedIndex =
				(highlightedIndex - 1 + filteredResources.length) % filteredResources.length;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			void pickResource(filteredResources[highlightedIndex]);
		} else if (event.key === 'Escape') {
			searchFocused = false;
			heroSearch = '';
		}
	}

	function closeSearchResults() {
		if (browser) setTimeout(() => (searchFocused = false), 150);
	}

	/* ---------- latest change summary ---------- */
	type ChangeSummary = {
		from: string;
		to: string;
		added: number;
		modified: number;
		removed: number;
	};
	let latestChange: ChangeSummary | null = null;
	let unchangedSince: string | null = null;
	/** CRD changes that arrived with each release, keyed by the release it went to. */
	let changesTo: Record<string, ChangeSummary> = {};

	onMount(async () => {
		const index = await fetchReleaseNotesIndex().catch(() => null);
		if (!index) return;
		const entries = index.entries;
		changesTo = Object.fromEntries(
			entries.map((e) => [
				e.toVer,
				{
					from: e.fromVer,
					to: e.toVer,
					added: e.summary?.added ?? 0,
					modified: e.summary?.modified ?? 0,
					removed: e.summary?.removed ?? 0
				}
			])
		);
		const first = entries[0];
		const changed = entries.find(
			(e) => (e.summary?.added ?? 0) + (e.summary?.modified ?? 0) + (e.summary?.removed ?? 0) > 0
		);
		if (!changed) return;
		latestChange = {
			from: changed.fromVer,
			to: changed.toVer,
			added: changed.summary?.added ?? 0,
			modified: changed.summary?.modified ?? 0,
			removed: changed.summary?.removed ?? 0
		};
		if (first && first !== changed) unchangedSince = first.toVer;
	});

	/* ---------- tools ---------- */
	type Tool = {
		id: string;
		group: 'explore' | 'check' | 'api';
		label: string;
		description: string;
		icon: string;
		primary?: boolean;
	};

	const tools: Tool[] = [
		{
			id: 'browse',
			group: 'explore',
			label: 'Catalog',
			description: 'Every CRD with its versions, fields and status.',
			icon: 'M4 6h16M4 12h16M4 18h10'
		},
		{
			id: 'validate',
			group: 'check',
			label: 'Validate YAML',
			description: "Check manifests against the release's schemas, with fixes.",
			icon: 'M5 12.5l4.5 4.5L19 7',
			primary: true
		},
		{
			id: 'release-changes',
			group: 'check',
			label: 'Release Changes',
			description: 'New, removed and changed CRDs between versions.',
			icon: 'M9 12h6m-6 4h4m4 5H7a2 2 0 01-2-2V5a2 2 0 012-2h6l6 6v10a2 2 0 01-2 2z'
		},
		{
			id: 'spec',
			group: 'explore',
			label: 'Spec Search',
			description: 'Find any field, like vlanID or asnPool, across schemas.',
			icon: 'M21 21l-5-5m2-5.5a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z'
		},
		{
			id: 'compare',
			group: 'check',
			label: 'Compare releases',
			description: 'Side-by-side schema diff for one CRD or all of them.',
			icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4'
		},
		{
			id: 'dep-map',
			group: 'explore',
			label: 'Dependency Map',
			description: 'See which resources a CRD references and is used by.',
			icon: 'M7 12a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zm15-6a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zm0 12a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM7 11l10-4M7 13l10 4'
		},
		{
			id: 'api-explorer',
			group: 'api',
			label: 'API Explorer',
			description: 'OpenAPI paths and schemas for core and app APIs.',
			icon: 'M8 6l-6 6 6 6M16 6l6 6-6 6'
		},
		{
			id: 'docs',
			group: 'api',
			label: 'Docs',
			description: 'How each tool works, with diagrams.',
			icon: 'M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2zm0 0v13'
		}
	];

	const TOOL_GROUPS: Array<{ id: Tool['group']; title: string; blurb: string }> = [
		{ id: 'explore', title: 'Explore schemas', blurb: 'Find a CRD, a field or what uses it.' },
		{ id: 'check', title: 'Check and compare', blurb: 'Validate manifests and track changes.' },
		{ id: 'api', title: 'REST API and docs', blurb: 'Call EDA directly, or read how it works.' }
	];

	function toolFact(
		id: string,
		crdCount: number,
		groupCount: number,
		latestChange: ChangeSummary | null
	): string {
		switch (id) {
			case 'browse':
				return crdCount ? `${crdCount} CRDs · ${groupCount} groups` : 'CRDs by API group';
			case 'validate':
				return 'Schema, Kubernetes and EDA rules';
			case 'release-changes':
				return latestChange ? `${latestChange.from} → ${latestChange.to}` : 'Changelog by release';
			case 'spec':
				return 'Field-level search';
			case 'compare':
				return `Any two of ${allReleases.length} releases`;
			case 'dep-map':
				return 'From schema references';
			case 'api-explorer':
				return 'Core and app APIs';
			default:
				return 'Guides and architecture';
		}
	}

	function toolHref(id: string, release: string): string | null {
		switch (id) {
			case 'browse':
				return null;
			case 'validate':
				return `/validate-yaml?release=${encodeURIComponent(release)}`;
			case 'release-changes':
				return `/release-changes?v=${encodeURIComponent(release)}`;
			case 'spec':
				return `/spec-search?release=${encodeURIComponent(release)}`;
			case 'compare':
				return buildComparisonPath({ sourceRelease: release });
			case 'dep-map':
				return `/dependency-map?release=${encodeURIComponent(release)}`;
			case 'api-explorer':
				return buildOpenApiCatalogPath({ release: openApiReleaseName });
			default:
				return '/docs';
		}
	}
</script>

<svelte:window on:click={windowClick} on:keydown={moreKeydown} />

<div class="rb-home page-shell min-h-full">
	<AppHeader />

	<main class="rb-home-main">
		<div class="rb-hero-band">
			<section class="rb-hero rb-wrap" aria-labelledby="hero-heading">
				<div class="rb-hero-copy">
					<p class="rb-eyebrow">
						<span class="rb-dot" aria-hidden="true"></span>
						Nokia EDA · {crdCount || '350+'} CRDs · {allReleases.length} releases
					</p>
					<h1 id="hero-heading">Every Nokia EDA resource schema, <em>by release.</em></h1>
					<p class="rb-sub">
						Look up any CRD and its fields, see what changed between releases, and check your
						manifests before you apply them.
					</p>

					<div class="rb-search">
						<label for="homepage-search" class="sr-only">Search CRDs</label>
						<svg viewBox="0 0 24 24" aria-hidden="true"
							><path d="M21 21l-5-5m2-5.5a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z" /></svg
						>
						<input
							id="homepage-search"
							type="search"
							bind:value={heroSearch}
							on:focus={() => (searchFocused = true)}
							on:blur={closeSearchResults}
							on:keydown={handleSearchKeydown}
							placeholder="Search a CRD by kind or group, e.g. BGPPeer"
							autocomplete="off"
							aria-controls={showSearchResults ? 'homepage-search-results' : undefined}
							aria-expanded={showSearchResults}
							role="combobox"
							aria-autocomplete="list"
						/>
						<span class="rb-search-release">in {$selectedRelease.name}</span>
						{#if showSearchResults}
							<ul id="homepage-search-results" role="listbox" class="rb-results">
								{#if filteredResources.length === 0}
									<li class="rb-results-empty">
										No CRD matches "{heroSearch}". Try Spec Search for fields.
									</li>
								{:else}
									{#each filteredResources as resource, i}
										<li role="option" aria-selected={i === highlightedIndex}>
											<button
												type="button"
												class:is-active={i === highlightedIndex}
												on:mousedown|preventDefault={() => pickResource(resource)}
											>
												<span class="rb-result-kind">
													{resource.kind || shortName(resource.name)}
													{#if isDeprecated(resource)}<span class="rb-tag-deprecated"
															>Deprecated</span
														>{/if}
												</span>
												<span class="rb-result-group">{groupName(resource.name)}</span>
												{#if resource.versions.length > 0}
													<span class="rb-result-version">{getLatestVersion(resource)}</span>
												{/if}
											</button>
										</li>
									{/each}
								{/if}
							</ul>
						{/if}
					</div>

					<div class="rb-chips">
						<span class="rb-chips-label">Popular</span>
						{#each POPULAR as kind}
							<button type="button" class="rb-chip" on:click={() => pickPopular(kind)}
								>{kind}</button
							>
						{/each}
					</div>
				</div>

				<section class="rb-panel" aria-labelledby="releases-heading" bind:this={panelEl}>
					<div class="rb-panel-head">
						<h2 id="releases-heading">Releases</h2>
						<a href="/release-changes">What changed →</a>
					</div>
					{#each majorRows as row (row.major)}
						<div class="rb-major">
							<p class="rb-major-label">EDA {row.major}</p>
							<ol class="rb-major-list" aria-label="EDA {row.major} releases, newest first">
								{#each row.shown as release (release.name)}
									{@const text = caption(release, changesTo)}
									<li>
										<button
											type="button"
											class="rb-rel"
											aria-current={$selectedRelease.name === release.name ? 'true' : undefined}
											on:click={() => onBrowseRelease(release)}
										>
											<span class="rb-rel-name">{release.name}</span>
											{#if release.default}
												<span class="rb-rel-cap rb-rel-cap--latest">Latest</span>
											{:else if text}
												<span class="rb-rel-cap">{text}</span>
											{/if}
										</button>
									</li>
								{/each}
							</ol>
							{#if row.more.length}
								{@const current = row.more.find((r) => r.name === $selectedRelease.name)}
								<div class="rb-more" data-more={row.major}>
									<button
										type="button"
										class="rb-more-btn"
										class:is-current={!!current}
										aria-expanded={moreOpen === row.major}
										aria-controls="rb-more-{row.major}"
										on:click={() => (moreOpen = moreOpen === row.major ? null : row.major)}
									>
										<span
											><span class="sr-only">More EDA {row.major} releases: </span>{current
												? current.name
												: `+${row.more.length}`}</span
										>
										<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg
										>
									</button>
									{#if moreOpen === row.major}
										<ul id="rb-more-{row.major}" class="rb-more-menu">
											{#each row.more as release (release.name)}
												<li>
													<button
														type="button"
														aria-current={$selectedRelease.name === release.name
															? 'true'
															: undefined}
														on:click={() => pickRelease(release)}
													>
														<span>{release.name}</span>
														<span class="rb-more-cap">{caption(release, changesTo)}</span>
													</button>
												</li>
											{/each}
										</ul>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
					{#if latestChange}
						<p class="rb-panel-note">
							<b>{latestChange.from} → {latestChange.to}</b>:
							<span class="rb-delta rb-delta--add">+{latestChange.added}</span> new,
							<span class="rb-delta rb-delta--mod">~{latestChange.modified}</span> changed,
							<span class="rb-delta rb-delta--rem">−{latestChange.removed}</span> removed CRDs{#if unchangedSince};
								{unchangedSince} has no CRD changes{/if}.
						</p>
					{/if}
				</section>
			</section>
		</div>

		<section class="rb-tools-band rb-wrap" aria-labelledby="tools-heading">
			<h2 id="tools-heading" class="rb-section-title">Tools for EDA {$selectedRelease.name}</h2>
			<div class="rb-groups">
				{#each TOOL_GROUPS as group (group.id)}
					<section class="rb-group" aria-labelledby="tools-{group.id}">
						<h3 id="tools-{group.id}">{group.title}</h3>
						<p>{group.blurb}</p>
						<ul>
							{#each tools.filter((t) => t.group === group.id) as tool (tool.id)}
								{@const href = toolHref(tool.id, $selectedRelease.name)}
								<li>
									<svelte:element
										this={href ? 'a' : 'button'}
										{href}
										type={href ? undefined : 'button'}
										role={href ? undefined : 'button'}
										class="rb-tool"
										class:is-primary={tool.primary}
										on:click={href ? undefined : () => onBrowseRelease($selectedRelease)}
									>
										<span class="rb-tool-icon" aria-hidden="true"
											><svg viewBox="0 0 24 24"><path d={tool.icon} /></svg></span
										>
										<span class="rb-tool-text">
											<span class="rb-tool-label">{tool.label}</span>
											<span class="rb-tool-desc">{tool.description}</span>
											<span class="rb-tool-fact"
												>{toolFact(tool.id, crdCount, groupCount, latestChange)}</span
											>
										</span>
										<svg class="rb-tool-go" viewBox="0 0 12 12" aria-hidden="true"
											><path d="M4.5 3 7.5 6 4.5 9" /></svg
										>
									</svelte:element>
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			</div>
		</section>
	</main>
</div>

<style>
	.rb-home {
		background: var(--rb-bg);
		color: var(--rb-ink);
		font-family: var(--rb-font);
	}
	.rb-wrap {
		max-width: 80rem;
		margin: 0 auto;
		padding-left: max(1rem, env(safe-area-inset-left, 0px));
		padding-right: max(1rem, env(safe-area-inset-right, 0px));
	}
	@media (min-width: 1024px) {
		.rb-wrap {
			padding-left: 2.5rem;
			padding-right: 2.5rem;
		}
	}
	.rb-home-main {
		padding-bottom: 2rem;
	}
	.rb-hero-band {
		position: relative;
		margin-bottom: 2.5rem;
		background: var(--rb-surface);
		border-bottom: 1px solid var(--rb-line);
	}
	.rb-hero-band::before {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		background-image: radial-gradient(var(--rb-line-strong) 1px, transparent 1.2px);
		background-size: 22px 22px;
		mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.5), transparent 80%);
	}
	h1,
	h2 {
		margin: 0;
		text-wrap: balance;
	}

	/* hero: search on the left, releases on the right */
	.rb-hero {
		position: relative;
		display: grid;
		gap: 2rem;
		padding-top: 2.25rem;
		padding-bottom: 2.5rem;
		align-items: start;
	}
	@media (min-width: 1024px) {
		.rb-hero {
			grid-template-columns: minmax(0, 1fr) minmax(0, 30rem);
			gap: 3rem;
			align-items: center;
			padding-top: 3.5rem;
			padding-bottom: 3.5rem;
		}
	}
	/* hero */
	.rb-hero-copy {
		min-width: 0;
	}
	.rb-eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		font: 500 0.75rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}
	.rb-dot {
		width: 0.4375rem;
		height: 0.4375rem;
		border-radius: 50%;
		background: var(--rb-ok);
		box-shadow: 0 0 0 3px var(--rb-ok-soft);
	}
	.rb-hero h1 {
		margin: 0.875rem 0 0.75rem;
		font-family: var(--rb-font-display);
		font-size: clamp(1.85rem, 4vw, 2.6rem);
		font-weight: 700;
		line-height: 1.08;
		letter-spacing: -0.02em;
		color: var(--rb-ink);
	}
	.rb-hero h1 em {
		font-style: normal;
		color: var(--rb-signal);
	}
	.rb-sub {
		margin: 0;
		max-width: 52ch;
		font-size: 1.02rem;
		line-height: 1.55;
		color: var(--rb-ink-2);
	}
	.rb-search {
		position: relative;
		margin-top: 1.5rem;
	}
	.rb-search > svg {
		position: absolute;
		left: 1rem;
		top: 50%;
		width: 1.125rem;
		height: 1.125rem;
		transform: translateY(-50%);
		fill: none;
		stroke: var(--rb-ink-3);
		stroke-width: 1.8;
		stroke-linecap: round;
		pointer-events: none;
	}
	.rb-search input {
		width: 100%;
		height: 3.25rem;
		padding: 0 1rem 0 2.875rem;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.625rem;
		background: var(--rb-surface);
		color: var(--rb-ink);
		font: 500 1rem var(--rb-font);
		box-shadow: 0 10px 30px -18px rgba(10, 30, 80, 0.35);
	}
	.rb-search input::placeholder {
		color: var(--rb-ink-3);
	}
	.rb-search input:focus {
		outline: 2px solid var(--rb-signal);
		outline-offset: 1px;
	}
	.rb-results {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(100% + 0.375rem);
		z-index: 20;
		max-height: 20rem;
		margin: 0;
		padding: 0.375rem;
		overflow: auto;
		list-style: none;
		background: var(--rb-surface);
		border: 1px solid var(--rb-line);
		border-radius: 0.625rem;
		box-shadow: var(--rb-shadow-pop);
	}
	.rb-results button {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0 0.75rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		border: 0;
		border-radius: 0.375rem;
		background: none;
		color: var(--rb-ink);
		text-align: left;
		cursor: pointer;
	}
	.rb-results button:hover,
	.rb-results button.is-active {
		background: var(--rb-raised);
	}
	.rb-result-kind {
		font-weight: 600;
		font-size: 0.9rem;
	}
	.rb-result-group {
		grid-column: 1;
		font: 0.75rem var(--rb-font-mono);
		color: var(--rb-ink-3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rb-result-version {
		grid-column: 2;
		grid-row: 1 / span 2;
		align-self: center;
		font: 500 0.72rem var(--rb-font-mono);
		color: var(--rb-ink-2);
		background: var(--rb-raised);
		border-radius: 0.25rem;
		padding: 0.125rem 0.375rem;
	}
	.rb-results-empty {
		padding: 0.625rem;
		font-size: 0.875rem;
		color: var(--rb-ink-3);
	}
	.rb-tag-deprecated {
		margin-left: 0.375rem;
		font: 600 0.6rem var(--rb-font-mono);
		text-transform: uppercase;
		color: var(--rb-removed);
	}
	.rb-chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.75rem;
	}
	.rb-chips-label {
		margin-right: 0.125rem;
		font-size: 0.8rem;
		color: var(--rb-ink-3);
	}
	.rb-chip {
		min-height: 2rem;
		padding: 0 0.625rem;
		border: 1px solid var(--rb-line);
		border-radius: 999px;
		background: var(--rb-surface);
		color: var(--rb-ink-2);
		font: 500 0.78rem var(--rb-font-mono);
		cursor: pointer;
	}
	.rb-chip:hover {
		border-color: var(--rb-signal);
		color: var(--rb-signal);
	}

	.rb-search-release {
		position: absolute;
		right: 0.875rem;
		top: 50%;
		transform: translateY(-50%);
		font: 500 0.72rem var(--rb-font-mono);
		color: var(--rb-ink-3);
		pointer-events: none;
	}
	@media (max-width: 479px) {
		.rb-search-release {
			display: none;
		}
	}

	/* releases panel */
	.rb-panel {
		min-width: 0;
		padding: 1rem 1.125rem 0.875rem;
		background: var(--rb-surface);
		border: 1px solid var(--rb-line);
		border-radius: 0.875rem;
		box-shadow: 0 24px 60px -36px rgba(10, 30, 80, 0.45);
	}
	.rb-panel-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}
	.rb-panel-head h2 {
		font: 700 1rem var(--rb-font-display);
		color: var(--rb-ink);
	}
	.rb-panel-head a {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--rb-signal);
		text-decoration: none;
	}
	.rb-panel-head a:hover {
		text-decoration: underline;
	}
	.rb-major {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: stretch;
		gap: 0.375rem 0.5rem;
		padding: 0.75rem 0;
		border-top: 1px solid var(--rb-line);
	}
	.rb-major-label {
		grid-column: 1 / -1;
		margin: 0;
		font: 600 0.68rem var(--rb-font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--rb-ink-3);
	}
	.rb-major-list {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.rb-major-list li {
		display: flex;
		min-width: 0;
	}
	.rb-rel {
		display: grid;
		align-content: center;
		gap: 0.125rem;
		width: 100%;
		min-height: 3.25rem;
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.5rem;
		background: var(--rb-bg);
		color: var(--rb-ink);
		text-align: left;
		cursor: pointer;
		transition: border-color 0.15s;
	}
	.rb-rel:hover {
		border-color: var(--rb-signal);
	}
	.rb-rel-name {
		font: 600 0.9rem var(--rb-font-mono);
		letter-spacing: -0.01em;
	}
	.rb-rel-cap {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font: 0.66rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}
	.rb-rel-cap--latest {
		justify-self: start;
		padding: 0 0.3125rem;
		border-radius: 0.25rem;
		background: var(--rb-ok-soft);
		color: var(--rb-ok);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.rb-rel[aria-current='true'] {
		border-color: var(--rb-signal);
		background: var(--rb-signal);
		color: var(--rb-signal-ink);
	}
	.rb-rel[aria-current='true'] .rb-rel-cap {
		color: color-mix(in srgb, var(--rb-signal-ink) 80%, transparent);
	}
	.rb-rel[aria-current='true'] .rb-rel-cap--latest {
		background: color-mix(in srgb, var(--rb-signal-ink) 20%, transparent);
		color: var(--rb-signal-ink);
	}
	.rb-more {
		position: relative;
		display: flex;
	}
	.rb-more-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		min-width: 3.25rem;
		padding: 0 0.5rem;
		border: 1px dashed var(--rb-line-strong);
		border-radius: 0.5rem;
		background: none;
		color: var(--rb-ink-2);
		font: 600 0.8rem var(--rb-font-mono);
		cursor: pointer;
	}
	.rb-more-btn:hover,
	.rb-more-btn[aria-expanded='true'] {
		border-color: var(--rb-signal);
		color: var(--rb-signal);
	}
	.rb-more-btn.is-current {
		border-style: solid;
		border-color: var(--rb-signal);
		background: var(--rb-signal);
		color: var(--rb-signal-ink);
	}
	.rb-more-btn svg {
		width: 0.75rem;
		height: 0.75rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
	}
	.rb-more-menu {
		position: absolute;
		right: 0;
		top: calc(100% + 0.375rem);
		z-index: 30;
		width: 14rem;
		margin: 0;
		padding: 0.375rem;
		list-style: none;
		background: var(--rb-surface);
		border: 1px solid var(--rb-line);
		border-radius: 0.625rem;
		box-shadow: var(--rb-shadow-pop);
	}
	.rb-more-menu button {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		width: 100%;
		padding: 0.4375rem 0.5rem;
		border: 0;
		border-radius: 0.375rem;
		background: none;
		color: var(--rb-ink);
		font: 600 0.86rem var(--rb-font-mono);
		text-align: left;
		cursor: pointer;
	}
	.rb-more-menu button:hover {
		background: var(--rb-raised);
	}
	.rb-more-menu button[aria-current='true'] {
		background: var(--rb-signal-soft);
		color: var(--rb-signal);
	}
	.rb-more-cap {
		font: 400 0.7rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}
	.rb-panel-note {
		margin: 0;
		padding-top: 0.75rem;
		border-top: 1px solid var(--rb-line);
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--rb-ink-3);
	}
	.rb-panel-note b {
		font-family: var(--rb-font-mono);
		font-weight: 600;
		color: var(--rb-ink);
	}
	.rb-delta {
		font-family: var(--rb-font-mono);
		font-weight: 600;
	}
	.rb-delta--add {
		color: var(--rb-ok);
	}
	.rb-delta--mod {
		color: var(--rb-signal);
	}
	.rb-delta--rem {
		color: var(--rb-removed);
	}

	/* tools, grouped by task */
	.rb-tools-band {
		padding-bottom: 1rem;
	}
	.rb-section-title {
		margin-bottom: 1rem;
		font: 700 1.15rem var(--rb-font-display);
		color: var(--rb-ink);
	}
	.rb-groups {
		display: grid;
		gap: 1.25rem;
	}
	@media (min-width: 900px) {
		.rb-groups {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.rb-group {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.rb-group h3 {
		margin: 0;
		font: 600 0.72rem var(--rb-font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--rb-ink-2);
	}
	.rb-group > p {
		margin: 0.25rem 0 0.75rem;
		font-size: 0.84rem;
		color: var(--rb-ink-3);
	}
	.rb-group ul {
		flex: 1;
		display: grid;
		align-content: start;
		margin: 0;
		padding: 0;
		list-style: none;
		background: var(--rb-surface);
		border: 1px solid var(--rb-line);
		border-radius: 0.75rem;
		overflow: hidden;
	}
	.rb-group li + li {
		border-top: 1px solid var(--rb-line);
	}
	.rb-group li {
		display: flex;
	}
	.rb-tool {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: start;
		gap: 0.875rem;
		width: 100%;
		padding: 0.9375rem 1rem;
		border: 0;
		background: none;
		color: inherit;
		text-align: left;
		text-decoration: none;
		font: inherit;
		cursor: pointer;
		transition: background-color 0.15s;
	}
	.rb-tool:hover {
		background: var(--rb-raised);
	}
	.rb-tool-icon {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 0.5rem;
		background: var(--rb-signal-soft);
		color: var(--rb-signal);
	}
	.rb-tool.is-primary .rb-tool-icon {
		background: var(--rb-signal);
		color: var(--rb-signal-ink);
	}
	.rb-tool-icon svg {
		width: 1.0625rem;
		height: 1.0625rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.rb-tool-text {
		display: grid;
		gap: 0.125rem;
		min-width: 0;
	}
	.rb-tool-label {
		font-size: 0.94rem;
		font-weight: 600;
		color: var(--rb-ink);
	}
	.rb-tool-desc {
		font-size: 0.82rem;
		line-height: 1.45;
		color: var(--rb-ink-3);
	}
	.rb-tool-fact {
		margin-top: 0.25rem;
		font: 500 0.7rem var(--rb-font-mono);
		color: var(--rb-ink-2);
	}
	.rb-tool-go {
		align-self: center;
		width: 0.75rem;
		height: 0.75rem;
		fill: none;
		stroke: var(--rb-ink-3);
		stroke-width: 1.6;
		transition: transform 0.15s;
	}
	.rb-tool:hover .rb-tool-go {
		stroke: var(--rb-signal);
		transform: translateX(2px);
	}
	.rb-tool:hover .rb-tool-label {
		color: var(--rb-signal);
	}
	.rb-home :focus-visible {
		outline: 2px solid var(--rb-signal);
		outline-offset: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.rb-tool,
		.rb-rel,
		.rb-tool-go {
			transition: none;
		}
		.rb-tool:hover .rb-tool-go {
			transform: none;
		}
	}
</style>
