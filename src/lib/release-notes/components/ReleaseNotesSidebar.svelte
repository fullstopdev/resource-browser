<script lang="ts">
	import { toneDotClass } from '$lib/release-notes/presentation';
	import type { ReleaseNotesEntry, ReleaseNotesSummary } from '$lib/release-notes/types';

	let {
		releaseHistory,
		selected,
		latestVersion,
		onSelect,
		entrySummary,
		hasVisibleChanges,
		releaseTone
	}: {
		releaseHistory: ReleaseNotesEntry[];
		selected: string;
		latestVersion: string;
		onSelect: (toVer: string) => void;
		entrySummary: (entry: ReleaseNotesEntry) => ReleaseNotesSummary;
		hasVisibleChanges: (summary: ReleaseNotesSummary) => boolean;
		releaseTone: (entry: ReleaseNotesEntry) => 'low' | 'medium' | 'high';
	} = $props();

</script>

<aside class="release-notes-sidebar" aria-label="Release timeline">
	<p class="text-[0.65rem] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
		Upgrade path
	</p>
	<h2 class="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">Releases</h2>

	<ol class="release-notes-timeline mt-2 space-y-0.5">
		{#each releaseHistory as entry (entry.toVer)}
			{@const summary = entrySummary(entry)}
			{@const isActive = selected === entry.toVer}
			<li>
				<button
					type="button"
					class="release-notes-timeline-btn"
					class:release-notes-timeline-btn--active={isActive}
					onclick={() => onSelect(entry.toVer)}
				>
					<span
						class="mt-1.5 h-2 w-2 shrink-0 rounded-full {toneDotClass(releaseTone(entry))}"
						aria-hidden="true"
					></span>
					<span class="min-w-0 flex-1 text-left">
						<span class="flex flex-wrap items-center gap-1">
							<span class="text-sm font-semibold text-slate-900 dark:text-slate-100"
								>{entry.toVer}</span
							>
							{#if entry.toVer === latestVersion}
								<span
									class="rounded px-1 py-px text-[0.6rem] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50"
									>latest</span
								>
							{/if}
						</span>
						<span class="block text-[0.68rem] text-slate-500 dark:text-slate-400"
							>{entry.fromVer} → {entry.toVer}</span
						>
						{#if hasVisibleChanges(summary)}
							<span class="mt-0.5 flex flex-wrap gap-0.5">
								{#if summary.added > 0}
									<span
										class="rounded px-1 py-px text-[0.62rem] font-semibold text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40"
										>+{summary.added}</span
									>
								{/if}
								{#if summary.modified > 0}
									<span
										class="rounded px-1 py-px text-[0.62rem] font-semibold text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40"
										>~{summary.modified}</span
									>
								{/if}
								{#if summary.deprecated > 0}
									<span
										class="rounded px-1 py-px text-[0.62rem] font-semibold text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-950/40"
										>!{summary.deprecated}</span
									>
								{/if}
							</span>
						{:else}
							<span class="block text-[0.65rem] text-slate-400 dark:text-slate-500"
								>No CRD changes</span
							>
						{/if}
					</span>
				</button>
			</li>
		{/each}
	</ol>

</aside>