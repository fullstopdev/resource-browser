<script lang="ts">
	import type { ResourceViewMode } from '$lib/resourceView';

	export let viewMode: ResourceViewMode = 'schema';
	export let onViewChange: (mode: ResourceViewMode) => void = () => {};
	export let showExpandControls = false;
	export let showAskTab = true;
	export let isExpanded = false;
	export let onExpandToggle: () => void = () => {};

	const allTabs = [
		{
			id: 'schema' as const,
			label: 'Schema',
			icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
			ai: false
		},
		{
			id: 'ask' as const,
			label: 'Ask AI',
			icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
			ai: true
		},
		{
			id: 'compare' as const,
			label: 'Compare',
			icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4',
			ai: false
		}
	];

	$: tabs = showAskTab ? allTabs : allTabs.filter((tab) => tab.id !== 'ask');
</script>

<div
	class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
	role="tablist"
	aria-label="Resource views"
>
	<div
		class="-mx-1 flex snap-x snap-mandatory items-center gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:overflow-visible sm:pb-0"
	>
		{#each tabs as tab}
			<button
				type="button"
				role="tab"
				aria-selected={viewMode === tab.id}
				on:click={() => onViewChange(tab.id)}
				class="inline-flex min-h-11 shrink-0 snap-start items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors
				       {viewMode === tab.id
					? tab.ai
						? 'border-blue-600 bg-blue-600 text-white shadow-sm dark:border-blue-500 dark:bg-blue-600'
						: 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-300'
					: tab.ai
						? 'border-blue-200 bg-blue-50/80 text-blue-700 hover:border-blue-400 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:border-blue-600'
						: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-500'}"
			>
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={tab.icon} />
				</svg>
				<span>{tab.label}</span>
				{#if tab.ai && viewMode !== tab.id}
					<span
						class="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white dark:bg-blue-500"
					>
						AI
					</span>
				{/if}
			</button>
		{/each}
	</div>

	{#if showExpandControls}
		<button
			type="button"
			on:click={onExpandToggle}
			class="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 self-end rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-blue-400 hover:bg-slate-50 sm:self-auto dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-700"
			title={isExpanded ? 'Collapse all fields' : 'Expand all fields'}
		>
			<svg
				class="h-4 w-4 transition-transform {isExpanded ? 'rotate-180' : ''}"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
				aria-hidden="true"
			>
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
			</svg>
			<span>{isExpanded ? 'Collapse' : 'Expand'} all</span>
		</button>
	{/if}
</div>
