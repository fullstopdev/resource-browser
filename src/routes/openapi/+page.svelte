<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { writable } from 'svelte/store';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import PageCredits from '$lib/components/PageCredits.svelte';
	import ApiNavigator from '$lib/openapi/components/ApiNavigator.svelte';
	import ApiOverview from '$lib/openapi/components/ApiOverview.svelte';
	import ApiSectionView from '$lib/openapi/components/ApiSectionView.svelte';
	import {
		fetchOpenApiManifest,
		loadOpenApiSpec,
		defaultOpenApiRelease,
		resolveOpenApiRelease,
		type OpenApiManifestEntry,
		type OpenApiReleasesConfig
	} from '$lib/openapi';
	import {
		buildApiSections,
		findAction,
		type ApiAction,
		type ApiIndex,
		type ApiSection
	} from '$lib/openapi/apiReference';
	import { buildPathBrowserData } from '$lib/openapi/pathBrowser';
	import { sanitizeSpecForDisplay } from '$lib/openapi/sanitizeSpecForDisplay';
	import { setHeaderReleases, type HeaderReleaseOptions } from '$lib/headerReleases';
	import { buildCatalogCrdPath } from '$lib/urlState';
	import { theme } from '$lib/theme';
	import { loadStaticYaml } from '$lib/yaml/safeYaml';
	import openapiReleasesYaml from '$lib/openapi-releases.yaml?raw';
	import crdReleasesYaml from '$lib/releases.yaml?raw';
	import type { ReleasesConfig } from '$lib/structure';

	const releases = (loadStaticYaml(openapiReleasesYaml) as OpenApiReleasesConfig).releases ?? [];
	const crdReleaseNames = new Set(
		((loadStaticYaml(crdReleasesYaml) as ReleasesConfig).releases ?? []).map((r) => r.name)
	);
	const darkMode = $derived($theme === 'dark');

	// URL state: ?release=&spec=<api id>&section=<resource plural | platform tag>#<operationId>
	const releaseName = $derived.by(() => {
		const fromUrl = browser ? $page.url.searchParams.get('release') : null;
		return fromUrl && releases.some((r) => r.name === fromUrl)
			? fromUrl
			: (defaultOpenApiRelease(releases)?.name ?? '');
	});
	const release = $derived(resolveOpenApiRelease(releases, releaseName));
	const apiId = $derived(browser ? ($page.url.searchParams.get('spec') ?? '') : '');
	const sectionParam = $derived(browser ? ($page.url.searchParams.get('section') ?? '') : '');
	let hash = $state('');

	$effect(() => {
		if (!browser) return;
		const read = () => (hash = decodeURIComponent(window.location.hash.slice(1)));
		read();
		window.addEventListener('hashchange', read);
		return () => window.removeEventListener('hashchange', read);
	});
	// SvelteKit navigations don't fire hashchange.
	$effect(() => {
		$page.url;
		if (browser) hash = decodeURIComponent(window.location.hash.slice(1));
	});

	function href(id: string, section?: string): string {
		const params = new URLSearchParams();
		if (releaseName) params.set('release', releaseName);
		params.set('spec', id);
		if (section) params.set('section', section);
		return `/openapi?${params.toString()}`;
	}
	const overviewHref = $derived(`/openapi?release=${encodeURIComponent(releaseName)}`);

	// The header's release switcher lists the OpenAPI releases and keeps the API and section.
	const headerReleases = writable<HeaderReleaseOptions | null>(null);
	setHeaderReleases(headerReleases);
	$effect(() => {
		const id = apiId;
		const sectionKey = sectionParam;
		headerReleases.set({
			releases,
			current: releaseName,
			href: (name) => {
				const params = new URLSearchParams({ release: name });
				if (id) params.set('spec', id);
				if (sectionKey) params.set('section', sectionKey);
				return `/openapi?${params.toString()}`;
			}
		});
	});

	// Release data: the API index (overview, navigator, search) and the spec manifest (spec files).
	let index = $state<ApiIndex | null>(null);
	let manifest = $state<OpenApiManifestEntry[]>([]);
	let loadError = $state('');
	let indexGen = 0;

	async function loadRelease(folder: string) {
		const gen = ++indexGen;
		loadError = '';
		index = null;
		manifest = [];
		try {
			const [idx, man] = await Promise.all([
				fetch(`/${folder}/api-index.json`).then((r) =>
					r.ok ? (r.json() as Promise<ApiIndex>) : null
				),
				fetchOpenApiManifest(folder)
			]);
			if (gen !== indexGen) return;
			if (!idx || !man) {
				loadError = `The API list for EDA ${releaseName} didn't load.`;
				return;
			}
			index = idx;
			manifest = man;
		} catch {
			if (gen === indexGen) loadError = `The API list for EDA ${releaseName} didn't load.`;
		}
	}

	$effect(() => {
		if (browser && release) void loadRelease(release.folder);
	});

	// The selected API's spec, as resources and actions.
	let sections = $state<ApiSection[]>([]);
	let spec = $state<Record<string, unknown> | null>(null);
	let specLoading = $state(false);
	let specError = $state('');
	let specGen = 0;

	const apiEntry = $derived(index?.apis.find((a) => a.id === apiId) ?? null);

	async function loadApi(id: string) {
		const gen = ++specGen;
		const entry = manifest.find((e) => e.id === id);
		const api = index?.apis.find((a) => a.id === id);
		sections = [];
		spec = null;
		specError = '';
		if (!entry || !api || !release) {
			specError = `There is no "${id}" API in EDA ${releaseName}.`;
			return;
		}
		specLoading = true;
		try {
			const doc = await loadOpenApiSpec(release.folder, entry.file);
			if (gen !== specGen) return;
			if (!doc) {
				specError = `The ${api.title} specification didn't load.`;
				return;
			}
			const clean = sanitizeSpecForDisplay(doc);
			const titles = new Map(api.sections.map((s) => [s.key, s.title]));
			spec = clean;
			sections = buildApiSections(
				buildPathBrowserData(clean).tagGroups.flatMap((g) => g.operations),
				{ kindFor: (plural) => titles.get(plural) }
			);
		} catch {
			if (gen === specGen) specError = `The ${api.title} specification didn't load.`;
		} finally {
			if (gen === specGen) specLoading = false;
		}
	}

	$effect(() => {
		if (!browser) return;
		if (apiId && index && manifest.length) void loadApi(apiId);
		else if (!apiId) {
			sections = [];
			spec = null;
			specError = '';
		}
	});

	/** `#operationId` wins (old links), then `section=`, then the API's first section. */
	const deepLink = $derived(hash ? findAction(sections, hash) : null);
	const section = $derived(
		deepLink?.section ??
			sections.find((s) => s.key === sectionParam) ??
			sections.find((s) => s.type !== 'discovery') ??
			null
	);
	const selected = $derived.by((): ApiAction | null => {
		if (!section) return null;
		if (deepLink && deepLink.section === section) return deepLink.action;
		return (
			section.actions.find((a) => a.key === 'create') ??
			section.actions.find((a) => a.key === 'run') ??
			section.actions[0] ??
			null
		);
	});

	function selectAction(action: ApiAction) {
		const id = action.operation.operationId || action.operation.id;
		const params = new URLSearchParams($page.url.searchParams);
		if (section) params.set('section', section.key);
		params.delete('tab');
		void goto(`/openapi?${params.toString()}#${encodeURIComponent(id)}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
		hash = id;
	}

	const crdHref = $derived(
		section?.type === 'resource' && crdReleaseNames.has(releaseName)
			? buildCatalogCrdPath({ release: releaseName, kind: section.title })
			: undefined
	);
	const validateHref = $derived(
		section?.type === 'resource' && crdReleaseNames.has(releaseName)
			? `/validate-yaml?release=${encodeURIComponent(releaseName)}`
			: undefined
	);

	let navOpen = $state(false);

	/** `/` focuses the API search (capture phase, ahead of the header's Jump to a CRD). */
	function windowKeydown(event: KeyboardEvent) {
		if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
		event.preventDefault();
		navOpen = true;
		queueMicrotask(() => document.getElementById('api-search')?.focus());
	}

	const pageTitle = $derived(
		section && apiEntry
			? `${section.title} · ${apiEntry.title} API`
			: apiEntry
				? `${apiEntry.title} API`
				: 'API reference'
	);
</script>

<svelte:window onkeydowncapture={windowKeydown} />

<svelte:head>
	<title>{pageTitle} | EDA Resource Browser</title>
	<meta
		name="description"
		content="Nokia EDA REST API reference by release: every resource and workflow, what you can do with it, and a ready-to-run request."
	/>
</svelte:head>

<div class="ref oa-root page-shell min-h-full">
	<AppHeader fixed={false} />

	<div class="ref-body">
		<button
			type="button"
			class="nav-toggle"
			aria-expanded={navOpen}
			aria-controls="api-nav"
			onclick={() => (navOpen = !navOpen)}
		>
			{navOpen ? 'Hide API list' : 'Browse APIs and resources'}
		</button>

		<aside id="api-nav" class="ref-nav" class:is-open={navOpen} aria-label="API list">
			{#if index}
				<ApiNavigator
					{index}
					{apiId}
					sectionKey={section?.key ?? ''}
					{href}
					{overviewHref}
					onNavigate={() => (navOpen = false)}
				/>
			{:else if !loadError}
				<div class="skeleton" aria-busy="true" aria-label="Loading APIs">
					{#each Array(10) as _, i (i)}<span></span>{/each}
				</div>
			{/if}
		</aside>

		<main class="ref-main">
			{#if releases.length === 0}
				<div class="state">
					<p class="state-title">No API releases available</p>
					<p>Sync specs with <code>./static/sync-openapi.sh &lt;release&gt;</code>.</p>
				</div>
			{:else if loadError}
				<div class="state state--error" role="alert">
					<p class="state-title">{loadError}</p>
					<button type="button" class="btn" onclick={() => release && loadRelease(release.folder)}
						>Retry</button
					>
				</div>
			{:else if !index}
				<div
					class="skeleton skeleton--main"
					aria-busy="true"
					aria-label="Loading the API reference"
				>
					{#each Array(8) as _, i (i)}<span></span>{/each}
				</div>
			{:else if !apiId}
				<ApiOverview {index} {href} />
			{:else if specError}
				<div class="state state--error" role="alert">
					<p class="state-title">{specError}</p>
					<a class="btn" href={overviewHref}>Back to the API overview</a>
				</div>
			{:else if specLoading || !spec || !section}
				<div class="skeleton skeleton--main" aria-busy="true" aria-label="Loading the API">
					{#each Array(8) as _, i (i)}<span></span>{/each}
				</div>
			{:else}
				<ApiSectionView
					{section}
					apiTitle={apiEntry?.title ?? apiId}
					{spec}
					{selected}
					onSelect={selectAction}
					{darkMode}
					{crdHref}
					{validateHref}
				/>
			{/if}
		</main>
	</div>

	<PageCredits />
</div>

<style>
	.ref {
		background: var(--rb-bg);
		color: var(--rb-ink);
	}

	.ref-body {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0 2rem;
		max-width: 100rem;
		margin: 0 auto;
		padding: 1.25rem max(1rem, env(safe-area-inset-right, 0px)) 1rem
			max(1rem, env(safe-area-inset-left, 0px));
		align-items: start;
	}

	@media (min-width: 960px) {
		.ref-body {
			grid-template-columns: 17rem minmax(0, 1fr);
			padding-left: 2rem;
			padding-right: 2rem;
		}
	}

	.nav-toggle {
		justify-self: start;
		min-height: 2.75rem;
		margin-bottom: 1rem;
		padding: 0 0.875rem;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.5rem;
		background: var(--rb-surface);
		color: var(--rb-ink);
		font: 600 0.875rem var(--rb-font);
		cursor: pointer;
	}

	.ref-nav {
		display: none;
		margin-bottom: 1.25rem;
	}

	.ref-nav.is-open {
		display: block;
	}

	@media (min-width: 960px) {
		.nav-toggle {
			display: none;
		}

		.ref-nav {
			display: block;
			position: sticky;
			top: 4.75rem;
			max-height: calc(100vh - 5.5rem);
			overflow: auto;
			margin-bottom: 0;
			padding-right: 0.25rem;
		}
	}

	.ref-main {
		min-width: 0;
	}

	.state {
		display: grid;
		justify-items: start;
		gap: 0.5rem;
		padding: 2rem 0;
		color: var(--rb-ink-3);
	}

	.state p {
		margin: 0;
	}

	.state-title {
		font-weight: 600;
		font-size: 1rem;
		color: var(--rb-ink);
	}

	.state--error .state-title {
		color: var(--rb-removed);
	}

	.state code {
		font: 0.82em var(--rb-font-mono);
	}

	.btn {
		display: inline-flex;
		align-items: center;
		height: 2.25rem;
		padding: 0 0.875rem;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.5rem;
		background: var(--rb-surface);
		color: var(--rb-ink);
		font: 600 0.85rem var(--rb-font);
		text-decoration: none;
		cursor: pointer;
	}

	.btn:focus-visible,
	.nav-toggle:focus-visible {
		outline: 2px solid var(--rb-signal);
		outline-offset: 1px;
	}

	.skeleton {
		display: grid;
		gap: 0.5rem;
	}

	.skeleton span {
		height: 2rem;
		border-radius: 0.375rem;
		background: var(--rb-raised);
	}

	.skeleton--main span {
		height: 3rem;
		border-radius: 0.625rem;
	}
</style>
