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
		appsCatalog
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

	<div class="oa-spec-panel__top">
		{#if appsCatalog && activeTab !== 'paths'}
			<div class="oa-spec-panel__apps">
				{@render appsCatalog()}
			</div>
		{/if}

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
				Schema Graph
			</button>
		</div>
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

	.oa-spec-panel__apps {
		flex: 0 1 16rem;
		min-width: min(100%, 11rem);
	}

	.oa-spec-panel__tabs {
		flex: 1 1 16rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem;
		margin-bottom: 0;
		border-radius: var(--oa-radius-lg);
		padding: 0.2rem;
		border: 1px solid var(--oa-panel-border);
		background: color-mix(in srgb, var(--oa-bg) 70%, var(--oa-panel));
		box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 35%, transparent);
	}

	.oa-spec-panel__tab {
		position: relative;
		flex: 1 1 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		min-height: 2.35rem;
		padding: 0.45rem 0.85rem;
		border: none;
		border-radius: var(--oa-radius);
		background: transparent;
		color: var(--oa-text-muted);
		font-family: inherit;
		font-size: 0.8125rem;
		font-weight: 650;
		cursor: pointer;
		transition:
			background 0.12s ease,
			color 0.12s ease,
			box-shadow 0.12s ease;
	}

	.oa-spec-panel__tab:hover {
		color: var(--oa-text);
		background: color-mix(in srgb, var(--oa-focus-ring) 8%, transparent);
	}

	.oa-spec-panel__tab:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--oa-focus-ring) 30%, transparent);
	}

	.oa-spec-panel__tab--active {
		background: var(--oa-chip-active);
		color: #fff;
		box-shadow:
			0 1px 2px color-mix(in srgb, var(--oa-chip-active) 40%, transparent),
			inset 0 -1px 0 rgba(15, 23, 42, 0.12);
		font-weight: 750;
	}

	.oa-spec-panel__tab--active:hover {
		background: color-mix(in srgb, var(--oa-chip-active) 88%, #000);
		color: #fff;
	}

	:global(.dark) .oa-spec-panel__tab--active {
		background: var(--oa-chip-active);
		color: #0f172a;
		box-shadow:
			0 1px 3px color-mix(in srgb, var(--oa-chip-active) 45%, transparent),
			inset 0 -1px 0 rgba(15, 23, 42, 0.2);
	}

	:global(.dark) .oa-spec-panel__tab--active:hover {
		background: color-mix(in srgb, var(--oa-chip-active) 85%, #fff);
		color: #0f172a;
	}

	.oa-spec-panel__content {
		min-height: min(68vh, 860px);
	}

	.oa-spec-panel__extensions {
		margin-bottom: 0.75rem;
	}
</style>
