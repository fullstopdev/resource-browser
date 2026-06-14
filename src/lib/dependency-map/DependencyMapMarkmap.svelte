<script lang="ts">
	import { browser } from '$app/environment';
	import type { Edge, Node } from '@xyflow/svelte';
	import { untrack } from 'svelte';
	import { theme } from '$lib/theme';
	import { buildIntentTopologyLayout } from './intentTopologyLayout';
	import { MAP_DIRECTION } from './relationLabels';
	import { attachFocusEdgePorts, toFlowEdges } from './intentTopologyEdges';
	import { applyPathHighlightToFlow, flowHighlightsInSync } from './pathHighlight';
	import type { DependencyGraph, GraphNode, NodeType } from './types';

	let {
		graph,
		focusNodeId,
		depSearch = '',
		typeFilter = 'all' as 'all' | NodeType,
		showDependsOn = true,
		showRequiredBy = true,
		onSelect,
		onViewCrd,
		pathNodeIds = []
	}: {
		graph: DependencyGraph;
		focusNodeId: string;
		depSearch?: string;
		typeFilter?: 'all' | NodeType;
		showDependsOn?: boolean;
		showRequiredBy?: boolean;
		onSelect?: (id: string) => void;
		onViewCrd?: (node: GraphNode) => void;
		pathNodeIds?: string[];
	} = $props();

	let nodes = $state<Node[]>([]);
	let edges = $state<Edge[]>([]);
	let isEmpty = $state(true);
	let ready = $state(false);
	let layoutSignature = $state('');
	let selectedNodeId = $state<string | null>(null);
	let FlowComponent = $state<typeof import('./IntentTopologyFlow.svelte').default | null>(null);
	let flowLoadError = $state<string | null>(null);
	let selectionFocusKey = $state('');
	let flowModulePromise: Promise<typeof import('./IntentTopologyFlow.svelte').default> | null =
		null;

	function layoutInputSignature(): string {
		const linkSig = graph.links
			.map((l) => `${l.id}:${l.source}:${l.target}:${l.rel ?? ''}`)
			.sort()
			.join('|');
		return [
			focusNodeId,
			depSearch.trim(),
			typeFilter,
			showDependsOn,
			showRequiredBy,
			$theme,
			graph.nodes.length,
			linkSig,
			pathNodeIds.join('\0')
		].join('::');
	}

	function loadFlowComponent() {
		if (!flowModulePromise) {
			flowModulePromise = import('./IntentTopologyFlow.svelte').then((mod) => mod.default);
		}
		return flowModulePromise;
	}

	$effect(() => {
		if (!browser || FlowComponent) return;
		flowLoadError = null;
		void loadFlowComponent()
			.then((mod) => {
				FlowComponent = mod;
			})
			.catch((err: unknown) => {
				flowLoadError = err instanceof Error ? err.message : 'Failed to load map';
			});
	});

	function syncPathHighlight() {
		if (flowHighlightsInSync(nodes, edges, pathNodeIds, selectedNodeId)) return;
		const synced = applyPathHighlightToFlow(nodes, edges, pathNodeIds, selectedNodeId);
		nodes = synced.nodes.map((n) => ({
			...n,
			selected: n.id === selectedNodeId
		}));
		edges = synced.edges;
	}

	$effect(() => {
		if (!browser) return;

		const sig = layoutInputSignature();
		if (sig === layoutSignature && ready) return;

		const layout = buildIntentTopologyLayout(graph, focusNodeId, {
			depSearch,
			typeFilter,
			showDependsOn,
			showRequiredBy,
			themeMode: $theme,
			pathNodeIds
		});

		const wired = attachFocusEdgePorts(layout.nodes, layout.edges);
		const selection = untrack(() => selectedNodeId);

		nodes = wired.nodes.map((n) => ({
			...n,
			selected: n.id === selection
		}));
		edges = toFlowEdges(wired.edges, $theme);
		isEmpty = layout.isEmpty;
		layoutSignature = sig;
		ready = true;
	});

	$effect(() => {
		if (!browser || !ready) return;
		pathNodeIds.join('\0');
		selectedNodeId;
		if (untrack(() => layoutInputSignature()) !== layoutSignature) return;
		syncPathHighlight();
	});

	$effect(() => {
		const focus = focusNodeId;
		if (focus === selectionFocusKey) return;
		selectionFocusKey = focus;
		selectedNodeId = null;
	});

	function handleRefocus(id: string) {
		if (id === focusNodeId) return;
		selectedNodeId = null;
		onSelect?.(id);
	}
</script>

<div class="dep-intent-flow">
	{#if !browser || !ready || !FlowComponent}
		<div class="dep-intent-flow-loading" aria-busy="true" aria-label="Loading map">
			<span class="dep-intent-flow-loading-text">
				{#if flowLoadError}
					Could not load map — {flowLoadError}
				{:else}
					Loading map…
				{/if}
			</span>
		</div>
	{:else if isEmpty}
		<div class="dep-intent-flow-empty" aria-live="polite">
			<svg class="dep-intent-flow-empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
				/>
			</svg>
			<p class="dep-intent-flow-empty-title">No connected topology found</p>
			<p class="dep-intent-flow-empty-hint">
				{#if depSearch.trim()}
					No matches for your filter. Clear search to see direct neighbors.
				{:else if !showDependsOn && !showRequiredBy}
					Enable <strong>{MAP_DIRECTION.uses.label}</strong> or <strong>{MAP_DIRECTION.usedBy.label}</strong> in the toolbar.
				{:else}
					Pick a CRD with catalog or semantic intent edges, or adjust filters.
				{/if}
			</p>
		</div>
	{:else}
		<FlowComponent
			bind:nodes
			bind:edges
			bind:selectedNodeId
			layoutKey={layoutSignature}
			themeMode={$theme}
			{pathNodeIds}
			onRefocus={handleRefocus}
			{onViewCrd}
		/>
	{/if}
</div>

<style>
	.dep-intent-flow {
		display: flex;
		flex-direction: column;
		flex: 1;
		width: 100%;
		height: 100%;
		min-height: min(64vh, 38rem);
		font-family: var(--dep-font, inherit);
		color: var(--dep-text);
		background: var(--dep-panel);
		border-radius: var(--dep-radius, 0.5rem);
		border: 1px solid var(--dep-panel-border);
		box-shadow: var(--dep-panel-shadow, 0 1px 3px rgba(15, 23, 42, 0.04));
		overflow: hidden;
	}

	:global(.dark) .dep-intent-flow {
		box-shadow: none;
	}

	.dep-intent-flow :global(.intent-topo-flow-host) {
		flex: 1;
		width: 100%;
		height: 100%;
		min-height: inherit;
	}

	.dep-intent-flow :global(.svelte-flow) {
		width: 100%;
		height: 100%;
		min-height: inherit;
		background: var(--dep-bg) !important;
	}

	.dep-intent-flow :global(.svelte-flow__controls) {
		border: 1px solid var(--dep-panel-border);
		border-radius: var(--dep-radius-lg, 0.625rem);
		overflow: hidden;
		box-shadow: var(--dep-panel-shadow);
		backdrop-filter: blur(8px);
	}

	.dep-intent-flow :global(.svelte-flow__controls-button) {
		background: var(--dep-panel);
		border-bottom: 1px solid var(--dep-panel-border);
		color: var(--dep-text-muted);
	}

	.dep-intent-flow :global(.svelte-flow__controls-button:hover) {
		background: color-mix(in srgb, var(--dep-chip-active) 10%, var(--dep-panel));
		color: var(--dep-chip-active);
	}

	.dep-intent-flow :global(.svelte-flow__edges) {
		position: absolute !important;
		inset: 0 !important;
		width: 100% !important;
		height: 100% !important;
		overflow: visible !important;
		z-index: 20 !important;
		pointer-events: none !important;
	}

	.dep-intent-flow :global(.svelte-flow__nodes) {
		z-index: 10 !important;
	}

	.dep-intent-flow :global(.svelte-flow__node) {
		pointer-events: all !important;
	}

	.dep-intent-flow :global(.svelte-flow__edge-wrapper) {
		overflow: visible !important;
		pointer-events: none !important;
	}

	.dep-intent-flow :global(.svelte-flow__edge),
	.dep-intent-flow :global(.svelte-flow__edge-path),
	.dep-intent-flow :global(.svelte-flow__edge-interaction) {
		pointer-events: none !important;
	}

	.dep-intent-flow-loading,
	.dep-intent-flow-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		flex: 1;
		height: 100%;
		padding: 2rem 1.5rem;
		text-align: center;
	}

	.dep-intent-flow-loading-text {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--dep-text-muted);
	}

	.dep-intent-flow-empty-icon {
		width: 2.25rem;
		height: 2.25rem;
		color: var(--dep-text-muted);
		opacity: 0.65;
	}

	.dep-intent-flow-empty-title {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 700;
	}

	.dep-intent-flow-empty-hint {
		margin: 0;
		max-width: 22rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--dep-text-muted);
	}
</style>
