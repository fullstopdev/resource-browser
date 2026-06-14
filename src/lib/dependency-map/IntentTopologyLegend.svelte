<script lang="ts">
	import type { Edge } from '@xyflow/svelte';
	import { getGraphPalette } from './graphColors';
	import { relationsInFlowEdges } from './intentTopologyEdges';
	import { getRelationDescription, LEGEND_TITLE, relationDisplayLabel } from './relationLabels';

	let {
		edges,
		themeMode
	}: {
		edges: Edge[];
		themeMode: 'light' | 'dark';
	} = $props();

	const palette = $derived(getGraphPalette(themeMode));
	const activeRelations = $derived(relationsInFlowEdges(edges));
</script>

{#if activeRelations.length > 0}
	<div class="intent-topo-legend" aria-label="Link type colors">
		<span class="intent-topo-legend-title">{LEGEND_TITLE}</span>
		<ul class="intent-topo-legend-list">
			{#each activeRelations as rel (rel)}
				{@const label = relationDisplayLabel(rel, 'legend')}
				{@const description = getRelationDescription(rel)}
				<li
					class="intent-topo-legend-item"
					title={description}
					aria-label={description ? `${label}: ${description}` : label}
				>
					<span
						class="intent-topo-legend-swatch"
						style:background={palette.rel[rel]}
						style:box-shadow="0 0 0 1px color-mix(in srgb, {palette.rel[rel]} 35%, transparent)"
						aria-hidden="true"
					></span>
					<span class="intent-topo-legend-label">{label}</span>
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.intent-topo-legend {
		display: flex;
		flex-direction: column;
		gap: 0.28rem;
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: var(--dep-radius-lg, 0.625rem);
		background: color-mix(in srgb, var(--dep-panel) 94%, var(--dep-bg));
		box-shadow: var(--dep-panel-shadow);
		backdrop-filter: blur(8px);
		max-width: min(14rem, calc(100vw - 2rem));
		font-family: var(--dep-font, inherit);
	}

	:global(.dark) .intent-topo-legend {
		background: color-mix(in srgb, var(--dep-panel) 96%, transparent);
	}

	.intent-topo-legend-title {
		font-size: 0.5625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--dep-text-muted);
		line-height: 1;
	}

	.intent-topo-legend-list {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.2rem 0.55rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.intent-topo-legend-item {
		display: inline-flex;
		align-items: center;
		gap: 0.28rem;
		min-height: 0;
		padding: 0;
		border-radius: 0.2rem;
		cursor: default;
	}

	.intent-topo-legend-swatch {
		display: block;
		width: 0.875rem;
		height: 0.25rem;
		border-radius: 9999px;
		flex-shrink: 0;
	}

	.intent-topo-legend-label {
		font-size: 0.625rem;
		font-weight: 600;
		line-height: 1.15;
		color: var(--dep-text);
		white-space: nowrap;
	}
</style>
