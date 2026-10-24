<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import PageCredits from '$lib/components/PageCredits.svelte';
	import OpenApiAppsDropdown from '$lib/openapi/components/OpenApiAppsDropdown.svelte';
	import OpenApiSpecPanel from '$lib/openapi/components/OpenApiSpecPanel.svelte';
	import {
		fetchOpenApiManifest,
		loadOpenApiSpec,
		defaultOpenApiRelease,
		resolveOpenApiRelease,
		resolveOpenApiSpecId,
		type OpenApiManifestEntry,
		type OpenApiRelease,
		type OpenApiReleasesConfig
	} from '$lib/openapi';
	import type { OpenApiDocView } from '$lib/openapi/swaggerUiConfig';
	import { getOperationDeepLinkId, type OpenApiOperation } from '$lib/openapi/pathBrowser';
	import { theme } from '$lib/theme';
	import { setHeaderReleases, type HeaderReleaseOptions } from '$lib/headerReleases';
	import { writable } from 'svelte/store';
	import { loadStaticYaml } from '$lib/yaml/safeYaml';
	import openapiReleasesYaml from '$lib/openapi-releases.yaml?raw';

	const releasesConfig = loadStaticYaml(openapiReleasesYaml) as OpenApiReleasesConfig;
	const releases = releasesConfig.releases ?? [];
	const initialRelease = defaultOpenApiRelease(releases);

	let releaseName = $state(initialRelease?.name ?? '');
	let selectedSpecId = $state('');
	const release = $derived(
		resolveOpenApiRelease(releases, releaseName, initialRelease ?? undefined)
	);
	let manifest = $state<OpenApiManifestEntry[]>([]);
	let spec = $state<Record<string, unknown> | null>(null);

	let manifestLoading = $state(false);
	/** False until the first manifest fetch for the current session settles. */
	let manifestSettled = $state(false);
	let specLoading = $state(false);
	let manifestError = $state('');
	let specError = $state('');
	let manifestLoadGen = 0;
	let specLoadGen = 0;

	let viewerTab = $state<OpenApiDocView>('paths');
	let highlightSchema = $state('');
	let focusOperationId = $state('');

	const darkMode = $derived($theme === 'dark');

	/** The header's release switcher lists the OpenAPI releases on this page. */
	const headerReleases = writable<HeaderReleaseOptions | null>(null);
	setHeaderReleases(headerReleases);
	$effect(() => {
		const spec = selectedSpecId;
		headerReleases.set({
			releases,
			current: releaseName,
			href: (name) =>
				`/openapi?release=${encodeURIComponent(name)}${spec ? `&spec=${encodeURIComponent(spec)}` : ''}`
		});
	});

	function fixMalformedQueryUrl(): void {
		const sp = $page.url.searchParams;
		if (sp.get('release')) return;
		const keys = [...sp.keys()];
		if (keys.length !== 1 || !keys[0].includes('=')) return;
		const embedded = new URLSearchParams(keys[0]);
		if (!embedded.get('release')) return;
		const qs = embedded.toString();
		const targetUrl = `/openapi?${qs}`;
		const currentUrl = `${$page.url.pathname}${$page.url.search}`;
		if (targetUrl === currentUrl) return;
		goto(targetUrl, { replaceState: true });
	}

	$effect(() => {
		if (!browser) return;
		fixMalformedQueryUrl();
	});

	$effect(() => {
		if (!browser) return;
		const fromUrl = $page.url.searchParams.get('release');
		const specFromUrl = $page.url.searchParams.get('spec') ?? '';
		const tabFromUrl = $page.url.searchParams.get('tab');
		const schemaFromUrl = $page.url.searchParams.get('schema') ?? '';
		const opFromUrl = $page.url.searchParams.get('op') ?? '';
		const defaultRelease = defaultOpenApiRelease(releases);
		const nextRelease =
			fromUrl && releases.some((r) => r.name === fromUrl) ? fromUrl : (defaultRelease?.name ?? '');
		// Guarded writes — unguarded assigns re-triggered effects and fought updateUrl/goto.
		if (releaseName !== nextRelease) releaseName = nextRelease;
		// Prefer URL spec when present; otherwise keep current selection so release
		// changes can resolve against the new manifest without forcing an empty Apps pick.
		if (specFromUrl && selectedSpecId !== specFromUrl) {
			selectedSpecId = specFromUrl;
		}
		// Legacy `tab=schemas` → Schema Graph (with schema highlight) or Paths.
		let nextTab: OpenApiDocView = 'paths';
		if (tabFromUrl === 'schemas') {
			nextTab = schemaFromUrl || opFromUrl ? 'schemaGraph' : 'paths';
		} else if (tabFromUrl === 'schemaGraph') {
			nextTab = 'schemaGraph';
		}
		if (viewerTab !== nextTab) viewerTab = nextTab;
		// Operation focus (API map) wins over schema highlight (schema-deps).
		const nextFocus = opFromUrl;
		const nextHighlight = opFromUrl ? '' : schemaFromUrl;
		if (focusOperationId !== nextFocus) focusOperationId = nextFocus;
		if (highlightSchema !== nextHighlight) highlightSchema = nextHighlight;
	});

	$effect(() => {
		if (!browser || !release) return;
		void loadManifest(release);
	});

	$effect(() => {
		if (!browser || !release || !selectedSpecId) {
			spec = null;
			specError = '';
			specLoading = false;
			return;
		}

		const gen = ++specLoadGen;

		// Only wait while the manifest fetch is in flight. An empty manifest after load
		// used to leave specLoading=true forever ("Loading specification…") while the
		// process was still up — UI looked hung.
		if (manifestLoading) {
			specLoading = true;
			specError = '';
			spec = null;
			return;
		}

		if (manifest.length === 0) {
			spec = null;
			specError =
				manifestError ||
				`No APIs available for this release. Run ./static/sync-openapi.sh ${release.name} first.`;
			specLoading = false;
			return;
		}

		const entry = manifest.find((e) => e.id === selectedSpecId);
		if (!entry) {
			spec = null;
			specError = `API "${selectedSpecId}" not found in this release.`;
			specLoading = false;
			return;
		}

		specLoading = true;
		specError = '';
		spec = null;

		void (async () => {
			try {
				const doc = await loadOpenApiSpec(release.folder, entry.file);
				if (gen !== specLoadGen) return;
				if (!doc) {
					specError = `Failed to load spec file for ${entry.title}.`;
				} else {
					spec = doc;
				}
			} catch (err) {
				if (gen !== specLoadGen) return;
				specError =
					err instanceof Error ? err.message : `Failed to load spec file for ${entry.title}.`;
			} finally {
				if (gen === specLoadGen) specLoading = false;
			}
		})();
	});

	async function loadManifest(rel: OpenApiRelease) {
		const gen = ++manifestLoadGen;
		manifestLoading = true;
		manifestError = '';
		manifest = [];
		try {
			const data = await fetchOpenApiManifest(rel.folder);
			if (gen !== manifestLoadGen) return;
			if (!data) {
				manifestError = `Could not load API manifest for ${rel.label}. Run ./static/sync-openapi.sh ${rel.name} first.`;
				selectedSpecId = '';
			} else {
				manifest = data;
				const preferred = selectedSpecId || $page.url.searchParams.get('spec') || '';
				const resolved = resolveOpenApiSpecId(data, preferred);
				if (selectedSpecId !== resolved) selectedSpecId = resolved;
				updateUrl();
			}
		} finally {
			if (gen === manifestLoadGen) {
				manifestLoading = false;
				manifestSettled = true;
			}
		}
	}

	function updateUrl() {
		if (!browser) return;
		const params = new URLSearchParams();
		if (releaseName) params.set('release', releaseName);
		if (selectedSpecId) params.set('spec', selectedSpecId);
		if (viewerTab === 'schemaGraph') params.set('tab', 'schemaGraph');
		if (viewerTab === 'schemaGraph' && focusOperationId) {
			params.set('op', focusOperationId);
		} else if (highlightSchema && viewerTab === 'schemaGraph') {
			params.set('schema', highlightSchema);
		}
		const qs = params.toString();
		const targetUrl = qs ? `/openapi?${qs}` : '/openapi';
		const currentUrl = `${$page.url.pathname}${$page.url.search}`;
		if (targetUrl === currentUrl) return;
		goto(targetUrl, { replaceState: true, keepFocus: true });
	}

	function onViewerTabChange(tab: OpenApiDocView) {
		viewerTab = tab;
		if (tab === 'paths') {
			highlightSchema = '';
			focusOperationId = '';
		}
		updateUrl();
	}

	function onSchemaGraphNavigate(schemaName: string) {
		highlightSchema = schemaName;
		focusOperationId = '';
		viewerTab = 'schemaGraph';
		updateUrl();
	}

	function onShowInSchemaGraph(operation: OpenApiOperation) {
		focusOperationId = getOperationDeepLinkId(operation);
		highlightSchema = '';
		viewerTab = 'schemaGraph';
		updateUrl();
	}

	function onOperationNavigate(operationId: string) {
		viewerTab = 'paths';
		highlightSchema = '';
		focusOperationId = '';
		updateUrl();
		if (browser && operationId) {
			const base = `${window.location.pathname}${window.location.search}`;
			window.location.hash = operationId;
			history.replaceState(history.state, '', `${base}#${operationId}`);
		}
	}

	function retry() {
		if (release) void loadManifest(release);
	}

	function onSpecChange(specId: string) {
		selectedSpecId = specId;
		updateUrl();
	}

	const selectedEntry = $derived(manifest.find((e) => e.id === selectedSpecId) ?? null);

	const apiGraphUrl = $derived.by(() => {
		if (!release || !selectedEntry) return '';
		const specDir = selectedEntry.file.split('/').slice(0, -1).join('/');
		return `/${release.folder}/${specDir}/api-graph.json`;
	});

	const openApiVersionBadge = $derived.by(() => {
		if (!spec) return '';
		const v = typeof spec.openapi === 'string' ? spec.openapi : '';
		if (!v) return '';
		return `OAS ${v.split('.').slice(0, 2).join('.')}`;
	});

	const specVersionBadge = $derived.by(() => {
		if (!spec) return '';
		const info = spec.info;
		if (!info || typeof info !== 'object' || Array.isArray(info)) return '';
		const version = (info as Record<string, unknown>).version;
		return typeof version === 'string' ? version : '';
	});

	const specInfoDescription = $derived.by(() => {
		if (!spec) return '';
		const info = spec.info;
		if (!info || typeof info !== 'object' || Array.isArray(info)) return '';
		const description = (info as Record<string, unknown>).description;
		return typeof description === 'string' ? description.trim() : '';
	});
</script>

<svelte:head>
	<title
		>{selectedEntry ? `${selectedEntry.title} · ` : ''}API Explorer | EDA Resource Browser</title
	>
	<meta
		name="description"
		content="Browse EDA API Server snapshots — core REST, Query & EQL, and application APIs by release."
	/>
</svelte:head>

{#snippet appsCatalog()}
	<OpenApiAppsDropdown
		{manifest}
		{selectedSpecId}
		{darkMode}
		loading={manifestLoading}
		{onSpecChange}
	/>
{/snippet}

<div class="oa-page oa-root page-shell min-h-full">
	<AppHeader fixed={false} />

	<main class="oa-main">
		{#if releases.length === 0}
			<div class="oa-state" role="status">
				<p class="oa-state__title">No API releases available</p>
				<p>Sync specs with <code>./static/sync-openapi.sh &lt;release&gt;</code>.</p>
			</div>
		{:else}
			<header class="oa-head">
				<div class="oa-head__text">
					<p class="oa-head__crumb">API <span aria-hidden="true">›</span> <b>Explorer</b></p>
					<h1 class="oa-head__title">{selectedEntry?.title ?? 'API Explorer'}</h1>
					{#if selectedEntry}
						<div class="oa-head__chips">
							<span class="oa-chip">{selectedEntry.id}</span>
							{#if specVersionBadge}<span class="oa-chip">{specVersionBadge}</span>{/if}
							{#if openApiVersionBadge}<span class="oa-chip">{openApiVersionBadge}</span>{/if}
							<span class="oa-chip">{selectedEntry.pathCount} paths</span>
							<span class="oa-chip">EDA {releaseName}</span>
						</div>
					{/if}
					{#if specInfoDescription}
						<p class="oa-head__desc" title={specInfoDescription}>{specInfoDescription}</p>
					{/if}
				</div>
				{#if spec && selectedEntry}
					<div class="oa-seg" role="tablist" aria-label="Reference view">
						<button
							type="button"
							role="tab"
							aria-selected={viewerTab === 'paths'}
							onclick={() => viewerTab !== 'paths' && onViewerTabChange('paths')}>Paths</button
						>
						<button
							type="button"
							role="tab"
							aria-selected={viewerTab === 'schemaGraph'}
							onclick={() => viewerTab !== 'schemaGraph' && onViewerTabChange('schemaGraph')}
							>Schema graph</button
						>
					</div>
				{/if}
			</header>

			{#if manifestError}
				<div class="oa-state oa-state--error" role="alert">
					<p class="oa-state__title">The API list didn't load</p>
					<p>{manifestError}</p>
					<button type="button" class="oa-btn" onclick={retry}>Retry</button>
				</div>
			{:else if !selectedSpecId && (!manifestSettled || manifestLoading)}
				<div class="oa-skeleton" aria-busy="true" aria-label="Loading APIs">
					{#each Array(8) as _, i (i)}<span></span>{/each}
				</div>
			{:else if !selectedSpecId}
				<div class="oa-state">
					{#if manifest.length === 0}
						<p class="oa-state__title">No APIs in EDA {releaseName}</p>
						<p>Sync specs with <code>./static/sync-openapi.sh {releaseName}</code>.</p>
					{:else}
						<p class="oa-state__title">Pick an API to browse</p>
						<div class="oa-state__apps">{@render appsCatalog()}</div>
					{/if}
				</div>
			{:else if specLoading}
				<div class="oa-skeleton" aria-busy="true" aria-label="Loading the API specification">
					{#each Array(8) as _, i (i)}<span></span>{/each}
				</div>
			{:else if specError}
				<div class="oa-state oa-state--error" role="alert">
					<p class="oa-state__title">This API didn't load</p>
					<p>{specError}</p>
					<button type="button" class="oa-btn" onclick={retry}>Retry</button>
				</div>
			{:else if spec && selectedEntry}
				<OpenApiSpecPanel
					{spec}
					specId={selectedSpecId}
					{darkMode}
					bind:activeTab={viewerTab}
					onTabChange={onViewerTabChange}
					showTabs={false}
					{highlightSchema}
					{focusOperationId}
					{onSchemaGraphNavigate}
					{onShowInSchemaGraph}
					{onOperationNavigate}
					resourcesReleaseFolder={release ? `resources/${release.name}` : ''}
					{apiGraphUrl}
					{appsCatalog}
				/>
			{/if}
		{/if}
	</main>

	<PageCredits />
</div>

<style>
	.oa-page {
		background: var(--rb-bg);
		color: var(--rb-ink);
	}

	.oa-main {
		max-width: 96rem;
		margin: 0 auto;
		padding: 0 max(1rem, env(safe-area-inset-right, 0px)) 1rem
			max(1rem, env(safe-area-inset-left, 0px));
	}

	@media (min-width: 1024px) {
		.oa-main {
			padding-left: 2rem;
			padding-right: 2rem;
		}
	}

	.oa-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.75rem 1.5rem;
		padding: 1.25rem 0 1rem;
		margin-bottom: 1rem;
		border-bottom: 1px solid var(--rb-line);
	}

	.oa-head__text {
		min-width: 0;
		flex: 1 1 32rem;
	}

	.oa-head__crumb {
		margin: 0;
		font: 500 0.75rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	.oa-head__crumb b {
		font-weight: 500;
		color: var(--rb-ink-2);
	}

	.oa-head__title {
		margin: 0.25rem 0 0.5rem;
		font-family: var(--rb-font-display);
		font-size: clamp(1.3rem, 2.4vw, 1.6rem);
		font-weight: 700;
		letter-spacing: -0.015em;
		color: var(--rb-ink);
		text-wrap: balance;
	}

	.oa-head__chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.oa-chip {
		padding: 0.1875rem 0.5rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.3125rem;
		background: var(--rb-raised);
		color: var(--rb-ink-2);
		font: 500 0.72rem var(--rb-font-mono);
	}

	.oa-head__desc {
		margin: 0.5rem 0 0;
		max-width: 80ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.86rem;
		color: var(--rb-ink-3);
	}

	.oa-seg {
		display: inline-flex;
		gap: 0.125rem;
		padding: 0.1875rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.5625rem;
		background: var(--rb-raised);
	}

	.oa-seg button {
		padding: 0.4375rem 0.9375rem;
		border: 0;
		border-radius: 0.375rem;
		background: none;
		color: var(--rb-ink-3);
		font: 600 0.85rem var(--rb-font);
		cursor: pointer;
	}

	.oa-seg button:hover {
		color: var(--rb-ink);
	}

	.oa-seg button[aria-selected='true'] {
		background: var(--rb-surface);
		color: var(--rb-ink);
		box-shadow: 0 1px 2px rgba(10, 20, 40, 0.12);
	}

	.oa-seg button:focus-visible,
	.oa-btn:focus-visible {
		outline: 2px solid var(--rb-signal);
		outline-offset: 1px;
	}

	.oa-state {
		display: grid;
		justify-items: center;
		gap: 0.5rem;
		padding: 3rem 1rem;
		text-align: center;
		font-size: 0.9rem;
		color: var(--rb-ink-3);
	}

	.oa-state p {
		margin: 0;
	}

	.oa-state__title {
		font-weight: 600;
		font-size: 1rem;
		color: var(--rb-ink);
	}

	.oa-state--error .oa-state__title {
		color: var(--rb-removed);
	}

	.oa-state code {
		font: 0.82em var(--rb-font-mono);
		padding: 0.1rem 0.35rem;
		border-radius: 0.25rem;
		background: var(--rb-raised);
	}

	.oa-state__apps {
		width: min(100%, 22rem);
		text-align: left;
	}

	.oa-btn {
		margin-top: 0.25rem;
		height: 2.25rem;
		padding: 0 0.875rem;
		border: 1px solid var(--rb-line-strong);
		border-radius: 0.5rem;
		background: var(--rb-surface);
		color: var(--rb-ink);
		font: 600 0.85rem var(--rb-font);
		cursor: pointer;
	}

	.oa-skeleton {
		display: grid;
		gap: 0.5rem;
		padding: 0.5rem 0 2rem;
	}

	.oa-skeleton span {
		height: 2.75rem;
		border-radius: 0.5rem;
		background: linear-gradient(90deg, var(--rb-raised), var(--rb-surface), var(--rb-raised));
		background-size: 200% 100%;
		animation: oa-shimmer 1.4s ease-in-out infinite;
	}

	@keyframes oa-shimmer {
		from {
			background-position: 100% 0;
		}
		to {
			background-position: -100% 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.oa-skeleton span {
			animation: none;
		}
	}
</style>
