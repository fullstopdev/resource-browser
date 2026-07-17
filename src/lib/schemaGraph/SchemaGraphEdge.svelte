<script lang="ts">
	import { getSmoothStepPath, Position } from '@xyflow/system';
	import { BaseEdge, EdgeLabel, type EdgeProps } from '@xyflow/svelte';
	import type { UnifiedGraphEdgeKind } from './unifiedApiGraph';

	type SchemaGraphEdgeData = {
		kind: UnifiedGraphEdgeKind;
		isBackEdge: boolean;
		color: string;
		viaProperty?: string;
		label?: string;
	};

	/** Wider radius + offset so orthogonal bends clear node cards. */
	const BORDER_RADIUS = 14;
	const STEP_OFFSET = 22;
	/** Lift labels off the stroke so they don't sit on the line. */
	const LABEL_Y_OFFSET = -14;

	let {
		id,
		sourceX,
		sourceY,
		targetX,
		targetY,
		markerEnd,
		data
	}: EdgeProps = $props();

	const edgeData = $derived(data as SchemaGraphEdgeData);
	const strokeColor = $derived(edgeData?.color || '#1d4ed8');

	const [path, labelX, labelY] = $derived(
		getSmoothStepPath({
			sourceX,
			sourceY,
			targetX,
			targetY,
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
			borderRadius: BORDER_RADIUS,
			offset: STEP_OFFSET
		})
	);

	const strokeWidth = $derived(
		edgeData?.isBackEdge ? 2.5 : edgeData?.kind === 'schema-ref' ? 3.25 : 3.4
	);
	const opacity = $derived(edgeData?.isBackEdge ? 0.62 : 1);
	const label = $derived(edgeData?.label ?? '');

	/** Never use stroke-dasharray: 0 — SVG treats it as an empty dash and hides the stroke. */
	const edgeStyle = $derived(
		edgeData?.isBackEdge
			? `stroke: ${strokeColor}; stroke-width: ${strokeWidth}px; fill: none; opacity: ${opacity}; stroke-dasharray: 6 6; --xy-edge-stroke: ${strokeColor}; --xy-edge-stroke-width: ${strokeWidth}px;`
			: `stroke: ${strokeColor}; stroke-width: ${strokeWidth}px; fill: none; opacity: ${opacity}; --xy-edge-stroke: ${strokeColor}; --xy-edge-stroke-width: ${strokeWidth}px;`
	);
</script>

<BaseEdge {id} {path} {markerEnd} style={edgeStyle} />
{#if label}
	<EdgeLabel x={labelX} y={labelY + LABEL_Y_OFFSET}>
		<span
			class="schema-graph-edge__label"
			class:schema-graph-edge__label--back={edgeData?.isBackEdge}
			class:schema-graph-edge__label--request={edgeData?.kind === 'request-body'}
			class:schema-graph-edge__label--response={edgeData?.kind === 'response'}
			class:schema-graph-edge__label--parameter={edgeData?.kind === 'parameter'}
		>
			{label}
		</span>
	</EdgeLabel>
{/if}

<style>
	:global(.schema-graph-edge__label) {
		display: inline-block;
		max-width: 9rem;
		padding: 0.12rem 0.4rem;
		border-radius: 0.3rem;
		background: color-mix(in srgb, var(--oa-panel, var(--dep-panel, #fff)) 94%, transparent);
		border: 1px solid
			color-mix(in srgb, var(--oa-panel-border, var(--dep-panel-border, #e2e8f0)) 75%, transparent);
		box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.6rem;
		font-weight: 600;
		color: var(--oa-text-muted, var(--dep-text-muted, #64748b));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		pointer-events: none;
	}

	:global(.schema-graph-edge__label--back) {
		opacity: 0.85;
		font-style: italic;
	}

	:global(.schema-graph-edge__label--request) {
		border-color: rgba(16, 185, 129, 0.45);
		color: #059669;
	}

	:global(.schema-graph-edge__label--response) {
		border-color: rgba(37, 99, 235, 0.45);
		color: #2563eb;
	}

	:global(.schema-graph-edge__label--parameter) {
		border-color: rgba(217, 119, 6, 0.45);
		color: #d97706;
	}
</style>
