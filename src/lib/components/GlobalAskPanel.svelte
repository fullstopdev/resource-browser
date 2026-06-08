<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { closeGlobalAsk, globalAskContext, globalAskOpen } from '$lib/globalAsk';
	import CrdAskPanel from '$lib/components/CrdAskPanel.svelte';
	import { fetchManifest } from '$lib/manifest';
	import type { ManifestResource } from '$lib/manifest';
	import releasesYaml from '$lib/releases.yaml?raw';
	import type { EdaRelease, ReleasesConfig } from '$lib/structure';
	import { loadStaticYaml } from '$lib/yaml/safeYaml';
	import { getLatestVersion } from '$lib/versions';

	const releasesConfig = loadStaticYaml(releasesYaml) as ReleasesConfig;
	const allReleases = releasesConfig.releases;

	const NON_CRD_PREFIXES = new Set([
		'spec-search',
		'spec-search-auto',
		'validate-yaml',
		'comparison',
		'dependency-map',
		'release-notes',
		'bulk-diff',
		'sitemap'
	]);

	let releaseName = '';
	let selectedResource: ManifestResource | null = null;
	let manifestResources: ManifestResource[] = [];
	let kindQuery = '';
	let kindPickerOpen = false;
	let loadingManifest = false;
	let pageDetected = false;
	let panelKey = 0;

	$: release = allReleases.find((r) => r.name === releaseName) ?? null;

	$: filteredKinds = (() => {
		const q = kindQuery.trim().toLowerCase();
		const list = q
			? manifestResources.filter((r) => {
					const kind = (r.kind || r.name.split('.')[0] || '').toLowerCase();
					const group = (r.group || r.name.split('.').slice(1).join('.') || '').toLowerCase();
					return kind.includes(q) || group.includes(q) || r.name.toLowerCase().includes(q);
				})
			: manifestResources;
		return list.slice(0, 24);
	})();

	function defaultReleaseName(): string {
		const fromUrl = $page.url.searchParams.get('release');
		if (fromUrl && allReleases.some((r) => r.name === fromUrl)) return fromUrl;
		return allReleases.find((r) => r.default)?.name ?? allReleases[0]?.name ?? '';
	}

	function parseCrdPageUrl(pathname: string): { name: string; version: string } | null {
		const match = pathname.match(/^\/([^/]+)\/([^/]+)$/);
		if (!match) return null;
		const [, name, version] = match;
		const prefix = name.split('.')[0];
		if (NON_CRD_PREFIXES.has(prefix) || NON_CRD_PREFIXES.has(name)) return null;
		if (!name.includes('.')) return null;
		return { name, version };
	}

	async function loadManifestForRelease(releaseFolder: string): Promise<ManifestResource[]> {
		loadingManifest = true;
		const manifest = await fetchManifest(releaseFolder);
		manifestResources = manifest ?? [];
		loadingManifest = false;
		return manifestResources;
	}

	function applyResource(entry: ManifestResource | null) {
		selectedResource = entry;
		if (entry) {
			kindQuery = entry.kind || entry.name.split('.')[0] || '';
		}
		kindPickerOpen = false;
		panelKey += 1;
	}

	async function applyContext(ctx: {
		release?: string;
		kind?: string;
		group?: string;
		name?: string;
		version?: string;
	}) {
		pageDetected = false;
		releaseName = ctx.release && allReleases.some((r) => r.name === ctx.release) ? ctx.release : defaultReleaseName();
		const rel = allReleases.find((r) => r.name === releaseName);
		if (!rel) return;

		const manifest = await loadManifestForRelease(rel.folder);

		if (ctx.name) {
			const byName = manifest.find((r) => r.name === ctx.name);
			if (byName) {
				applyResource(byName);
				pageDetected = !!parseCrdPageUrl($page.url.pathname);
				return;
			}
		}

		if (ctx.kind) {
			const byKind = manifest.find(
				(r) =>
					r.kind === ctx.kind &&
					(!ctx.group || r.group === ctx.group || r.name.endsWith('.' + ctx.group))
			);
			if (byKind) {
				applyResource(byKind);
				return;
			}
			selectedResource = {
				name: ctx.name || `${ctx.kind}.${ctx.group || ''}`,
				kind: ctx.kind,
				group: ctx.group
			};
			kindQuery = ctx.kind;
			panelKey += 1;
			return;
		}

		applyResource(null);
	}

	async function detectFromPageUrl() {
		const parsed = parseCrdPageUrl($page.url.pathname);
		if (!parsed) {
			pageDetected = false;
			return;
		}

		const urlRelease = $page.url.searchParams.get('release');
		releaseName =
			urlRelease && allReleases.some((r) => r.name === urlRelease) ? urlRelease : defaultReleaseName();
		const rel = allReleases.find((r) => r.name === releaseName);
		if (!rel) return;

		const manifest = await loadManifestForRelease(rel.folder);
		const entry = manifest.find((r) => r.name === parsed.name);
		if (entry) {
			applyResource(entry);
			pageDetected = true;
		}
	}

	async function initPanel() {
		const ctx = $globalAskContext;
		if (ctx) {
			await applyContext(ctx);
			globalAskContext.set(null);
			return;
		}

		releaseName = defaultReleaseName();
		await detectFromPageUrl();
		if (!selectedResource && releaseName) {
			const rel = allReleases.find((r) => r.name === releaseName);
			if (rel) await loadManifestForRelease(rel.folder);
		}
	}

	$: if ($globalAskOpen) {
		void initPanel();
	}

	async function handleReleaseChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		releaseName = select.value;
		const rel = allReleases.find((r) => r.name === releaseName);
		if (!rel) return;
		await loadManifestForRelease(rel.folder);
		applyResource(null);
		pageDetected = false;
	}

	function selectKind(entry: ManifestResource) {
		applyResource(entry);
		pageDetected = false;
	}

	function clearKind() {
		applyResource(null);
		kindQuery = '';
		pageDetected = false;
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) closeGlobalAsk();
	}

	function handleKindBlur() {
		setTimeout(() => {
			kindPickerOpen = false;
		}, 150);
	}

	onMount(() => {
		if (!browser) return;

		function onKeydown(event: KeyboardEvent) {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
				event.preventDefault();
				if ($globalAskOpen) {
					closeGlobalAsk();
				} else {
					import('$lib/globalAsk').then(({ openGlobalAsk }) => openGlobalAsk());
				}
			}
			if (event.key === 'Escape' && $globalAskOpen) {
				closeGlobalAsk();
			}
		}

		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});

	$: parsedPage = parseCrdPageUrl($page.url.pathname);
	$: panelVersion = parsedPage?.version || getLatestVersion(selectedResource) || '';
</script>

{#if $globalAskOpen}
	<div
		class="global-ask-overlay"
		role="presentation"
		onclick={handleBackdropClick}
	>
		<div
			class="global-ask-panel"
			role="dialog"
			aria-modal="true"
			aria-label="Ask AI"
		>
			<header class="global-ask-panel__header">
				<div class="global-ask-panel__header-main">
					<h2 class="global-ask-panel__title">Ask AI</h2>
					<p class="global-ask-panel__subtitle">
						Grounded answers from CRD schemas, EDA docs, and Vectorize RAG.
					</p>
				</div>
				<button
					type="button"
					class="global-ask-panel__close"
					aria-label="Close Ask AI"
					onclick={closeGlobalAsk}
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</header>

			<div class="global-ask-panel__context">
				<div class="global-ask-panel__context-row">
					<label class="global-ask-panel__label" for="global-ask-release">Release</label>
					<select
						id="global-ask-release"
						class="global-ask-panel__select"
						value={releaseName}
						onchange={handleReleaseChange}
					>
						{#each allReleases as rel (rel.name)}
							<option value={rel.name}>{rel.label}</option>
						{/each}
					</select>
				</div>

				<div class="global-ask-panel__context-row global-ask-panel__kind-row">
					<label class="global-ask-panel__label" for="global-ask-kind">CRD kind</label>
					<div class="global-ask-panel__kind-search">
						<input
							id="global-ask-kind"
							type="search"
							class="global-ask-panel__input"
							placeholder={loadingManifest ? 'Loading catalog…' : 'Search kind or resource…'}
							bind:value={kindQuery}
							onfocus={() => (kindPickerOpen = true)}
							onblur={handleKindBlur}
							disabled={loadingManifest || !release}
							autocomplete="off"
						/>
						{#if selectedResource}
							<button type="button" class="global-ask-panel__clear-kind" onclick={clearKind}>
								Clear
							</button>
						{/if}
						{#if kindPickerOpen && filteredKinds.length > 0}
							<ul class="global-ask-panel__kind-list" role="listbox">
								{#each filteredKinds as entry (entry.name)}
									<li role="presentation">
										<button
											type="button"
											class="global-ask-panel__kind-option"
											role="option"
											aria-selected={selectedResource?.name === entry.name}
											onmousedown={(e) => e.preventDefault()}
											onclick={() => selectKind(entry)}
										>
											<span class="global-ask-panel__kind-name">{entry.kind || entry.name.split('.')[0]}</span>
											<span class="global-ask-panel__kind-group">{entry.group || entry.name.split('.').slice(1).join('.')}</span>
										</button>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				</div>

				{#if pageDetected && selectedResource}
					<p class="global-ask-panel__detected">
						<span class="global-ask-panel__detected-badge">Auto-detected</span>
						from current page
					</p>
				{:else if !selectedResource}
					<p class="global-ask-panel__hint">
						Optional: pick a CRD for targeted answers and KV-cached starter prompts.
					</p>
				{/if}
			</div>

			<div class="global-ask-panel__body">
				{#key panelKey}
					<CrdAskPanel
						kind={selectedResource?.kind || ''}
						group={selectedResource?.group ||
							(selectedResource?.name?.includes('.')
								? selectedResource.name.split('.').slice(1).join('.')
								: '')}
						name={selectedResource?.name || ''}
						version={panelVersion}
						release={releaseName}
						deprecated={false}
						spec={null}
						status={null}
					/>
				{/key}
			</div>
		</div>
	</div>
{/if}
