<script lang="ts">
	import type { Snippet } from 'svelte';
	import OpenApiDocViewer from '$lib/openapi/components/OpenApiDocViewer.svelte';
	import OpenApiSchemaGraphPanel from '$lib/openapi/components/OpenApiSchemaGraphPanel.svelte';
	import VendorExtensionsSection from '$lib/openapi/components/VendorExtensionsSection.svelte';
	import { sanitizeSpecForDisplay } from '$lib/openapi/sanitizeSpecForDisplay';
	import type { OpenApiOperation } from '$lib/openapi/pathBrowser';
	import { extractSpecLevelExtensions } from '$lib/openapi/vendorExtensions';
	import type { OpenApiDocView } from '$lib/openapi/swaggerUiConfig';

	interface Props {
		spec: Record<string, unknown>;
		specId?: string;
		darkMode?: boolean;
		activeTab?: OpenApiDocView;
		onTabChange?: (tab: OpenApiDocView) => void;
		highlightSchema?: string;
		focusOperationId?: string;
		onSchemaGraphNavigate?: (schemaName: string) => void;
		onShowInSchemaGraph?: (operation: OpenApiOperation) => void;
		onOperationNavigate?: (operationId: string) => void;
		resourcesReleaseFolder?: string;
		apiGraphUrl?: string;
		appsCatalog?: Snippet;
		/** The page can render the Paths / Schema graph switch itself (API Explorer head). */
		showTabs?: boolean;
	}

	let {
		spec,
		specId = '',
		darkMode = false,
		activeTab = $bindable('paths'),
		onTabChange,
		highlightSchema = '',
		focusOperationId = '',
		onSchemaGraphNavigate,
		onShowInSchemaGraph,
		onOperationNavigate,
		resourcesReleaseFolder = '',
		apiGraphUrl = '',
		appsCatalog,
		showTabs = true
	}: Props = $props();

	const sanitizedSpec = $derived(sanitizeSpecForDisplay(spec));
	const specLevelExtensions = $derived(extractSpecLevelExtensions(sanitizedSpec));

	function selectTab(tab: OpenApiDocView) {
		if (activeTab === tab) return;
		activeTab = tab;
		onTabChange?.(tab);
	}
</script>

<div class="oa-spec-panel oa-root">
	{#if specLevelExtensions.length > 0}
		<div class="oa-spec-panel__extensions">
			<VendorExtensionsSection
				extensions={specLevelExtensions}
				{darkMode}
				title="Document extensions"
			/>
		</div>
	{/if}

	<div class="oa-spec-panel__top" class:oa-spec-panel__top--empty={!showTabs && activeTab === 'paths'}>
		{#if appsCatalog && activeTab !== 'paths'}
			<div class="oa-spec-panel__apps">
				{@render appsCatalog()}
			</div>
		{/if}

		{#if showTabs}
		<div class="oa-spec-panel__tabs" role="tablist" aria-label="API reference sections">
			<button
				type="button"
				role="tab"
				aria-selected={activeTab === 'paths'}
				class="oa-spec-panel__tab"
				class:oa-spec-panel__tab--active={activeTab === 'paths'}
				onclick={() => selectTab('paths')}
			>
				Paths
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={activeTab === 'schemaGraph'}
				class="oa-spec-panel__tab"
				class:oa-spec-panel__tab--active={activeTab === 'schemaGraph'}
				onclick={() => selectTab('schemaGraph')}
			>
				Schema graph
			</button>
		</div>
		{/if}
	</div>

	<div class="oa-spec-panel__content" role="tabpanel">
		{#if activeTab === 'paths'}
			<OpenApiDocViewer
				{spec}
				{specId}
				{darkMode}
				onSchemaGraphNavigate={onSchemaGraphNavigate}
				{onShowInSchemaGraph}
				{appsCatalog}
			/>
		{:else}
			<OpenApiSchemaGraphPanel
				{spec}
				{darkMode}
				{resourcesReleaseFolder}
				{highlightSchema}
				{focusOperationId}
				{apiGraphUrl}
				{onOperationNavigate}
			/>
		{/if}
	</div>
</div>

<style>
	.oa-spec-panel__top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.625rem;
		margin-bottom: 0.875rem;
	}

	.oa-spec-panel__top--empty {
		display: none;
	}

	.oa-spec-panel__apps {
		flex: 0 1 20rem;
		min-width: min(100%, 14rem);
	}

	/* Compact segmented control (also used by the Explorer head). */
	.oa-spec-panel__tabs {
		display: inline-flex;
		gap: 0.125rem;
		padding: 0.1875rem;
		border: 1px solid var(--rb-line);
		border-radius: 0.5625rem;
		background: var(--rb-raised);
	}

	.oa-spec-panel__tab {
		padding: 0.375rem 0.875rem;
		border: 0;
		border-radius: 0.375rem;
		background: none;
		color: var(--rb-ink-3);
		font: 600 0.84rem var(--rb-font);
		cursor: pointer;
	}

	.oa-spec-panel__tab:hover {
		color: var(--rb-ink);
	}

	.oa-spec-panel__tab:focus-visible {
		outline: 2px solid var(--rb-signal);
		outline-offset: 1px;
	}

	.oa-spec-panel__tab--active {
		background: var(--rb-surface);
		color: var(--rb-ink);
		box-shadow: 0 1px 2px rgba(10, 20, 40, 0.12);
	}

	.oa-spec-panel__extensions {
		margin-bottom: 0.75rem;
	}
</style>
