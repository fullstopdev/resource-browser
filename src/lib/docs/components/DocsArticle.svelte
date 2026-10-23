<script lang="ts">
	import { page } from '$app/state';
	import type { DocsTocEntry } from '$lib/docs/render';

	type Link = { href: string; title: string } | null;

	let {
		data
	}: {
		data: {
			title: string;
			description: string;
			section: string;
			html: string;
			toc: DocsTocEntry[];
			prev: Link;
			next: Link;
		};
	} = $props();

	const canonical = $derived(new URL(page.url.pathname, page.url.origin).href);
</script>

<svelte:head>
	<title>{data.title} · Docs | EDA Resource Browser</title>
	<meta name="description" content={data.description} />
	<meta name="robots" content="index, follow" />
	<link rel="canonical" href={canonical} />
</svelte:head>

<div class="flex gap-8">
	<article class="docs-content min-w-0 flex-1 pb-12">
		<p class="mb-1 text-xs font-semibold tracking-wider text-cyan-700 uppercase dark:text-cyan-400">
			{data.section === 'Guide' ? 'User guide' : 'Developer guide'}
		</p>
		<h1 class="mb-2 text-3xl font-bold text-slate-900 dark:text-white">{data.title}</h1>
		<p class="mb-8 text-base text-slate-600 dark:text-slate-300">{data.description}</p>

		<!-- Repo-authored markdown rendered at prerender time (src/lib/docs/render.ts). -->
		{@html data.html}

		<nav
			class="mt-12 flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:justify-between dark:border-slate-700"
			aria-label="Previous and next pages"
		>
			{#if data.prev}
				<a href={data.prev.href} class="docs-pager">
					<span class="text-xs text-slate-500 dark:text-slate-400">← Previous</span>
					<span class="font-medium">{data.prev.title}</span>
				</a>
			{:else}
				<span></span>
			{/if}
			{#if data.next}
				<a href={data.next.href} class="docs-pager sm:text-right">
					<span class="text-xs text-slate-500 dark:text-slate-400">Next →</span>
					<span class="font-medium">{data.next.title}</span>
				</a>
			{/if}
		</nav>
	</article>

	{#if data.toc.length > 1}
		<aside class="hidden w-56 shrink-0 xl:block" aria-label="On this page">
			<nav class="sticky top-28 max-h-[calc(100dvh-8rem)] overflow-y-auto text-sm">
				<p
					class="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400"
				>
					On this page
				</p>
				<ul class="space-y-1 border-l border-slate-200 dark:border-slate-700">
					{#each data.toc as entry (entry.id)}
						<li>
							<a
								href="#{entry.id}"
								class="block border-l-2 border-transparent py-0.5 text-slate-600 hover:border-cyan-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white {entry.depth ===
								3
									? 'pl-6'
									: 'pl-3'}"
							>
								{entry.text}
							</a>
						</li>
					{/each}
				</ul>
			</nav>
		</aside>
	{/if}
</div>
