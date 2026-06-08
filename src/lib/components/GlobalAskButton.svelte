<script lang="ts">
	import { openGlobalAsk } from '$lib/globalAsk';
	import EdaAiBrandIcon from '$lib/components/EdaAiBrandIcon.svelte';
</script>

<button
	type="button"
	class="global-ask-btn"
	title="Ask AI about CRDs, schemas, and EDA docs (Ctrl+K)"
	aria-label="Ask AI"
	onclick={() => openGlobalAsk()}
>
	<span class="global-ask-btn__icon-wrap" aria-hidden="true">
		<EdaAiBrandIcon size="sm" />
	</span>
	<span class="global-ask-btn__label">Ask AI</span>
	<kbd class="global-ask-btn__kbd" aria-hidden="true">⌘K</kbd>
</button>
