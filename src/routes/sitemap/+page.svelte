<script lang="ts">
	import { page } from '$app/stores';

	export let data;
	const staticPages: string[] = data.staticPages;
	const groupedResources = data.groupedResources;
</script>

<svelte:head>
	<title>Site Map | Nokia EDA Resource Browser</title>
	<meta
		name="description"
		content="Explore the Nokia EDA Resource Browser site map with direct links to every CRD resource version and core tool page."
	/>
	<meta name="robots" content="index, follow" />
	<link rel="canonical" href="{$page.url.href}" />
</svelte:head>

<main class="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
	<section class="mb-10">
		<p class="text-sm uppercase tracking-[0.2em] text-slate-500">Sitemap</p>
		<h1 class="mt-3 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">Complete site index</h1>
		<p class="mt-4 max-w-3xl text-base leading-7 text-slate-600 dark:text-slate-300">
			This page lists all main sections of the Nokia EDA Resource Browser and each published CRD resource version for easy navigation and search engine discovery.
		</p>
	</section>

	<section class="mb-12 rounded-3xl border border-slate-200 bg-slate-50 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
		<h2 class="text-xl font-semibold text-slate-900 dark:text-white">Core pages</h2>
		<ul class="mt-4 space-y-2 text-slate-700 dark:text-slate-300">
			{#each staticPages as path}
				<li>
					<a href="{path}" class="text-blue-600 hover:underline dark:text-cyan-300">{path}</a>
				</li>
			{/each}
		</ul>
	</section>

	<section>
		<h2 class="text-xl font-semibold text-slate-900 dark:text-white">Resource pages</h2>
		<div class="mt-6 space-y-10">
			{#each groupedResources as groupEntry}
				<div class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-950">
					<h3 class="text-lg font-semibold text-slate-900 dark:text-white">{groupEntry.group}</h3>
					<ul class="mt-4 space-y-3 text-slate-700 dark:text-slate-300">
						{#each groupEntry.resources as resource}
							<li>
								<p class="font-medium text-slate-900 dark:text-white">{resource.name}</p>
								<div class="mt-2 flex flex-wrap gap-2">
									{#each resource.versions as version}
										<a
											href="/{resource.name}/{version}"
											class="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-sm text-slate-700 transition hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
										>
											{version}
										</a>
									{/each}
								</div>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
	</section>
</main>
