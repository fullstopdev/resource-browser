<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import PageCredits from '$lib/components/PageCredits.svelte';
	import { docsHref } from '$lib/docs/registry';
	import { renderMermaidIn } from '$lib/docs/mermaid';
	import { theme } from '$lib/theme';
	import '$lib/docs/docs.css';

	let { data, children } = $props();

	let article: HTMLElement | undefined = $state();

	function isCurrent(slug: string): boolean {
		return page.url.pathname === docsHref(slug);
	}

	// Diagrams are rendered client-side; re-run after each navigation and theme change.
	afterNavigate(() => {
		if (article) void renderMermaidIn(article, $theme);
	});

	$effect(() => {
		const mode = $theme;
		if (article) void renderMermaidIn(article, mode);
	});
</script>

<AppHeader fixed={false} />

<div class="docs-shell mx-auto flex w-full max-w-[90rem] gap-8 px-4 pt-6 sm:px-6 lg:px-8">
	<aside class="docs-sidebar hidden w-60 shrink-0 lg:block" aria-label="Documentation">
		<nav class="sticky top-28 max-h-[calc(100dvh-8rem)] overflow-y-auto pb-8">
			{#each data.nav as group (group.section)}
				<p
					class="mt-5 mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase first:mt-0 dark:text-slate-400"
				>
					{group.section === 'Guide' ? 'User guide' : 'Developer guide'}
				</p>
				<ul class="space-y-0.5">
					{#each group.pages as item (item.slug)}
						<li>
							<a
								href={docsHref(item.slug)}
								class="block rounded-md px-2.5 py-1.5 text-sm transition-colors {isCurrent(
									item.slug
								)
									? 'bg-cyan-50 font-medium text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300'
									: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'}"
								aria-current={isCurrent(item.slug) ? 'page' : undefined}
							>
								{item.title}
							</a>
						</li>
					{/each}
				</ul>
			{/each}
		</nav>
	</aside>

	<div class="min-w-0 flex-1">
		<details
			class="docs-mobile-nav mb-6 rounded-lg border border-slate-200 bg-white lg:hidden dark:border-slate-700 dark:bg-slate-900"
		>
			<summary
				class="cursor-pointer px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200"
			>
				Documentation menu
			</summary>
			<nav class="border-t border-slate-200 px-2 py-2 dark:border-slate-700">
				{#each data.nav as group (group.section)}
					<p class="mt-2 px-2 text-xs font-semibold text-slate-500 uppercase dark:text-slate-400">
						{group.section === 'Guide' ? 'User guide' : 'Developer guide'}
					</p>
					{#each group.pages as item (item.slug)}
						<a
							href={docsHref(item.slug)}
							class="block rounded px-2 py-1.5 text-sm {isCurrent(item.slug)
								? 'font-medium text-cyan-700 dark:text-cyan-300'
								: 'text-slate-600 dark:text-slate-300'}"
						>
							{item.title}
						</a>
					{/each}
				{/each}
			</nav>
		</details>

		<div bind:this={article}>
			{@render children()}
		</div>
	</div>
</div>

<PageCredits />
