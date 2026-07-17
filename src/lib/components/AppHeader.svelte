<script lang="ts">
	import { browser } from '$app/environment';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/stores';
	import { buildCatalogPath } from '$lib/urlState';
	import { buildOpenApiCatalogPath, defaultOpenApiRelease } from '$lib/openapi/urlState';
	import type { OpenApiReleasesConfig } from '$lib/openapi/types';
	import Theme from '$lib/components/Theme.svelte';
	import { loadStaticYaml } from '$lib/yaml/safeYaml';
	import openapiReleasesYaml from '$lib/openapi-releases.yaml?raw';

	/** Fixed (detail pages) vs sticky (homepage / browse) */
	export let fixed = false;
	/** Optional handler when logo is clicked (e.g. exit browse mode) */
	export let onLogoClick: ((e: MouseEvent) => void) | undefined = undefined;
	/** Show global tools navigation (default on) */
	export let showToolsNav = true;

	const openApiReleases =
		(loadStaticYaml(openapiReleasesYaml) as OpenApiReleasesConfig).releases ?? [];
	const openApiDefault = defaultOpenApiRelease(openApiReleases);

	type NavItem = {
		href: string;
		label: string;
		match: (path: string) => boolean;
		catalogAware?: boolean;
		openApiAware?: boolean;
	};

	type NavGroup = {
		id: 'crds' | 'openapi';
		label: string;
		items: NavItem[];
	};

	const navGroups: NavGroup[] = [
		{
			id: 'crds',
			label: 'CRD',
			items: [
				{
					href: '/',
					label: 'Catalog',
					match: (path) => path === '/',
					catalogAware: true
				},
				{
					href: '/release-changes',
					label: 'Release Changes',
					match: (path) => path.startsWith('/release-changes')
				},
				{
					href: '/spec-search',
					label: 'Spec Search',
					match: (path) => path.startsWith('/spec-search')
				},
				{
					href: '/validate-yaml',
					label: 'Validate YAML',
					match: (path) => path.startsWith('/validate-yaml')
				},
				{
					href: '/comparison',
					label: 'Comparison',
					match: (path) => path.startsWith('/comparison')
				},
				{
					href: '/dependency-map',
					label: 'Dependency Map',
					match: (path) => path.startsWith('/dependency-map')
				}
			]
		},
		{
			id: 'openapi',
			label: 'API',
			items: [
				{
					href: '/openapi',
					label: 'Explorer',
					match: (path) => path === '/openapi' || path.startsWith('/openapi/'),
					openApiAware: true
				},
				{
					href: '/openapi-comparison',
					label: 'Comparison',
					match: (path) => path.startsWith('/openapi-comparison'),
					openApiAware: true
				}
			]
		}
	];

	let mobileNavOpen = false;

	function isNavActive(match: (path: string) => boolean): boolean {
		return match($page.url.pathname);
	}

	function catalogHref(): string {
		if (!browser) return '/';
		const release = new URLSearchParams(window.location.search).get('release');
		return release ? buildCatalogPath({ release }) : '/';
	}

	function openApiHref(item: NavItem): string {
		if (item.href.startsWith('/openapi-comparison')) {
			return '/openapi-comparison';
		}
		return buildOpenApiCatalogPath({
			release: openApiDefault?.name
		});
	}

	function resolveHref(item: NavItem): string {
		if (item.catalogAware) return catalogHref();
		if (item.openApiAware) return openApiHref(item);
		return item.href;
	}

	function closeMobileNav() {
		mobileNavOpen = false;
	}

	function toggleMobileNav() {
		mobileNavOpen = !mobileNavOpen;
	}

	afterNavigate(() => {
		closeMobileNav();
	});
</script>

<header
	class="app-header app-mobile-header z-50 border-b border-slate-200/70 bg-white/85 backdrop-blur-xl dark:border-slate-800/90 dark:bg-[#0b1220]/88
	       {fixed ? 'fixed top-0 right-0 left-0' : 'sticky top-0'}"
>
	<div
		class="app-header-bar mx-auto flex min-h-14 max-w-[90rem] items-center gap-3 px-3 py-1.5 sm:gap-4 sm:px-6 lg:px-8"
	>
		<div class="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
			<slot name="leading" />

			<a
				href="/"
				class="app-header-brand flex shrink-0 items-center gap-2.5 no-underline"
				on:click={onLogoClick}
			>
				<img
					src="/images/eda.svg"
					alt="Nokia EDA"
					width="28"
					height="28"
					class="h-7 w-7 rounded sm:h-8 sm:w-8"
					loading="eager"
					fetchpriority="high"
				/>
				<span class="app-header-brand-text truncate">
					<span class="app-header-brand-name">Resource Browser</span>
				</span>
			</a>
		</div>

		<div class="ml-auto flex min-w-0 shrink items-center gap-1.5 self-center sm:gap-2">
			{#if showToolsNav}
				<button
					type="button"
					class="app-header-nav-toggle flex h-9 w-9 items-center justify-center md:hidden"
					aria-expanded={mobileNavOpen}
					aria-controls="app-header-tools-nav"
					aria-label={mobileNavOpen ? 'Close tools menu' : 'Open tools menu'}
					on:click={toggleMobileNav}
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
						{#if mobileNavOpen}
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M6 18L18 6M6 6l12 12"
							/>
						{:else}
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M4 6h16M4 12h16M4 18h16"
							/>
						{/if}
					</svg>
				</button>
			{/if}
			<slot name="actions" />
			<Theme />
		</div>
	</div>

	{#if showToolsNav}
		<nav
			id="app-header-tools-nav"
			class="app-header-tools-nav {mobileNavOpen ? 'is-open' : ''}"
			aria-label="Application tools"
		>
			<div class="app-header-tools-inner mx-auto max-w-[90rem] px-3 sm:px-6 lg:px-8">
				{#each navGroups as group, groupIndex (group.id)}
					{#if groupIndex > 0}
						<span class="app-header-tools-sep" aria-hidden="true"></span>
					{/if}

					<section
						class="app-header-tools-group"
						aria-labelledby="app-header-tools-{group.id}"
					>
						<span class="app-header-tools-group-label" id="app-header-tools-{group.id}">
							{group.label}
						</span>
						<div class="app-header-tools-group-links">
							{#each group.items as item (item.href)}
								{@const active = isNavActive(item.match)}
								<a
									href={resolveHref(item)}
									class="app-header-tools-link {active ? 'is-active' : ''}"
									aria-current={active ? 'page' : undefined}
									on:click={closeMobileNav}
								>
									{item.label}
								</a>
							{/each}
						</div>
					</section>
				{/each}
			</div>
		</nav>
	{/if}

	<slot />
</header>
