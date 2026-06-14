<script lang="ts">
	import { getSmoothStepPath, Position } from '@xyflow/system';
	import { BaseEdge, type EdgeProps } from '@xyflow/svelte';
	import type { IntentTopologyEdgeData } from './intentTopologyEdges';

	/** Tuned for aligned focus ports — avoids the vertical bus trunk on fan-in. */
	const BORDER_RADIUS = 10;
	const STEP_OFFSET = 18;

	let {
		id,
		interactionWidth,
		markerEnd,
		markerStart,
		sourceX,
		sourceY,
		targetX,
		targetY,
		data,
		selected
	}: EdgeProps = $props();

	const edgeData = $derived(data as IntentTopologyEdgeData);
	const relColor = $derived(edgeData?.color ?? '#2563eb');
	const pathHighlighted = $derived(Boolean(edgeData?.pathHighlighted));
	const highlighted = $derived(Boolean(edgeData?.highlighted || selected));
	const dimmed = $derived(Boolean(edgeData?.dimmed && !pathHighlighted && !highlighted));
	const strokeColor = $derived(
		pathHighlighted ? 'var(--dep-path-map-color, #f59e0b)' : relColor
	);

	let [path] = $derived(
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
		pathHighlighted ? 3.75 : highlighted ? 2.75 : 2.15
	);
	const opacity = $derived(
		dimmed ? 'var(--dep-edge-dim, 0.55)' : pathHighlighted || highlighted ? 1 : 0.92
	);
	const glow = $derived(
		pathHighlighted
			? 'drop-shadow(0 0 8px color-mix(in srgb, var(--dep-path-map-color, #f59e0b) 38%, transparent)) drop-shadow(0 0 3px color-mix(in srgb, var(--dep-path-map-color-bright, #fb923c) 28%, transparent))'
			: highlighted
				? `drop-shadow(0 1px 2px color-mix(in srgb, ${relColor} 22%, transparent))`
				: 'none'
	);

	const edgeStyle = $derived(
		`stroke: ${strokeColor}; stroke-width: ${strokeWidth}px; fill: none; opacity: ${opacity}; filter: ${glow}; --xy-edge-stroke: ${strokeColor}; --xy-edge-stroke-width: ${strokeWidth}px; transition: stroke-width 0.18s ease, opacity 0.18s ease, filter 0.18s ease;`
	);
</script>

<BaseEdge {id} {path} {markerStart} {markerEnd} {interactionWidth} style={edgeStyle} />
