<script lang="ts">
	import { browser } from '$app/environment';
	import type { Snippet } from 'svelte';
	import OpenApiPathBrowser from '$lib/openapi/components/OpenApiPathBrowser.svelte';
	import { sanitizeSpecForDisplay } from '$lib/openapi/sanitizeSpecForDisplay';
	import type { OpenApiOperation } from '$lib/openapi/pathBrowser';

	interface Props {
		spec: Record<string, unknown>;
		specId?: string;
		darkMode?: boolean;
		onSchemaGraphNavigate?: (schemaName: string) => void;
		onShowInSchemaGraph?: (operation: OpenApiOperation) => void;
		appsCatalog?: Snippet;
	}

	let {
		spec,
		specId = '',
		darkMode = false,
		onSchemaGraphNavigate,
		onShowInSchemaGraph,
		appsCatalog
	}: Props = $props();

	const sanitizedSpec = $derived(sanitizeSpecForDisplay(spec));

	let initialOperationId = $state('');

	$effect(() => {
		if (!browser) return;
		initialOperationId = window.location.hash.slice(1);
		const onHashChange = () => {
			initialOperationId = window.location.hash.slice(1);
		};
		window.addEventListener('hashchange', onHashChange);
		return () => window.removeEventListener('hashchange', onHashChange);
	});
</script>

<div class="openapi-doc-viewer" class:openapi-doc-viewer--dark={darkMode}>
	<OpenApiPathBrowser
		spec={sanitizedSpec}
		{specId}
		{darkMode}
		{initialOperationId}
		{onSchemaGraphNavigate}
		{onShowInSchemaGraph}
		{appsCatalog}
	/>
</div>

<style>
	.openapi-doc-viewer {
		min-height: min(68vh, 860px);
	}
</style>
