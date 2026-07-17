<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import HeaderReleaseSelect from '$lib/components/HeaderReleaseSelect.svelte';
	import PageCredits from '$lib/components/PageCredits.svelte';
	import OpenApiAppsDropdown from '$lib/openapi/components/OpenApiAppsDropdown.svelte';
	import OpenApiBrowserHeader from '$lib/openapi/components/OpenApiBrowserHeader.svelte';
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
	import { loadStaticYaml } from '$lib/yaml/safeYaml';
	import openapiReleasesYaml from '$lib/openapi-releases.yaml?raw';

	const releasesConfig = loadStaticYaml(openapiReleasesYaml) as OpenApiReleasesConfig;
	const releases = releasesConfig.releases ?? [];
	const initialRelease = defaultOpenApiRelease(releases);

	let releaseName = $state(initialRelease?.name ?? '');
	let selectedSpecId = $state('');
	const release = $derived(resolveOpenApiRelease(releases, releaseName, initialRelease ?? undefined));
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
				const preferred =
					selectedSpecId || $page.url.searchParams.get('spec') || '';
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

	function onReleaseChange(name: string) {
		releaseName = name;
		// Keep selectedSpecId as a preference; loadManifest keeps it when present in
		// the new release, otherwise falls back to core / first manifest entry.
		viewerTab = 'paths';
		highlightSchema = '';
		focusOperationId = '';
		updateUrl();
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
	<title>EDA Resource Browser | API Explorer</title>
	<meta
		name="description"
		content="Browse EDA API Server snapshots — core REST, Query & EQL, and application APIs by release."
	/>
</svelte:head>

<div class="oa-page oa-root page-shell min-h-full">
	<AppHeader fixed={false}>
		<svelte:fragment slot="actions">
			{#if releases.length > 0}
				<HeaderReleaseSelect
					id="openapi-release"
					value={releaseName}
					releases={releases}
					onChange={onReleaseChange}
					ariaLabel="Select API Server release"
				/>
			{/if}
		</svelte:fragment>
	</AppHeader>

	<div class="oa-page__main spec-search-main">
		<OpenApiBrowserHeader />

		{#if releases.length === 0}
			<div class="oa-page__alert oa-page__alert--warn" role="status">
				<p>
					No API releases available. Sync specs with
					<code>./static/sync-openapi.sh &lt;release&gt;</code>.
				</p>
			</div>
		{:else}
			<section class="oa-workspace">
				<header class="oa-workspace__header">
					<div>
						<h2 class="oa-workspace__title">Browse specs</h2>
						<p class="oa-workspace__subtitle">
							Choose an app, then browse paths and the schema graph.
						</p>
					</div>
				</header>

				{#if manifestError}
					<p class="oa-workspace__error" role="alert">{manifestError}</p>
				{/if}

				<div class="oa-workspace__body">
					{#if !selectedSpecId && (!manifestSettled || manifestLoading)}
						<div class="oa-workspace__empty">
							<p>Loading APIs…</p>
						</div>
					{:else if !selectedSpecId}
						<div class="oa-workspace__empty">
							<div class="oa-workspace__empty-apps">
								<OpenApiAppsDropdown
									{manifest}
									{selectedSpecId}
									{darkMode}
									loading={manifestLoading}
									onSpecChange={onSpecChange}
								/>
							</div>
							{#if manifest.length === 0}
								<p>
									No APIs available for this release. Sync specs with
									<code>./static/sync-openapi.sh {releaseName}</code>.
								</p>
							{:else}
								<p>Select an API from Apps and Resources to view the API reference.</p>
							{/if}
						</div>
					{:else if specLoading}
						<div class="oa-workspace__empty">
							<p>Loading specification…</p>
						</div>
					{:else if specError}
						<div class="oa-workspace__empty">
							<p class="oa-workspace__error" role="alert">{specError}</p>
						</div>
					{:else if spec && selectedEntry}
						<header class="oa-viewer-header">
							<div class="oa-viewer-header__title-wrap">
								<div class="oa-viewer-header__title-row">
									<h2 class="oa-viewer-header__title">{selectedEntry.title}</h2>
									{#if specVersionBadge}
										<span class="oa-viewer-badge">{specVersionBadge}</span>
									{/if}
									{#if openApiVersionBadge}
										<span class="oa-viewer-badge oa-viewer-badge--oas">{openApiVersionBadge}</span>
									{/if}
								</div>
								<p class="oa-viewer-header__meta">
									<span class="font-mono">{selectedEntry.group}</span>
									<span aria-hidden="true">·</span>
									<span class="font-mono">{selectedEntry.apiVersion}</span>
									<span aria-hidden="true">·</span>
									<span>{selectedEntry.pathCount} paths</span>
								</p>
								{#if specInfoDescription}
									<p class="oa-viewer-header__description">{specInfoDescription}</p>
								{/if}
							</div>
						</header>
						<div class="oa-viewer-body">
							<OpenApiSpecPanel
								{spec}
								specId={selectedSpecId}
								{darkMode}
								bind:activeTab={viewerTab}
								onTabChange={onViewerTabChange}
								{highlightSchema}
								{focusOperationId}
								onSchemaGraphNavigate={onSchemaGraphNavigate}
								onShowInSchemaGraph={onShowInSchemaGraph}
								onOperationNavigate={onOperationNavigate}
								resourcesReleaseFolder={release ? `resources/${release.name}` : ''}
								apiGraphUrl={apiGraphUrl}
							>
								{#snippet appsCatalog()}
									<OpenApiAppsDropdown
										{manifest}
										{selectedSpecId}
										{darkMode}
										loading={manifestLoading}
										onSpecChange={onSpecChange}
									/>
								{/snippet}
							</OpenApiSpecPanel>
						</div>
					{:else}
						<div class="oa-workspace__empty">
							<p>Preparing API reference…</p>
						</div>
					{/if}
				</div>
			</section>
		{/if}
	</div>

	<PageCredits />
</div>

<style>
	.oa-page {
		background: var(--oa-bg);
		color: var(--oa-text);
	}

	.oa-page__main {
		padding-bottom: 2rem;
	}

	.oa-page__alert {
		margin-top: 1.5rem;
		border-radius: var(--oa-radius-xl);
		border: 1px solid #fcd34d;
		background: #fffbeb;
		padding: 1.25rem 1.5rem;
		font-size: 0.875rem;
		color: #92400e;
	}

	:global(.dark) .oa-page__alert {
		border-color: rgba(180, 83, 9, 0.45);
		background: rgba(69, 26, 3, 0.35);
		color: #fde68a;
	}

	.oa-page__alert code {
		border-radius: 0.25rem;
		background: rgba(255, 255, 255, 0.7);
		padding: 0.1rem 0.35rem;
		font-family: var(--oa-font-code);
		font-size: 0.8em;
	}

	.oa-workspace {
		margin-top: 1.5rem;
		border: 1px solid var(--oa-panel-border);
		border-radius: var(--oa-radius-xl);
		background: var(--oa-panel);
		box-shadow: var(--oa-panel-shadow);
		overflow: hidden;
	}

	.oa-workspace__header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.85rem 1.15rem;
		border-bottom: 1px solid var(--oa-panel-border);
		background: linear-gradient(180deg, var(--oa-canvas-top), var(--oa-panel));
	}

	.oa-workspace__title {
		margin: 0;
		font-family: var(--oa-font-headline);
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--oa-text);
	}

	.oa-workspace__subtitle {
		margin: 0.25rem 0 0;
		font-size: 0.8125rem;
		color: var(--oa-text-muted);
		max-width: 36rem;
	}

	.oa-workspace__error {
		margin: 0.75rem 1.15rem 0;
		font-size: 0.875rem;
		color: #dc2626;
	}

	:global(.dark) .oa-workspace__error {
		color: #f87171;
	}

	.oa-workspace__body {
		min-height: min(72vh, 920px);
	}

	.oa-workspace__empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.875rem;
		padding: 3rem 1.25rem;
		text-align: center;
		font-size: 0.875rem;
		color: var(--oa-text-muted);
	}

	.oa-workspace__empty-apps {
		width: min(100%, 18rem);
	}

	.oa-viewer-header {
		padding: 0.9rem 1.15rem;
		border-bottom: 1px solid var(--oa-panel-border);
		background: linear-gradient(180deg, var(--oa-canvas-top), var(--oa-panel));
	}

	.oa-viewer-header__title-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.oa-viewer-header__title {
		margin: 0;
		font-family: var(--oa-font-headline);
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--oa-text);
	}

	.oa-viewer-badge {
		border-radius: 9999px;
		padding: 0.15rem 0.55rem;
		font-family: var(--oa-font-code);
		font-size: 0.6875rem;
		font-weight: 700;
		border: 1px solid var(--oa-panel-border);
		background: color-mix(in srgb, var(--oa-chip-inactive) 70%, transparent);
		color: var(--oa-text-muted);
	}

	.oa-viewer-badge--oas {
		border-color: color-mix(in srgb, var(--oa-method-post) 45%, transparent);
		background: color-mix(in srgb, var(--oa-method-post) 14%, transparent);
		color: var(--oa-method-post);
	}

	.oa-viewer-header__meta {
		margin: 0.3rem 0 0;
		font-size: 0.75rem;
		color: var(--oa-text-muted);
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.oa-viewer-header__description {
		margin: 0.45rem 0 0;
		max-width: 52rem;
		font-size: 0.8125rem;
		line-height: 1.45;
		color: var(--oa-text-muted);
	}

	.oa-viewer-body {
		padding: 0.85rem 1.15rem 1.15rem;
	}
</style>
