<script lang="ts">
  export let text: string = '';
</script>

{#if text}
  <code title={text} class="truncate whitespace-nowrap overflow-hidden block text-xs text-violet-900 dark:text-violet-300 bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded">{text}</code>
{/if}
