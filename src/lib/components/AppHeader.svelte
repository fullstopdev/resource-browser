<script lang="ts">
	import { browser } from '$app/environment';
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { tick } from 'svelte';
	import { buildCatalogCrdPath, buildCatalogPath } from '$lib/urlState';
	import { buildOpenApiCatalogPath, defaultOpenApiRelease } from '$lib/openapi/urlState';
	import type { OpenApiReleasesConfig } from '$lib/openapi/types';
	import type { EdaRelease, ReleasesConfig } from '$lib/structure';
	import { fetchManifest, type ManifestResource } from '$lib/manifest';
	import { searchResources } from '$lib/resourceSearch';
	import Theme from '$lib/components/Theme.svelte';
	import { getHeaderReleases } from '$lib/headerReleases';
	import { loadStaticYaml } from '$lib/yaml/safeYaml';
	import openapiReleasesYaml from '$lib/openapi-releases.yaml?raw';
	import releasesYaml from '$lib/releases.yaml?raw';

	/** Fixed (detail pages) vs sticky (homepage / browse) */
	export let fixed = false;
	/** Optional handler when logo is clicked (e.g. exit browse mode) */
	export let onLogoClick: ((e: MouseEvent) => void) | undefined = undefined;
	/** Show global tools navigation (default on) */
	export let showToolsNav = true;

	const openApiReleases =
		(loadStaticYaml(openapiReleasesYaml) as OpenApiReleasesConfig).releases ?? [];
	const openApiDefault = defaultOpenApiRelease(openApiReleases);
	const releases = (loadStaticYaml(releasesYaml) as ReleasesConfig).releases;
	const latestRelease = releases.find((r) => r.default) ?? releases[0]!;

	/** Release trains (v26, v25, …), newest first, in the order given. */
	function trainsOf<T extends { name: string }>(list: T[]) {
		return list.reduce<Array<{ label: string; releases: T[] }>>((acc, r) => {
			const label = `v${r.name.split('.')[0]}`;
			const train = acc.find((t) => t.label === label);
			if (train) train.releases.push(r);
			else acc.push({ label, releases: [r] });
			return acc;
		}, []);
	}

	/** A page's own release list (OpenAPI pages); otherwise the CRD releases. */
	const pageReleases = getHeaderReleases();

	type NavItem = {
		href: string;
		label: string;
		description: string;
		icon: string;
		match: (path: string) => boolean;
		catalogAware?: boolean;
		openApiAware?: boolean;
	};

	type NavGroup = { id: 'crds' | 'openapi'; label: string; items: NavItem[] };

	const ICONS = {
		catalog: 'M4 6h16M4 12h16M4 18h10',
		search: 'M21 21l-5-5m2-5.5a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z',
		graph:
			'M7 12a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zm15-6a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zm0 12a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM7 11l10-4M7 13l10 4',
		changes: 'M9 12h6m-6 4h4m4 5H7a2 2 0 01-2-2V5a2 2 0 012-2h6l6 6v10a2 2 0 01-2 2z',
		compare: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4',
		code: 'M8 6l-6 6 6 6M16 6l6 6-6 6'
	};

	const navGroups: NavGroup[] = [
		{
			id: 'crds',
			label: 'CRDs',
			items: [
				{
					href: '/',
					label: 'Catalog',
					description: 'Every CRD in the selected release',
					icon: ICONS.catalog,
					match: (path) => path === '/',
					catalogAware: true
				},
				{
					href: '/spec-search',
					label: 'Spec Search',
					description: 'Find a field across every schema',
					icon: ICONS.search,
					match: (path) => path.startsWith('/spec-search')
				},
				{
					href: '/dependency-map',
					label: 'Dependency Map',
					description: 'Which resources reference which',
					icon: ICONS.graph,
					match: (path) => path.startsWith('/dependency-map')
				},
				{
					href: '/release-changes',
					label: 'Release Changes',
					description: 'New, changed and deprecated CRDs',
					icon: ICONS.changes,
					match: (path) => path.startsWith('/release-changes')
				},
				{
					href: '/comparison',
					label: 'Compare releases',
					description: 'Schema diff between two versions',
					icon: ICONS.compare,
					match: (path) => path.startsWith('/comparison')
				}
			]
		},
		{
			id: 'openapi',
			label: 'API',
			items: [
				{
					href: '/openapi',
					label: 'API Explorer',
					description: 'OpenAPI paths for core and app APIs',
					icon: ICONS.code,
					match: (path) => path === '/openapi' || path.startsWith('/openapi/'),
					openApiAware: true
				},
				{
					href: '/openapi-comparison',
					label: 'Compare APIs',
					description: 'Path and schema changes between releases',
					icon: ICONS.compare,
					match: (path) => path.startsWith('/openapi-comparison'),
					openApiAware: true
				}
			]
		}
	];

	/** Pages that read `?release=` (the switcher only appears there). */
	const RELEASE_AWARE = ['/', '/spec-search', '/dependency-map', '/validate-yaml'];

	let openMenu: NavGroup['id'] | 'release' | null = null;
	let mobileNavOpen = false;
	let jumpOpen = false;
	let jumpQuery = '';
	let jumpIndex = 0;
	let jumpInput: HTMLInputElement | null = null;
	let manifest: ManifestResource[] = [];
	let manifestFor = '';

	$: pathname = $page.url.pathname;
	// Prerendered pages can't read the query string; the release is resolved again in the browser.
	$: urlRelease = browser ? $page.url.searchParams.get('release') : null;
	$: crdRelease = releases.find((r) => r.name === urlRelease) ?? latestRelease;
	$: currentRelease = $pageReleases
		? ($pageReleases.releases.find((r) => r.name === $pageReleases.current) ?? crdRelease)
		: crdRelease;
	$: trains = trainsOf($pageReleases ? $pageReleases.releases : releases);
	$: showReleaseSwitcher = !!$pageReleases || RELEASE_AWARE.includes(pathname);
	$: jumpResults = jumpQuery.trim() ? searchResources(manifest, jumpQuery, { limit: 8 }) : [];
	$: if (jumpIndex >= jumpResults.length) jumpIndex = 0;

	function groupActive(group: NavGroup): boolean {
		return group.items.some((item) => item.match(pathname));
	}

	function catalogHref(): string {
		if (!browser) return '/';
		const release = new URLSearchParams(window.location.search).get('release');
		return release ? buildCatalogPath({ release }) : '/';
	}

	function openApiHref(item: NavItem): string {
		if (item.href.startsWith('/openapi-comparison')) return '/openapi-comparison';
		return buildOpenApiCatalogPath({ release: openApiDefault?.name });
	}

	function resolveHref(item: NavItem): string {
		if (item.catalogAware) return catalogHref();
		if (item.openApiAware) return openApiHref(item);
		return item.href;
	}

	/** Same page with another `release` (other parameters kept). */
	function releaseHref(name: string): string {
		if ($pageReleases) return $pageReleases.href(name);
		const params = new URLSearchParams(browser ? $page.url.searchParams : undefined);
		params.set('release', name);
		return `${pathname}?${params.toString()}`;
	}

	function toggleMenu(id: NavGroup['id'] | 'release') {
		openMenu = openMenu === id ? null : id;
	}

	function closeAll() {
		openMenu = null;
		mobileNavOpen = false;
		jumpOpen = false;
	}

	/** Arrow keys move between the links of an open menu. */
	function menuKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			const trigger = (event.currentTarget as HTMLElement)
				.closest('.rb-nav-item')
				?.querySelector<HTMLElement>('[aria-haspopup]');
			openMenu = null;
			trigger?.focus();
			return;
		}
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		const links = Array.from(
			(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('a')
		);
		if (links.length === 0) return;
		event.preventDefault();
		const i = links.indexOf(document.activeElement as HTMLElement);
		const next =
			event.key === 'ArrowDown' ? (i + 1) % links.length : (i - 1 + links.length) % links.length;
		links[next]?.focus();
	}

	async function triggerKeydown(event: KeyboardEvent, id: NavGroup['id'] | 'release') {
		if (event.key !== 'ArrowDown') return;
		event.preventDefault();
		openMenu = id;
		await tick();
		document.querySelector<HTMLElement>(`#rb-menu-${id} a`)?.focus();
	}

	async function loadManifest() {
		if (manifestFor === crdRelease.folder) return;
		manifestFor = crdRelease.folder;
		manifest = (await fetchManifest(crdRelease.folder)) ?? [];
	}

	async function openJump() {
		openMenu = null;
		jumpOpen = true;
		void loadManifest();
		await tick();
		jumpInput?.focus();
	}

	function jumpTo(resource: ManifestResource) {
		const href = buildCatalogCrdPath({
			release: crdRelease.name,
			kind: resource.kind,
			name: resource.name
		});
		jumpOpen = false;
		jumpQuery = '';
		void goto(href);
	}

	function jumpKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			jumpOpen = false;
		} else if (event.key === 'ArrowDown' && jumpResults.length) {
			event.preventDefault();
			jumpIndex = (jumpIndex + 1) % jumpResults.length;
		} else if (event.key === 'ArrowUp' && jumpResults.length) {
			event.preventDefault();
			jumpIndex = (jumpIndex - 1 + jumpResults.length) % jumpResults.length;
		} else if (event.key === 'Enter' && jumpResults[jumpIndex]) {
			event.preventDefault();
			jumpTo(jumpResults[jumpIndex]!);
		}
	}

	/** `/` opens Jump to a CRD unless the user is typing somewhere. */
	function windowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			if (openMenu || mobileNavOpen) closeAll();
			return;
		}
		// A page can claim `/` first (the API Explorer focuses its own filter).
		if (event.defaultPrevented) return;
		if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [contenteditable="true"], .monaco-editor'))
			return;
		event.preventDefault();
		void openJump();
	}

	function windowClick(event: MouseEvent) {
		// composedPath: the clicked icon may already be re-rendered (detached) by the time this runs.
		const inside = event
			.composedPath()
			.some(
				(el) =>
					el instanceof Element &&
					el.matches('.rb-nav-item, .rb-jump, .rb-release, .rb-sheet, .rb-menu-toggle')
			);
		if (!inside) {
			openMenu = null;
			jumpOpen = false;
			mobileNavOpen = false;
		}
	}

	afterNavigate(closeAll);
</script>

<svelte:window on:keydown={windowKeydown} on:click={windowClick} />

<header class="app-header rb-header z-50 {fixed ? 'fixed top-0 right-0 left-0' : 'sticky top-0'}">
	<div class="rb-bar mx-auto max-w-[90rem]">
		<div class="flex min-w-0 shrink-0 items-center gap-2">
			<slot name="leading" />
			<a href="/" class="rb-brand" on:click={onLogoClick}>
				<img
					src="/images/eda.svg"
					alt=""
					width="28"
					height="28"
					loading="eager"
					fetchpriority="high"
				/>
				<span class="rb-brand-text">
					<span class="rb-brand-name">EDA Resource Browser</span>
					<span class="rb-brand-line">Nokia Event-Driven Automation</span>
				</span>
			</a>
		</div>

		{#if showToolsNav}
			<nav class="rb-nav" aria-label="Main">
				<ul class="rb-nav-list">
					{#each navGroups as group (group.id)}
						<li class="rb-nav-item">
							<button
								type="button"
								class="rb-nav-trigger"
								class:is-active={groupActive(group)}
								aria-haspopup="true"
								aria-expanded={openMenu === group.id}
								aria-controls="rb-menu-{group.id}"
								on:click={() => toggleMenu(group.id)}
								on:keydown={(e) => triggerKeydown(e, group.id)}
							>
								{group.label}
								<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
							</button>
							{#if openMenu === group.id}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div class="rb-menu" id="rb-menu-{group.id}" on:keydown={menuKeydown}>
									{#each group.items as item (item.href)}
										{@const active = item.match(pathname)}
										<a
											href={resolveHref(item)}
											class="rb-menu-link"
											class:is-active={active}
											aria-current={active ? 'page' : undefined}
										>
											<span class="rb-menu-icon" aria-hidden="true">
												<svg viewBox="0 0 24 24"><path d={item.icon} /></svg>
											</span>
											<span class="rb-menu-label">{item.label}</span>
											<span class="rb-menu-desc">{item.description}</span>
										</a>
									{/each}
								</div>
							{/if}
						</li>
					{/each}
					<li class="rb-nav-item">
						<a
							href="/docs"
							class="rb-nav-trigger"
							class:is-active={pathname === '/docs' || pathname.startsWith('/docs/')}
							aria-current={pathname.startsWith('/docs') ? 'page' : undefined}>Docs</a
						>
					</li>
				</ul>
			</nav>
		{/if}

		<div class="rb-actions">
			{#if showToolsNav}
				<div class="rb-jump">
					<button
						type="button"
						class="rb-jump-trigger"
						on:click={openJump}
						aria-expanded={jumpOpen}
					>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS.search} /></svg>
						<span class="rb-jump-text">Jump to a CRD</span>
						<kbd aria-hidden="true">/</kbd>
					</button>
					{#if jumpOpen}
						<div class="rb-jump-pop" role="dialog" aria-label="Jump to a CRD">
							<label for="rb-jump-input" class="sr-only">CRD kind or group</label>
							<input
								id="rb-jump-input"
								bind:this={jumpInput}
								bind:value={jumpQuery}
								on:keydown={jumpKeydown}
								type="search"
								autocomplete="off"
								placeholder="Kind or group in {crdRelease.name}, e.g. BridgeDomain"
								role="combobox"
								aria-expanded={jumpResults.length > 0}
								aria-controls="rb-jump-results"
								aria-autocomplete="list"
							/>
							{#if jumpQuery.trim()}
								<ul id="rb-jump-results" role="listbox" class="rb-jump-results">
									{#each jumpResults as resource, i (resource.name)}
										<li role="option" aria-selected={i === jumpIndex}>
											<button
												type="button"
												class:is-active={i === jumpIndex}
												on:click={() => jumpTo(resource)}
											>
												<span class="rb-jump-kind"
													>{resource.kind ?? resource.name.split('.')[0]}</span
												>
												<span class="rb-jump-group"
													>{resource.group ?? resource.name.split('.').slice(1).join('.')}</span
												>
											</button>
										</li>
									{:else}
										<li class="rb-jump-empty">
											{manifest.length ? `No CRD matches "${jumpQuery}"` : 'Loading CRDs…'}
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					{/if}
				</div>
			{/if}

			{#if showReleaseSwitcher}
				<div class="rb-nav-item rb-release">
					<button
						type="button"
						class="rb-release-trigger"
						aria-haspopup="true"
						aria-expanded={openMenu === 'release'}
						aria-controls="rb-menu-release"
						aria-label="{currentRelease.name}{currentRelease.default ? ' Latest' : ''}, EDA release"
						on:click={() => toggleMenu('release')}
						on:keydown={(e) => triggerKeydown(e, 'release')}
					>
						<span class="rb-release-name">{currentRelease.name}</span>
						{#if currentRelease.default}<span class="rb-tag-latest">Latest</span>{/if}
						<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
					</button>
					{#if openMenu === 'release'}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="rb-menu rb-release-menu" id="rb-menu-release" on:keydown={menuKeydown}>
							{#each trains as train (train.label)}
								<p class="rb-release-train">{train.label}</p>
								{#each train.releases as release (release.name)}
									<a
										href={releaseHref(release.name)}
										data-sveltekit-reload={$pageReleases ? 'off' : true}
										class="rb-release-option"
										class:is-active={release.name === currentRelease.name}
										aria-current={release.name === currentRelease.name ? 'true' : undefined}
									>
										{release.name}
										{#if release.default}<span class="rb-tag-latest">Latest</span>{/if}
									</a>
								{/each}
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<slot name="actions" />

			{#if showToolsNav}
				<a
					href="/validate-yaml"
					class="rb-cta"
					aria-current={pathname.startsWith('/validate-yaml') ? 'page' : undefined}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
					<span>Validate YAML</span>
				</a>
			{/if}
			<Theme />
			{#if showToolsNav}
				<button
					type="button"
					class="rb-menu-toggle"
					aria-expanded={mobileNavOpen}
					aria-controls="rb-sheet"
					aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
					on:click={() => (mobileNavOpen = !mobileNavOpen)}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						{#if mobileNavOpen}<path d="M6 18L18 6M6 6l12 12" />{:else}<path
								d="M4 7h16M4 12h16M4 17h16"
							/>{/if}
					</svg>
				</button>
			{/if}
		</div>
	</div>

	{#if showToolsNav && mobileNavOpen}
		<nav id="rb-sheet" class="rb-sheet" aria-label="Main">
			{#each navGroups as group (group.id)}
				<div>
					<p class="rb-sheet-label">{group.label}</p>
					{#each group.items as item (item.href)}
						<a href={resolveHref(item)} aria-current={item.match(pathname) ? 'page' : undefined}
							>{item.label}</a
						>
					{/each}
				</div>
			{/each}
			<div>
				<p class="rb-sheet-label">Tools</p>
				<a
					href="/validate-yaml"
					aria-current={pathname.startsWith('/validate-yaml') ? 'page' : undefined}>Validate YAML</a
				>
				<a href="/docs" aria-current={pathname.startsWith('/docs') ? 'page' : undefined}>Docs</a>
			</div>
		</nav>
	{/if}

	<slot />
</header>
