<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import OpenApiMethodBadge from '$lib/openapi/components/OpenApiMethodBadge.svelte';
	import { SCHEMA_NODE_WIDTH_PX } from '$lib/schemaGraph/computeUnifiedGraphLayout';

	type SchemaGraphNodeData = {
		kind: 'path' | 'schema';
		name: string;
		label: string;
		isRecursive: boolean;
		isRoot?: boolean;
		method?: string;
		path?: string;
		operationId?: string;
		widthPx?: number;
		hint?: string;
	};

	let { data: rawData, selected }: NodeProps = $props();
	const data = $derived(rawData as SchemaGraphNodeData);
	const widthPx = $derived(data.widthPx ?? SCHEMA_NODE_WIDTH_PX);
</script>

<div
	class="schema-graph-node"
	class:schema-graph-node--selected={selected}
	class:schema-graph-node--recursive={data.isRecursive}
	class:schema-graph-node--path={data.kind === 'path'}
	class:schema-graph-node--root={data.isRoot}
	style:width="{widthPx}px"
	style:min-width="{widthPx}px"
	style:max-width="{widthPx}px"
	role="button"
	title={data.hint ?? (data.kind === 'path' ? data.path : data.name)}
>
	<span class="schema-graph-node__accent" aria-hidden="true"></span>

	<Handle type="target" id="target" position={Position.Left} class="schema-graph-node__handle" />
	<Handle type="source" id="source" position={Position.Right} class="schema-graph-node__handle" />

	{#if data.kind === 'path'}
		<div class="schema-graph-node__body">
			<div class="schema-graph-node__top">
				<span class="schema-graph-node__chip schema-graph-node__chip--path">Operation</span>
				{#if selected}
					<span class="schema-graph-node__chip schema-graph-node__chip--focus">Focused</span>
				{/if}
			</div>
			<div class="schema-graph-node__path">
				{#if data.method}
					<OpenApiMethodBadge method={data.method} compact />
				{/if}
				<div class="schema-graph-node__path-text">
					<span class="schema-graph-node__path-line" title={data.path}>{data.path}</span>
					{#if data.operationId}
						<span class="schema-graph-node__operation-id" title={data.operationId}>{data.operationId}</span>
					{/if}
				</div>
			</div>
		</div>
	{:else}
		<div class="schema-graph-node__body">
			<div class="schema-graph-node__top">
				<span class="schema-graph-node__chip">Schema</span>
				{#if data.isRoot}
					<span class="schema-graph-node__chip schema-graph-node__chip--root">Root</span>
				{/if}
				{#if data.isRecursive}
					<span class="schema-graph-node__badge" title="Recursive schema">Recursive</span>
				{/if}
			</div>
			<span class="schema-graph-node__name" title={data.name}>{data.name}</span>
		</div>
	{/if}
</div>

<style>
	:global(.schema-graph-node__handle) {
		width: 0.5rem;
		height: 0.5rem;
		border: 1px solid
			color-mix(in srgb, var(--oa-panel-border, var(--dep-panel-border, #e2e8f0)) 70%, transparent);
		background: var(--oa-panel, var(--dep-panel, #fff));
		opacity: 0.001;
	}

	.schema-graph-node {
		position: relative;
		min-height: 5rem;
		box-sizing: border-box;
		border: 1px solid var(--oa-panel-border, var(--dep-panel-border, rgba(226, 232, 240, 1)));
		border-radius: var(--oa-radius-lg, var(--dep-radius-lg, 0.625rem));
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--oa-panel, var(--dep-panel)) 96%, white) 0%,
			var(--oa-panel, var(--dep-panel)) 100%
		);
		box-shadow:
			var(--oa-node-shadow, var(--dep-node-shadow, 0 1px 2px rgba(15, 23, 42, 0.05))),
			0 0 0 1px color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 40%, transparent);
		padding: 0.72rem 0.9rem 0.72rem 1.05rem;
		display: flex;
		align-items: stretch;
		font-family: var(--oa-font, 'NokiaPureText', ui-sans-serif, system-ui, sans-serif);
		color: var(--oa-text, var(--dep-text, #0f172a));
		cursor: pointer;
		overflow: visible;
		transition:
			border-color 0.16s ease,
			box-shadow 0.16s ease,
			transform 0.16s ease;
	}

	.schema-graph-node__accent {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 3.5px;
		border-radius: var(--oa-radius-lg, 0.625rem) 0 0 var(--oa-radius-lg, 0.625rem);
		background: color-mix(in srgb, var(--oa-link-ref, #6366f1) 78%, transparent);
	}

	.schema-graph-node--path .schema-graph-node__accent {
		background: color-mix(in srgb, var(--oa-focus-ring, var(--dep-focus-ring, #2563eb)) 82%, transparent);
		width: 4px;
	}

	.schema-graph-node--root .schema-graph-node__accent {
		background: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 88%, transparent);
		width: 4px;
	}

	.schema-graph-node--path {
		min-height: 5.25rem;
		border-color: color-mix(
			in srgb,
			var(--oa-focus-ring, var(--dep-focus-ring, #2563eb)) 28%,
			var(--oa-panel-border, var(--dep-panel-border, #e2e8f0))
		);
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--oa-focus-ring, #2563eb) 5%, var(--oa-panel, #fff)) 0%,
			var(--oa-panel, var(--dep-panel)) 100%
		);
	}

	:global(.dark) .schema-graph-node {
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--oa-panel, var(--dep-panel)) 92%, white) 0%,
			var(--oa-panel, var(--dep-panel)) 100%
		);
	}

	.schema-graph-node:hover {
		transform: translateY(-1px);
		border-color: color-mix(
			in srgb,
			var(--oa-focus-ring, var(--dep-focus-ring, #2563eb)) 42%,
			var(--oa-panel-border, var(--dep-panel-border, #e2e8f0))
		);
		box-shadow: var(
			--oa-node-shadow-hover,
			var(--dep-node-shadow-hover, 0 3px 10px rgba(15, 23, 42, 0.07))
		);
	}

	.schema-graph-node--selected {
		border-color: color-mix(
			in srgb,
			var(--oa-focus-ring, var(--dep-focus-ring, #2563eb)) 78%,
			var(--oa-panel-border, var(--dep-panel-border, #e2e8f0))
		);
		box-shadow:
			0 0 0 2px color-mix(in srgb, var(--oa-focus-ring, var(--dep-focus-ring, #2563eb)) 28%, transparent),
			0 6px 18px color-mix(in srgb, var(--oa-focus-ring, var(--dep-focus-ring, #2563eb)) 16%, transparent);
	}

	.schema-graph-node__body {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.4rem;
		min-width: 0;
		width: 100%;
	}

	.schema-graph-node__top,
	.schema-graph-node__path {
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		gap: 0.45rem;
		min-width: 0;
		width: 100%;
	}

	.schema-graph-node__path-text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.schema-graph-node__path-line {
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: -0.01em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.schema-graph-node__operation-id {
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.68rem;
		color: var(--oa-text-muted, var(--dep-text-muted, #64748b));
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.schema-graph-node__chip {
		flex: 0 0 auto;
		padding: 0.16rem 0.48rem;
		border-radius: 0.3rem;
		font-family: var(--oa-font, 'NokiaPureText', ui-sans-serif, system-ui, sans-serif);
		font-size: 0.58rem;
		font-weight: 750;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		background: color-mix(in srgb, var(--oa-link-ref, #6366f1) 11%, transparent);
		border: 1px solid color-mix(in srgb, var(--oa-link-ref, #6366f1) 26%, transparent);
		color: var(--oa-link-ref, #6366f1);
		line-height: 1.2;
	}

	.schema-graph-node__chip--path {
		background: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 12%, transparent);
		border-color: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 32%, transparent);
		color: var(--oa-focus-ring, #2563eb);
	}

	.schema-graph-node__chip--focus {
		background: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 18%, transparent);
		border-color: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 45%, transparent);
		color: var(--oa-focus-ring, #2563eb);
	}

	.schema-graph-node__chip--root {
		background: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 14%, transparent);
		border-color: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 35%, transparent);
		color: var(--oa-focus-ring, #2563eb);
	}

	.schema-graph-node__name {
		font-size: 0.9rem;
		font-weight: 700;
		letter-spacing: -0.015em;
		line-height: 1.3;
		white-space: normal;
		overflow-wrap: anywhere;
		word-break: break-word;
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
	}

	.schema-graph-node__badge {
		flex: 0 0 auto;
		margin-left: auto;
		padding: 0.14rem 0.48rem;
		border-radius: 9999px;
		font-size: 0.62rem;
		font-weight: 750;
		letter-spacing: 0.01em;
		background: rgba(251, 191, 36, 0.15);
		border: 1px solid rgba(251, 191, 36, 0.45);
		color: #d97706;
	}

	:global(.dark) .schema-graph-node__badge {
		background: rgba(251, 191, 36, 0.14);
		border-color: rgba(251, 191, 36, 0.36);
		color: #fbbf24;
	}
</style>
