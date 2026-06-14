<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import type { IntentTopologyNodeData } from './intentTopologyLayout';

	let { data: rawData, selected }: NodeProps = $props();

	const data = $derived(rawData as IntentTopologyNodeData);

	const typeLabel = $derived(
		data.type === 'config' ? 'Config' : data.type === 'state' ? 'State' : 'Other'
	);
</script>

<div
	class="intent-topo-node"
	class:intent-topo-node-focus={data.isFocus}
	class:intent-topo-node-selected={selected}
	class:intent-topo-node-path={data.pathInBreadcrumb}
	data-role={data.role}
	style:--intent-status-color={data.statusColor}
	style:--intent-rel-color={data.relColor}
>
	{#if data.isFocus}
		<span class="intent-topo-node-rail" aria-hidden="true"></span>
	{:else}
		<span class="intent-topo-node-accent" aria-hidden="true"></span>
	{/if}

	{#if data.isFocus}
		{#each data.incomingPorts ?? [] as port (port.id)}
			<Handle
				type="target"
				id="in-{port.id}"
				position={Position.Left}
				style="top: {port.topPx}px; transform: translateY(-50%);"
				class="intent-topo-handle intent-topo-port-handle"
			/>
		{/each}
		{#each data.outgoingPorts ?? [] as port (port.id)}
			<Handle
				type="source"
				id="out-{port.id}"
				position={Position.Right}
				style="top: {port.topPx}px; transform: translateY(-50%);"
				class="intent-topo-handle intent-topo-port-handle"
			/>
		{/each}
	{:else}
		<Handle type="target" id="target" position={Position.Left} class="intent-topo-handle intent-topo-port-handle" />
		<Handle type="source" id="source" position={Position.Right} class="intent-topo-handle intent-topo-port-handle" />
	{/if}

	<div class="intent-topo-node-body">
		<div class="intent-topo-node-primary">
			<span class="intent-topo-node-chip intent-topo-node-chip-{data.type}">{typeLabel}</span>
			<span class="intent-topo-node-kind" title={data.kind}>{data.kind}</span>
		</div>
		<span class="intent-topo-node-api" title={data.resourceId}>{data.resourceId}</span>
	</div>
</div>

<style>
	.intent-topo-node {
		position: relative;
		box-sizing: border-box;
		display: flex;
		align-items: stretch;
		width: 18rem;
		min-width: 18rem;
		max-width: 18rem;
		height: 4.5rem;
		min-height: 4.5rem;
		max-height: 4.5rem;
		padding: 0 0.78rem 0 0.72rem;
		border: 1px solid color-mix(in srgb, var(--dep-panel-border) 88%, var(--intent-rel-color, transparent));
		border-radius: var(--dep-radius-lg, 0.625rem);
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--dep-panel) 98%, white) 0%,
			var(--dep-panel) 100%
		);
		box-shadow: var(--dep-node-shadow, 0 1px 2px rgba(15, 23, 42, 0.05));
		text-align: left;
		font-family: var(--dep-font, inherit);
		color: var(--dep-text);
		overflow: visible;
		cursor: pointer;
		transition:
			border-color 0.16s ease,
			box-shadow 0.16s ease,
			transform 0.16s ease,
			background 0.16s ease;
	}

	:global(.dark) .intent-topo-node {
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--dep-panel) 96%, white) 0%,
			var(--dep-panel) 100%
		);
	}

	.intent-topo-node:hover {
		border-color: color-mix(in srgb, var(--intent-rel-color, var(--dep-focus-ring, var(--dep-chip-active))) 38%, var(--dep-panel-border));
		box-shadow:
			var(
				--dep-node-shadow-hover,
				0 3px 10px rgba(15, 23, 42, 0.07),
				0 0 0 1px color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 8%, transparent)
			),
			0 0 0 1px color-mix(in srgb, var(--intent-rel-color, transparent) 12%, transparent);
		transform: translateY(-1px);
	}

	.intent-topo-node-accent {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 3px;
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--intent-rel-color, var(--dep-chip-active)) 88%, white),
			var(--intent-rel-color, var(--dep-chip-active))
		);
		border-radius: 0.625rem 0 0 0.625rem;
		opacity: 0.95;
		box-shadow: 1px 0 6px color-mix(in srgb, var(--intent-rel-color, transparent) 18%, transparent);
	}

	.intent-topo-node-rail {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 4px;
		background: var(--intent-status-color, var(--dep-chip-active));
		border-radius: 0.5625rem 0 0 0.5625rem;
	}

	.intent-topo-node-body {
		display: flex;
		flex: 1;
		flex-direction: column;
		justify-content: center;
		gap: 0.18rem;
		min-width: 0;
		padding: 0.48rem 0 0.48rem 0.42rem;
	}

	.intent-topo-node-primary {
		display: flex;
		align-items: center;
		gap: 0.38rem;
		min-width: 0;
	}

	.intent-topo-node-chip {
		flex-shrink: 0;
		padding: 0.1rem 0.46rem;
		border-radius: 9999px;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		line-height: 1.35;
		border: 1px solid transparent;
		box-shadow: inset 0 1px 0 color-mix(in srgb, white 24%, transparent);
	}

	.intent-topo-node-chip-config {
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--dep-config, #2563eb) 14%, var(--dep-panel)),
			color-mix(in srgb, var(--dep-config, #2563eb) 9%, var(--dep-panel))
		);
		color: var(--dep-config, #2563eb);
		border-color: color-mix(in srgb, var(--dep-config, #2563eb) 22%, var(--dep-panel-border));
	}

	.intent-topo-node-chip-state {
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--dep-state, #16a34a) 14%, var(--dep-panel)),
			color-mix(in srgb, var(--dep-state, #16a34a) 9%, var(--dep-panel))
		);
		color: var(--dep-state, #16a34a);
		border-color: color-mix(in srgb, var(--dep-state, #16a34a) 22%, var(--dep-panel-border));
	}

	.intent-topo-node-chip-other {
		background: color-mix(in srgb, var(--dep-text-muted) 10%, var(--dep-panel));
		color: var(--dep-text-muted);
		border-color: color-mix(in srgb, var(--dep-text-muted) 16%, var(--dep-panel-border));
	}

	:global(.dark) .intent-topo-node-chip-config {
		color: #60a5fa;
	}

	:global(.dark) .intent-topo-node-chip-state {
		color: #4ade80;
	}

	.intent-topo-node-kind {
		flex: 1;
		min-width: 0;
		font-size: 0.875rem;
		font-weight: 600;
		line-height: 1.25;
		letter-spacing: -0.015em;
		color: var(--dep-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.intent-topo-node-api {
		display: -webkit-box;
		padding-left: 0.06rem;
		font-family: var(--dep-font-code, ui-monospace, monospace);
		font-size: 0.625rem;
		font-weight: 500;
		line-height: 1.35;
		letter-spacing: 0;
		color: var(--dep-text-muted);
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		word-break: break-all;
		white-space: normal;
	}

	.intent-topo-node-focus {
		height: 4.5rem;
		min-height: 4.5rem;
		max-height: 4.5rem;
		border-color: color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 52%, var(--dep-panel-border));
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 7%, var(--dep-panel)) 0%,
			color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 3%, var(--dep-panel)) 100%
		);
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 22%, transparent),
			0 4px 16px color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 10%, transparent);
	}

	.intent-topo-node-focus .intent-topo-node-body {
		gap: 0.2rem;
	}

	.intent-topo-node-focus .intent-topo-node-kind {
		font-size: 0.9375rem;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.intent-topo-node-focus .intent-topo-node-api {
		font-size: 0.6875rem;
		color: color-mix(in srgb, var(--dep-text) 72%, var(--dep-text-muted));
	}

	.intent-topo-node-focus:hover {
		border-color: color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 58%, var(--dep-panel-border));
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 26%, transparent),
			0 6px 20px color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 16%, transparent);
	}

	.intent-topo-node-path {
		border-color: var(
			--dep-path-map-node-border,
			color-mix(in srgb, var(--dep-path-map-color, #f59e0b) 58%, var(--dep-panel-border))
		);
		background: linear-gradient(
			180deg,
			var(--dep-path-map-node-bg-top, var(--dep-panel)) 0%,
			var(--dep-path-map-node-bg-bottom, var(--dep-panel)) 100%
		);
		box-shadow: var(--dep-path-map-node-shadow);
	}

	.intent-topo-node-path:hover {
		border-color: color-mix(
			in srgb,
			var(--dep-path-map-color, #f59e0b) 64%,
			var(--dep-panel-border)
		);
		box-shadow:
			var(--dep-path-map-glow-spread),
			var(--dep-path-map-glow-halo);
	}

	.intent-topo-node-focus.intent-topo-node-path {
		border-color: color-mix(
			in srgb,
			var(--dep-path-map-color, #f59e0b) 70%,
			var(--dep-panel-border)
		);
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--dep-path-map-color, #f59e0b) 14%, var(--dep-panel)) 0%,
			color-mix(in srgb, var(--dep-path-map-color-bright, #fb923c) 8%, var(--dep-panel)) 100%
		);
		box-shadow: var(--dep-path-map-node-focus-shadow);
	}

	.intent-topo-node-focus.intent-topo-node-path:hover {
		border-color: color-mix(
			in srgb,
			var(--dep-path-map-color, #f59e0b) 74%,
			var(--dep-panel-border)
		);
		box-shadow: var(--dep-path-map-node-focus-shadow);
	}

	.intent-topo-node-path.intent-topo-node-selected {
		border-color: color-mix(
			in srgb,
			var(--dep-path-map-color, #f59e0b) 62%,
			var(--dep-panel-border)
		);
		box-shadow: var(--dep-path-map-node-shadow);
	}

	.intent-topo-node-selected {
		border-color: color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 48%, var(--dep-panel-border));
		box-shadow:
			0 0 0 3px color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 16%, transparent),
			0 4px 12px color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 10%, transparent);
	}

	:global(.intent-topo-handle),
	:global(.intent-topo-port-handle) {
		width: 1px !important;
		height: 1px !important;
		min-width: 0 !important;
		min-height: 0 !important;
		opacity: 0 !important;
		border: none !important;
		background: transparent !important;
		box-shadow: none !important;
		pointer-events: none;
	}
</style>
