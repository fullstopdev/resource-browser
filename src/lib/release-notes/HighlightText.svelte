<script lang="ts">
	import { highlightSegments } from './presentation';

	let { text = '', query = '' }: { text: string; query?: string } = $props();

	const segments = $derived(highlightSegments(text, query));
</script>

{#each segments as segment, i (i)}
	{#if segment.match}<mark class="rounded bg-amber-200/90 px-0.5 text-inherit dark:bg-amber-500/35">{segment.text}</mark>{:else}{segment.text}{/if}
{/each}
