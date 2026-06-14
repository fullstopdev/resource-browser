<script lang="ts">
	import {
		Controls,
		Panel,
		SvelteFlow,
		type Edge,
		type EdgeTypes,
		type Node,
		type NodeTypes
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import IntentTopologyEdge from './IntentTopologyEdge.svelte';
	import IntentTopologyFitView from './IntentTopologyFitView.svelte';
	import IntentTopologyInspect from './IntentTopologyInspect.svelte';
	import IntentTopologyLegend from './IntentTopologyLegend.svelte';
	import IntentTopologyNode from './IntentTopologyNode.svelte';
	import type { IntentTopologyNodeData } from './intentTopologyLayout';
	import type { GraphNode } from './types';

	let {
		nodes = $bindable<Node[]>([]),
		edges = $bindable<Edge[]>([]),
		layoutKey,
		themeMode,
		selectedNodeId = $bindable<string | null>(null),
		pathNodeIds = [],
		onRefocus,
		onViewCrd
	}: {
		nodes?: Node[];
		edges?: Edge[];
		layoutKey: string;
		themeMode: 'light' | 'dark';
		selectedNodeId?: string | null;
		pathNodeIds?: string[];
		onRefocus?: (id: string) => void;
		onViewCrd?: (node: GraphNode) => void;
	} = $props();

	let hostEl = $state<HTMLDivElement | null>(null);
	let flowWidth = $state(0);
	let flowHeight = $state(0);

	const nodeTypes: NodeTypes = { intentTopology: IntentTopologyNode };
	const edgeTypes: EdgeTypes = { intentTopology: IntentTopologyEdge };

	const FALLBACK_CANVAS_HEIGHT = 608;
	const FALLBACK_CANVAS_WIDTH = 960;

	const canvasWidth = $derived(flowWidth > 0 ? flowWidth : FALLBACK_CANVAS_WIDTH);
	const canvasHeight = $derived(flowHeight > 0 ? flowHeight : FALLBACK_CANVAS_HEIGHT);

	$effect(() => {
		const host = hostEl;
		if (!host) return;

		const updateSize = () => {
			const width = host.clientWidth;
			const height = host.clientHeight;
			flowWidth = width > 0 ? width : FALLBACK_CANVAS_WIDTH;
			flowHeight = height > 0 ? height : FALLBACK_CANVAS_HEIGHT;
		};

		updateSize();
		const observer = new ResizeObserver(updateSize);
		observer.observe(host);
		return () => observer.disconnect();
	});

	const selectedData = $derived(
		selectedNodeId
			? ((nodes.find((n) => n.id === selectedNodeId)?.data as IntentTopologyNodeData | undefined) ?? null)
			: null
	);

	const statsLabel = $derived(`${nodes.length} nodes · ${edges.length} links`);

	const DOUBLE_CLICK_MS = 400;
	let lastNodeClick: { id: string; time: number } | null = null;

	function handleNodeClick({ node }: { node: Node }) {
		const id = node.id;
		if (!id) return;

		const now = Date.now();
		if (lastNodeClick?.id === id && now - lastNodeClick.time < DOUBLE_CLICK_MS) {
			lastNodeClick = null;
			onRefocus?.(id);
			return;
		}

		lastNodeClick = { id, time: now };
		selectedNodeId = id;
	}

	function handlePaneClick() {
		selectedNodeId = null;
	}
</script>

<div class="intent-topo-flow-host" bind:this={hostEl}>
<SvelteFlow
	bind:nodes
	bind:edges
	{nodeTypes}
	{edgeTypes}
	width={canvasWidth}
	height={canvasHeight}
	fitView
	fitViewOptions={{ padding: 0.18, minZoom: 0.32, maxZoom: 1.02 }}
	minZoom={0.1}
	maxZoom={2}
	nodesDraggable
	nodesConnectable={false}
	elementsSelectable
	edgesFocusable={false}
	colorMode={themeMode === 'dark' ? 'dark' : 'light'}
	onnodeclick={handleNodeClick}
	onpaneclick={handlePaneClick}
	proOptions={{ hideAttribution: true }}
	class="intent-topo-flow-canvas"
>
	<Controls position="bottom-left" showInteractive={false} />

	<Panel position="top-left" class="dep-intent-flow-legend-panel">
		<IntentTopologyLegend {edges} themeMode={themeMode} />
	</Panel>

	{#if selectedData}
		<Panel position="top-right" class="dep-intent-flow-panel">
			<div class="dep-intent-flow-panel-toolbar">
				<span class="dep-intent-flow-chip">{statsLabel}</span>
			</div>

			<IntentTopologyInspect selected={selectedData} {onRefocus} {onViewCrd} />
		</Panel>
	{/if}

	<IntentTopologyFitView {layoutKey} flowHeight={canvasHeight} />
</SvelteFlow>
</div>

<style>
	.intent-topo-flow-host {
		display: flex;
		flex: 1;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-height: min(64vh, 38rem);
		font-family: var(--dep-font, 'NokiaPureText', ui-sans-serif, system-ui, sans-serif);
		background-color: var(--dep-bg);
		background-image: linear-gradient(
			180deg,
			var(--dep-canvas-top, var(--dep-panel)) 0%,
			var(--dep-canvas-bottom, var(--dep-bg)) 100%
		);
	}

	.intent-topo-flow-host :global(.svelte-flow) {
		flex: 1;
		width: 100%;
		min-height: 0;
		background: transparent !important;
	}

	:global(.dep-intent-flow-panel) {
		margin: 0.75rem !important;
		padding: 0.65rem 0.75rem 0.7rem !important;
		width: min(20rem, calc(100vw - 2rem)) !important;
		border: 1px solid var(--dep-panel-border) !important;
		border-radius: var(--dep-radius-lg, 0.625rem) !important;
		background: color-mix(in srgb, var(--dep-panel) 94%, var(--dep-bg)) !important;
		box-shadow: var(--dep-panel-shadow) !important;
		backdrop-filter: blur(8px);
		font-family: var(--dep-font, inherit);
	}

	:global(.dark .dep-intent-flow-panel) {
		box-shadow: none !important;
	}

	.dep-intent-flow-panel-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
		padding-bottom: 0.15rem;
		border-bottom: 1px solid color-mix(in srgb, var(--dep-panel-border) 70%, transparent);
		margin-bottom: 0.35rem;
	}

	:global(.dep-intent-flow-legend-panel) {
		margin: 0.75rem !important;
		padding: 0 !important;
		background: transparent !important;
		border: none !important;
		box-shadow: none !important;
	}

	.dep-intent-flow-chip {
		padding: 0.12rem 0.55rem;
		border: 1px solid color-mix(in srgb, var(--dep-panel-border) 80%, transparent);
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		color: var(--dep-text-muted);
		background: color-mix(in srgb, var(--dep-bg) 40%, var(--dep-panel));
	}

	/* Fix xyflow edge container — default is 0×0 which hides all edge paths */
	/* Edges render above nodes for visibility; disable hit targets so nodes stay clickable. */
	.intent-topo-flow-host :global(.svelte-flow__edges) {
		position: absolute !important;
		inset: 0 !important;
		width: 100% !important;
		height: 100% !important;
		overflow: visible !important;
		z-index: 20 !important;
		pointer-events: none !important;
	}

	.intent-topo-flow-host :global(.svelte-flow__nodes) {
		z-index: 10 !important;
	}

	.intent-topo-flow-host :global(.svelte-flow__node) {
		pointer-events: all !important;
	}

	.intent-topo-flow-host :global(.svelte-flow__edge-wrapper) {
		overflow: visible !important;
		pointer-events: none !important;
	}

	.intent-topo-flow-host :global(.svelte-flow__edge),
	.intent-topo-flow-host :global(.svelte-flow__edge-path),
	.intent-topo-flow-host :global(.svelte-flow__edge-interaction) {
		pointer-events: none !important;
	}

	.intent-topo-flow-host :global(.svelte-flow__edge-label) {
		display: none !important;
	}
</style>
