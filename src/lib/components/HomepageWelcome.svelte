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
	import { fetchSchema, schemaPath } from '$lib/yaml-validation/schemaCache';
	import { fetchReleaseNotesIndex } from '$lib/release-notes/loadStatic';
	import openapiReleasesYaml from '$lib/openapi-releases.yaml?raw';
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
	$: crdCount = $crdMetaStore.length;
	$: groupCount = new Set($crdMetaStore.map((r) => r.group ?? r.name.split('.').slice(1).join('.')))
		.size;

	const POPULAR = ['Fabric', 'BridgeDomain', 'TopoNode', 'Interface', 'BGPPeer', 'Router'];

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

	/* ---------- schema example ---------- */
	type SpecimenField = {
		path: string;
		leaf: string;
		type: string;
		meta?: string;
		required?: boolean;
	};
	const SPECIMEN = {
		name: 'bridgedomains.services.eda.nokia.com',
		kind: 'BridgeDomain',
		group: 'services.eda.nokia.com',
		paths: [
			'type',
			'eviPool',
			'evi',
			'encapOptions.vxlan.vniPool',
			'macLearning.enabled',
			'macLearning.agingTimeSeconds'
		]
	};
	/** Shown until the selected release's schema loads (values from 26.8.2). */
	let specimenVersion = 'v2';
	let specimenFields: SpecimenField[] = [
		{ path: 'spec.', leaf: 'type', type: 'string', meta: 'Simple | EVPNVXLAN | EVPNMPLS' },
		{ path: 'spec.', leaf: 'eviPool', type: 'string' },
		{ path: 'spec.', leaf: 'evi', type: 'integer', meta: '1 – 65535' },
		{ path: 'spec.encapOptions.vxlan.', leaf: 'vniPool', type: 'string' },
		{ path: 'spec.macLearning.', leaf: 'enabled', type: 'boolean', required: true },
		{ path: 'spec.macLearning.', leaf: 'agingTimeSeconds', type: 'integer', meta: '60 – 86400' }
	];

	type SchemaNode = {
		type?: string | string[];
		enum?: unknown[];
		minimum?: number;
		maximum?: number;
		properties?: Record<string, SchemaNode>;
		required?: string[];
	};

	function describe(node: SchemaNode): string | undefined {
		if (node.enum?.length) return node.enum.join(' | ');
		if (node.minimum !== undefined && node.maximum !== undefined)
			return `${node.minimum} – ${node.maximum}`;
		return undefined;
	}

	async function loadSpecimen(release: EdaRelease) {
		const resource = $crdMetaStore.find((r) => r.name === SPECIMEN.name);
		const version = resource ? getLatestVersion(resource) : null;
		if (!version) return;
		const sections = await fetchSchema(schemaPath(release.folder, SPECIMEN.name, version));
		const spec = sections?.spec as SchemaNode | undefined;
		if (!spec?.properties) return;
		const fields: SpecimenField[] = [];
		for (const path of SPECIMEN.paths) {
			const parts = path.split('.');
			let node: SchemaNode | undefined = spec;
			let parent: SchemaNode | undefined;
			for (const part of parts) {
				parent = node;
				node = node?.properties?.[part];
			}
			if (!node) continue;
			const type = Array.isArray(node.type) ? node.type[0] : node.type;
			fields.push({
				path: `spec.${parts
					.slice(0, -1)
					.map((p) => `${p}.`)
					.join('')}`,
				leaf: parts[parts.length - 1]!,
				type: type ?? 'object',
				meta: describe(node),
				required: parts.length > 1 && !!parent?.required?.includes(parts[parts.length - 1]!)
			});
		}
		if (fields.length >= 4) {
			specimenFields = fields;
			specimenVersion = version;
		}
	}

	$: if (browser && $crdMetaStore.length) void loadSpecimen($selectedRelease);

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

	onMount(async () => {
		const index = await fetchReleaseNotesIndex().catch(() => null);
		if (!index) return;
		const entries = index.entries;
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
		label: string;
		description: string;
		icon: string;
		primary?: boolean;
	};

	const tools: Tool[] = [
		{
			id: 'browse',
			label: 'Catalog',
			description: 'Every CRD with its versions, fields and status.',
			icon: 'M4 6h16M4 12h16M4 18h10'
		},
		{
			id: 'validate',
			label: 'Validate YAML',
			description: "Check manifests against the release's schemas, with fixes.",
			icon: 'M5 12.5l4.5 4.5L19 7',
			primary: true
		},
		{
			id: 'release-changes',
			label: 'Release Changes',
			description: 'New, removed and changed CRDs between versions.',
			icon: 'M9 12h6m-6 4h4m4 5H7a2 2 0 01-2-2V5a2 2 0 012-2h6l6 6v10a2 2 0 01-2 2z'
		},
		{
			id: 'spec',
			label: 'Spec Search',
			description: 'Find any field, like vlanID or asnPool, across schemas.',
			icon: 'M21 21l-5-5m2-5.5a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z'
		},
		{
			id: 'compare',
			label: 'Compare releases',
			description: 'Side-by-side schema diff for one CRD or all of them.',
			icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4'
		},
		{
			id: 'dep-map',
			label: 'Dependency Map',
			description: 'See which resources a CRD references and is used by.',
			icon: 'M7 12a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zm15-6a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zm0 12a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM7 11l10-4M7 13l10 4'
		},
		{
			id: 'api-explorer',
			label: 'API Explorer',
			description: 'OpenAPI paths and schemas for core and app APIs.',
			icon: 'M8 6l-6 6 6 6M16 6l6 6-6 6'
		},
		{
			id: 'docs',
			label: 'Docs',
			description: 'How each tool works, with diagrams.',
			icon: 'M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2zm0 0v13'
		}
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

<div class="rb-home page-shell min-h-full">
	<AppHeader />

	<main class="rb-home-main">
		<section class="rb-hero" aria-labelledby="hero-heading">
			<div class="rb-hero-copy">
				<p class="rb-eyebrow">
					<span class="rb-dot" aria-hidden="true"></span>
					EDA {$selectedRelease.name}{$selectedRelease.default ? ' · latest release' : ''}
				</p>
				<h1 id="hero-heading">Every Nokia EDA resource schema, <em>by release.</em></h1>
				<p class="rb-sub">
					Browse <b>{crdCount || '350+'}</b> CRDs{#if groupCount}&nbsp;across <b>{groupCount}</b> API
						groups{/if}, see what changed between <b>{allReleases.length}</b> releases, and check your
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
						placeholder="Search {crdCount || ''} CRDs by kind or group"
						autocomplete="off"
						aria-controls={showSearchResults ? 'homepage-search-results' : undefined}
						aria-expanded={showSearchResults}
						role="combobox"
						aria-autocomplete="list"
					/>
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
												{#if isDeprecated(resource)}<span class="rb-tag-deprecated">Deprecated</span
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
						<button type="button" class="rb-chip" on:click={() => pickPopular(kind)}>{kind}</button>
					{/each}
				</div>
			</div>

			<aside class="rb-specimen" aria-label="Example schema: {SPECIMEN.kind}">
				<div class="rb-specimen-head">
					<div>
						<p class="rb-specimen-kind">{SPECIMEN.kind}</p>
						<p class="rb-specimen-gv">{SPECIMEN.group}/{specimenVersion} · Namespaced</p>
					</div>
					<span class="rb-specimen-tag">Spec</span>
				</div>
				<ul class="rb-fields">
					{#each specimenFields as field (field.path + field.leaf)}
						<li>
							<span class="rb-field-key"
								><span class="rb-field-path">{field.path}</span><b>{field.leaf}</b
								>{#if field.required}<span class="rb-field-req" title="Required">&nbsp;*</span
									>{/if}</span
							>
							<span class="rb-field-type">{field.type}</span>
							{#if field.meta}<span class="rb-field-meta">{field.meta}</span>{/if}
						</li>
					{/each}
				</ul>
				<div class="rb-specimen-foot">
					<span>One of {crdCount || 'the'} CRDs in {$selectedRelease.name}</span>
					<button type="button" on:click={() => pickPopular(SPECIMEN.kind)}>Open schema →</button>
				</div>
			</aside>
		</section>

		<section class="rb-band" aria-labelledby="releases-heading">
			<div class="rb-band-head">
				<h2 id="releases-heading">Releases</h2>
				<a href="/release-changes">All release changes →</a>
			</div>
			<div class="rb-rail">
				{#each groupedReleases as group (group.label)}
					<div class="rb-train">
						<span class="rb-train-label">{group.label}</span>
						<ol class="rb-stops" aria-label="{group.label} releases, oldest first">
							{#each [...group.releases].reverse() as release (release.name)}
								{@const isSelected = $selectedRelease.name === release.name}
								<li>
									<button
										type="button"
										class="rb-stop"
										aria-current={isSelected ? 'true' : undefined}
										on:click={() => onBrowseRelease(release)}
									>
										{release.name}
										{#if release.default}<span class="rb-tag-latest">Latest</span>{/if}
									</button>
								</li>
							{/each}
						</ol>
					</div>
				{/each}
				{#if latestChange}
					<p class="rb-rail-note">
						Latest changes: <b>{latestChange.from} → {latestChange.to}</b> added
						<span class="rb-delta rb-delta--add">{latestChange.added}</span>, changed
						<span class="rb-delta rb-delta--mod">{latestChange.modified}</span> and removed
						<span class="rb-delta rb-delta--rem">{latestChange.removed}</span>
						CRDs.{#if unchangedSince}&nbsp;{unchangedSince}
							has no CRD schema changes.{/if}
					</p>
				{/if}
			</div>
		</section>

		<section class="rb-band" aria-labelledby="tools-heading">
			<div class="rb-band-head"><h2 id="tools-heading">Tools</h2></div>
			<ul class="rb-tools">
				{#each tools as tool (tool.id)}
					{@const href = toolHref(tool.id, $selectedRelease.name)}
					<li>
						{#if href}
							<a class="rb-tool" class:is-primary={tool.primary} {href}>
								<span class="rb-tool-icon" aria-hidden="true"
									><svg viewBox="0 0 24 24"><path d={tool.icon} /></svg></span
								>
								<span class="rb-tool-label">{tool.label}</span>
								<span class="rb-tool-desc">{tool.description}</span>
								<span class="rb-tool-fact"
									>{toolFact(tool.id, crdCount, groupCount, latestChange)}</span
								>
							</a>
						{:else}
							<button
								type="button"
								class="rb-tool"
								on:click={() => onBrowseRelease($selectedRelease)}
							>
								<span class="rb-tool-icon" aria-hidden="true"
									><svg viewBox="0 0 24 24"><path d={tool.icon} /></svg></span
								>
								<span class="rb-tool-label">{tool.label}</span>
								<span class="rb-tool-desc">{tool.description}</span>
								<span class="rb-tool-fact"
									>{toolFact(tool.id, crdCount, groupCount, latestChange)}</span
								>
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		</section>

	</main>
</div>

<style>
	.rb-home {
		background: var(--rb-bg);
		color: var(--rb-ink);
		font-family: var(--rb-font);
	}
	.rb-home-main {
		max-width: 80rem;
		margin: 0 auto;
		padding: 0 max(1rem, env(safe-area-inset-right, 0px)) 2rem
			max(1rem, env(safe-area-inset-left, 0px));
	}
	@media (min-width: 1024px) {
		.rb-home-main {
			padding-left: 2.5rem;
			padding-right: 2.5rem;
		}
	}
	h1,
	h2 {
		margin: 0;
		text-wrap: balance;
	}

	/* hero */
	.rb-hero {
		display: grid;
		gap: 2rem;
		padding: 2rem 0 2.25rem;
		align-items: center;
	}
	@media (min-width: 960px) {
		.rb-hero {
			grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
			gap: 2.5rem;
			padding: 3rem 0 2.5rem;
		}
	}
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
	.rb-sub b {
		font-family: var(--rb-font-mono);
		font-weight: 600;
		font-size: 0.94em;
		color: var(--rb-ink);
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

	/* schema example */
	.rb-specimen {
		min-width: 0;
		overflow: hidden;
		background: var(--rb-surface);
		border: 1px solid var(--rb-line);
		border-radius: 0.75rem;
		box-shadow: 0 24px 60px -32px rgba(10, 30, 80, 0.45);
	}
	.rb-specimen-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--rb-line);
	}
	.rb-specimen-head p {
		margin: 0;
	}
	.rb-specimen-kind {
		font-weight: 700;
		font-size: 0.95rem;
	}
	.rb-specimen-gv {
		font: 0.74rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}
	.rb-specimen-tag {
		font: 500 0.7rem var(--rb-font-mono);
		padding: 0.1875rem 0.5rem;
		border-radius: 0.3125rem;
		background: var(--rb-signal-soft);
		color: var(--rb-signal);
	}
	.rb-fields {
		margin: 0;
		padding: 0.375rem 0;
		list-style: none;
		font: 0.8rem var(--rb-font-mono);
	}
	.rb-fields li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0 0.75rem;
		padding: 0.4375rem 1rem;
		border-left: 2px solid transparent;
	}
	.rb-fields li:hover {
		background: var(--rb-raised);
		border-left-color: var(--rb-signal);
	}
	.rb-field-key {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--rb-ink);
	}
	.rb-field-path {
		color: var(--rb-ink-3);
	}
	.rb-field-req {
		color: var(--rb-removed);
		font-weight: 600;
	}
	.rb-field-type {
		color: var(--rb-code);
	}
	.rb-field-meta {
		grid-column: 1 / -1;
		font-size: 0.72rem;
		color: var(--rb-ink-3);
	}
	.rb-specimen-foot {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.625rem 1rem;
		border-top: 1px solid var(--rb-line);
		background: var(--rb-raised);
		font-size: 0.8rem;
		color: var(--rb-ink-3);
	}
	.rb-specimen-foot button {
		border: 0;
		background: none;
		padding: 0;
		color: var(--rb-signal);
		font: 600 0.8rem var(--rb-font);
		cursor: pointer;
	}

	/* bands */
	.rb-band {
		padding-bottom: 2.25rem;
	}
	.rb-band-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}
	.rb-band-head h2 {
		font-family: var(--rb-font-display);
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--rb-ink);
	}
	.rb-band-head a {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--rb-signal);
		text-decoration: none;
	}
	.rb-rail {
		display: grid;
		gap: 0.75rem;
		padding: 1rem 1.125rem;
		background: var(--rb-surface);
		border: 1px solid var(--rb-line);
		border-radius: 0.75rem;
	}
	.rb-train {
		display: grid;
		gap: 0.25rem;
		align-items: center;
	}
	@media (min-width: 640px) {
		.rb-train {
			grid-template-columns: 3.5rem minmax(0, 1fr);
			gap: 0.75rem;
		}
	}
	.rb-train-label {
		font: 600 0.75rem var(--rb-font-mono);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--rb-ink-3);
	}
	.rb-stops {
		display: flex;
		align-items: center;
		margin: 0;
		padding: 0.25rem 0.125rem;
		list-style: none;
		overflow-x: auto;
	}
	.rb-stops li {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}
	.rb-stops li + li::before {
		content: '';
		width: 1.125rem;
		height: 2px;
		background: var(--rb-line-strong);
	}
	.rb-stop {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-height: 2rem;
		padding: 0 0.6875rem;
		border: 1px solid var(--rb-line);
		border-radius: 999px;
		background: var(--rb-bg);
		color: var(--rb-ink-2);
		font: 500 0.8rem var(--rb-font-mono);
		cursor: pointer;
	}
	.rb-stop:hover {
		border-color: var(--rb-signal);
	}
	.rb-stop[aria-current='true'] {
		background: var(--rb-signal);
		border-color: var(--rb-signal);
		color: var(--rb-signal-ink);
	}
	.rb-stop[aria-current='true'] :global(.rb-tag-latest) {
		background: color-mix(in srgb, var(--rb-signal-ink) 18%, transparent);
		color: var(--rb-signal-ink);
	}
	.rb-rail-note {
		margin: 0;
		padding-top: 0.625rem;
		border-top: 1px dashed var(--rb-line);
		font-size: 0.82rem;
		color: var(--rb-ink-3);
	}
	.rb-rail-note b {
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

	/* tools */
	.rb-tools {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	@media (min-width: 900px) {
		.rb-tools {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
	.rb-tools li {
		display: flex;
	}
	.rb-tool {
		display: grid;
		align-content: start;
		gap: 0.375rem;
		width: 100%;
		padding: 1rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.75rem;
		background: var(--rb-surface);
		color: inherit;
		text-align: left;
		text-decoration: none;
		font: inherit;
		cursor: pointer;
		transition:
			border-color 0.15s,
			transform 0.15s;
	}
	.rb-tool:hover {
		border-color: var(--rb-signal);
		transform: translateY(-1px);
	}
	.rb-tool.is-primary {
		background: var(--rb-signal-soft);
		border-color: color-mix(in srgb, var(--rb-signal) 35%, var(--rb-line));
	}
	.rb-tool-icon {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		margin-bottom: 0.25rem;
		border-radius: 0.5rem;
		background: var(--rb-signal-soft);
		color: var(--rb-signal);
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
	.rb-tool-label {
		font-size: 0.92rem;
		font-weight: 600;
		color: var(--rb-ink);
	}
	.rb-tool-desc {
		font-size: 0.8rem;
		line-height: 1.45;
		color: var(--rb-ink-3);
	}
	.rb-tool-fact {
		margin-top: 0.25rem;
		font: 500 0.72rem var(--rb-font-mono);
		color: var(--rb-ink-2);
	}
	@media (max-width: 639px) {
		.rb-tool-desc {
			display: none;
		}
	}
	.rb-home :focus-visible {
		outline: 2px solid var(--rb-signal);
		outline-offset: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.rb-tool {
			transition: none;
		}
		.rb-tool:hover {
			transform: none;
		}
	}
</style>
