<script lang="ts">
	import '../app.css';
 
	import Sidebar from '$lib/components/Sidebar.svelte';
	 let AnimatedBackground: any = $state(null);
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { derived } from 'svelte/store';

	let { children } = $props();
	
	// Show sidebar on resource detail pages (only when path looks like /<resource>/<version>)
	const isDetailPage = derived(page, $page => {
		const path = $page.url.pathname || '/';
		// Explicit exclusion for certain routes that should never show the sidebar
		if (path.startsWith('/bulk-diff') || path.startsWith('/spec-search')) return false;
		// Match two segments like /resource/version; do not show for single-segment paths
		return /^\/[^\/]+\/[^\/]+$/.test(path);
	});

	// Only show the global footer on the homepage
		// no special-case: show credits on all pages
	onMount(async () => {
			// Defer loading heavy animated background until the browser is idle so it doesn't
			// compete with LCP-critical assets and main-thread tasks.
			if (typeof (window as any).requestIdleCallback === 'function') {
				(window as any).requestIdleCallback(async () => {
					const m = await import('$lib/components/AnimatedBackground.svelte');
					AnimatedBackground = m.default;
				});
			} else {
				setTimeout(async () => {
					const m = await import('$lib/components/AnimatedBackground.svelte');
					AnimatedBackground = m.default;
				}, 300);
			}
		});
</script>

{#if AnimatedBackground}
	<AnimatedBackground />
{/if}

<!-- Inline LCP hero background image: place an image early in the DOM so it can be preloaded and measured
		 by the browser as the LCP candidate. We use a dedicated container so styles can keep the gradient
		 overlay and the content flush on top of the image. -->
<div class="header-bg-container" aria-hidden="true">
	<picture>
		<!-- Only load the large hero background for desktop devices to reduce mobile bytes -->
		<source media="(min-width: 769px)" srcset="/images/background-crd.webp">
		<img src="/images/background.webp" alt="" class="header-bg-img" loading="eager" fetchpriority="high" width="1920" height="720" />
	</picture>
</div>

{#if $isDetailPage}
	<div class="flex h-screen has-header-img pt-16 md:pt-20">
		<Sidebar />
		<div class="flex-1 overflow-auto pb-16">
			{@render children()}
		</div>
	</div>
{:else}
	<div class="pt-16 md:pt-20 pb-16 has-header-img">
		{@render children()}
	</div>
{/if}
