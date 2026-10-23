<script lang="ts">
	import DocsArticle from '$lib/docs/components/DocsArticle.svelte';

	let { data } = $props();
</script>

<DocsArticle {data} />
