<script lang="ts">
	import DependencyMapMarkmap from './DependencyMapMarkmap.svelte';
	import { applyEdgeSourceFilter } from './graphFilters';
	import { isMapTopologyLink, isTopologyLayoutLink } from './markmapMarkdown';
	import { MAP_DIRECTION } from './relationLabels';
	import type { DependencyGraph, GraphNode, NodeType } from './types';

	export let graph: DependencyGraph;
	export let fullGraph: DependencyGraph | null = null;
	export let focusNodeId: string | null = null;
	export let onViewCrd: ((node: GraphNode) => void) | undefined = undefined;
	export let onRefocus: ((nodeId: string) => void) | undefined = undefined;
	export let breadcrumbTrail: Array<{ id: string; label: string }> = [];
	export let onBreadcrumbNavigate: ((nodeId: string) => void) | undefined = undefined;
	export let focusKind = '';
	export let focusResourceName = '';

	let depSearch = '';
	let typeFilter: 'all' | NodeType = 'all';
	let showDependsOn = true;
	let showRequiredBy = true;

	$: overviewGraph = fullGraph ?? graph;
	$: overviewLinks = applyEdgeSourceFilter(overviewGraph.links, false);
	$: topologyLayoutLinks = overviewLinks.filter(isTopologyLayoutLink);
	$: markmapGraph =
		topologyLayoutLinks.length === overviewLinks.length
			? overviewGraph
			: { ...overviewGraph, links: topologyLayoutLinks };
	$: topologyEdgeCount = topologyLayoutLinks.length;
	$: layoutStatLabel =
		!focusNodeId
			? ''
			: [
					showDependsOn && MAP_DIRECTION.uses.statLabel,
					showRequiredBy && MAP_DIRECTION.usedBy.statLabel
				]
					.filter(Boolean)
					.join(' · ');

	$: focusCoverage =
		focusNodeId && graph.crdCoverage?.[focusNodeId]
			? graph.crdCoverage[focusNodeId]
			: null;
	$: focusCoverageLabel = focusCoverage
		? `${focusCoverage.matched}/${focusCoverage.total} reference fields mapped`
		: null;

	$: pathNodeIds = breadcrumbTrail.map((crumb) => crumb.id);

	function handleDepClick(id: string) {
		if (focusNodeId && id !== focusNodeId) {
			onRefocus?.(id);
		}
	}

	function toggleDependsOn() {
		if (showDependsOn && !showRequiredBy) return;
		showDependsOn = !showDependsOn;
	}

	function toggleRequiredBy() {
		if (showRequiredBy && !showDependsOn) return;
		showRequiredBy = !showRequiredBy;
	}
</script>

<div class="dep-map-root dep-map-root--map-active">
	{#if focusNodeId && (focusKind || focusResourceName)}
		<div class="dep-map-focus-banner" aria-label="Focused resource">
			<div class="dep-map-focus-banner-badge" aria-hidden="true">
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
				</svg>
			</div>
			<div class="dep-map-focus-banner-body">
				<span class="dep-map-focus-banner-label">Map focus</span>
				<div class="dep-map-focus-banner-main">
					{#if focusKind}
						<span class="dep-map-focus-banner-kind">{focusKind}</span>
					{/if}
					{#if focusResourceName}
						<span class="dep-map-focus-banner-name" title={focusResourceName}>{focusResourceName}</span>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	{#if breadcrumbTrail.length > 1}
		<nav class="dep-map-pathbar" aria-label="Focus navigation path">
			<span class="dep-map-pathbar-label">Path</span>
			<ol class="dep-map-pathbar-trail">
				{#each breadcrumbTrail as crumb, i}
					<li class="dep-map-pathbar-step">
						{#if i > 0}
							<span class="dep-map-pathbar-chevron" aria-hidden="true">
								<svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M6 4l4 4-4 4" />
								</svg>
							</span>
						{/if}
						{#if i < breadcrumbTrail.length - 1}
							<button
								type="button"
								class="dep-map-pathbar-pill dep-map-pathbar-pill--ancestor"
								onclick={() => onBreadcrumbNavigate?.(crumb.id)}
								title="Refocus {crumb.label}"
							>
								{crumb.label}
							</button>
						{:else}
							<span class="dep-map-pathbar-pill dep-map-pathbar-pill--current" aria-current="page">
								{crumb.label}
							</span>
						{/if}
					</li>
				{/each}
			</ol>
		</nav>
	{/if}

	<div class="dep-map-toolbar" role="toolbar" aria-label="Dependency map controls">
		<div class="dep-map-toolbar-row">
			<label class="dep-map-search-wrap">
				<span class="sr-only">Filter dependencies</span>
				<svg class="dep-map-search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
				</svg>
				<input
					type="search"
					class="dep-map-search"
					placeholder="Filter dependencies…"
					bind:value={depSearch}
					aria-label="Filter dependencies"
				/>
			</label>

			<div class="dep-map-chips" role="group" aria-label="Node type filter">
				{#each ['all', 'config', 'state'] as chip}
					<button
						type="button"
						class="dep-map-chip"
						class:dep-map-chip-active={typeFilter === chip}
						onclick={() => (typeFilter = chip as typeof typeFilter)}
					>
						{chip === 'all' ? 'All types' : chip === 'config' ? 'Config' : 'State'}
					</button>
				{/each}
			</div>

			<div class="dep-map-direction-chips" role="group" aria-label="Relationship direction filter">
				<button
					type="button"
					class="dep-map-chip dep-map-chip-direction dep-map-chip-direction-out"
					class:dep-map-chip-active={showDependsOn}
					aria-pressed={showDependsOn}
					onclick={toggleDependsOn}
					title={MAP_DIRECTION.uses.title}
				>
					{MAP_DIRECTION.uses.label}
				</button>
				<button
					type="button"
					class="dep-map-chip dep-map-chip-direction dep-map-chip-direction-in"
					class:dep-map-chip-active={showRequiredBy}
					aria-pressed={showRequiredBy}
					onclick={toggleRequiredBy}
					title={MAP_DIRECTION.usedBy.title}
				>
					{MAP_DIRECTION.usedBy.label}
				</button>
			</div>
		</div>

		<div class="dep-map-toolbar-row dep-map-toolbar-actions">
			<span class="dep-map-stat" aria-live="polite">
				{#if layoutStatLabel}
					{layoutStatLabel} · {topologyEdgeCount} links
				{:else}
					{topologyEdgeCount} links
				{/if}
				{#if focusCoverageLabel}
					<span class="dep-map-coverage-chip" title="OpenAPI reference-field extraction coverage for focus CRD">
						{focusCoverageLabel}
					</span>
				{:else if graph.coverage}
					<span class="dep-map-coverage-chip dep-map-coverage-chip--global" title="Corpus-wide reference-field match rate">
						{Math.round(graph.coverage.rate * 100)}% corpus coverage
					</span>
				{/if}
			</span>
		</div>
	</div>

	{#if focusNodeId}
		<div class="dep-map-markmap-view dep-map-markmap-view--active">
			<DependencyMapMarkmap
				graph={markmapGraph}
				focusNodeId={focusNodeId}
				{depSearch}
				{typeFilter}
				{showDependsOn}
				{showRequiredBy}
				{pathNodeIds}
				onSelect={handleDepClick}
				{onViewCrd}
			/>
		</div>
	{/if}
</div>

<style>
	.dep-map-focus-banner {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
		border: 1px solid color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 32%, var(--dep-panel-border));
		border-radius: var(--dep-radius, 0.5rem);
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 7%, var(--dep-panel)) 0%,
			var(--dep-panel) 100%
		);
		box-shadow: var(--dep-panel-shadow, 0 1px 3px rgba(15, 23, 42, 0.05));
		font-family: var(--dep-font, inherit);
	}

	.dep-map-focus-banner-badge {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 2rem;
		height: 2rem;
		border-radius: 0.45rem;
		background: color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 14%, var(--dep-panel));
		color: var(--dep-focus-ring, var(--dep-chip-active));
	}

	.dep-map-focus-banner-badge svg {
		width: 1.1rem;
		height: 1.1rem;
	}

	.dep-map-focus-banner-body {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	:global(.dark) .dep-map-focus-banner {
		box-shadow: none;
	}

	.dep-map-focus-banner-label {
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--dep-text-muted);
		flex-shrink: 0;
	}

	.dep-map-focus-banner-main {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.35rem 0.55rem;
		min-width: 0;
	}

	.dep-map-focus-banner-kind {
		font-size: 1rem;
		font-weight: 800;
		line-height: 1.2;
		color: var(--dep-text);
		letter-spacing: -0.02em;
	}

	.dep-map-focus-banner-name {
		font-family: var(--dep-font-code, ui-monospace, monospace);
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--dep-text-muted);
		word-break: break-all;
	}

	.dep-map-pathbar {
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		gap: 0.5rem 0.625rem;
		padding: 0.5rem 0.625rem;
		border: 1px solid color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 28%, var(--dep-panel-border));
		border-radius: var(--dep-radius-lg, 0.625rem);
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 8%, var(--dep-panel)) 0%,
			color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 3%, var(--dep-panel)) 55%,
			var(--dep-panel) 100%
		);
		box-shadow: var(--dep-panel-shadow, 0 1px 2px rgba(15, 23, 42, 0.04));
		font-family: var(--dep-font, inherit);
		min-width: 0;
	}

	:global(.dark) .dep-map-pathbar {
		box-shadow: none;
	}

	.dep-map-pathbar-label {
		flex-shrink: 0;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: var(--dep-focus-ring, var(--dep-chip-active));
	}

	.dep-map-pathbar-trail {
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		gap: 0.2rem 0.15rem;
		margin: 0;
		padding: 0.1rem 0;
		list-style: none;
		min-width: 0;
		flex: 1 1 auto;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		scrollbar-width: thin;
	}

	.dep-map-pathbar-trail::-webkit-scrollbar {
		height: 0.35rem;
	}

	.dep-map-pathbar-trail::-webkit-scrollbar-thumb {
		border-radius: 9999px;
		background: color-mix(in srgb, var(--dep-text-muted) 35%, transparent);
	}

	.dep-map-pathbar-step {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		min-width: 0;
		flex-shrink: 0;
	}

	.dep-map-pathbar-chevron {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 0.85rem;
		height: 0.85rem;
		color: color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 52%, var(--dep-text-muted));
		opacity: 0.88;
		flex-shrink: 0;
	}

	.dep-map-pathbar-chevron svg {
		width: 100%;
		height: 100%;
	}

	.dep-map-pathbar-pill {
		display: inline-flex;
		align-items: center;
		max-width: 100%;
		padding: 0.25rem 0.625rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1.25;
		letter-spacing: -0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition:
			background 0.15s ease,
			border-color 0.15s ease,
			color 0.15s ease,
			box-shadow 0.15s ease,
			transform 0.15s ease;
	}

	.dep-map-pathbar-pill--ancestor {
		border: 1px solid var(--dep-path-pill-ancestor-border, var(--dep-panel-border));
		background: var(--dep-path-pill-ancestor-bg, var(--dep-panel));
		color: var(--dep-path-pill-ancestor-text, var(--dep-text-muted));
		box-shadow: var(--dep-path-pill-ancestor-shadow, none);
		cursor: pointer;
	}

	.dep-map-pathbar-pill--ancestor:hover {
		border-color: var(--dep-path-pill-ancestor-hover-border, var(--dep-panel-border));
		background: var(--dep-path-pill-ancestor-hover-bg, var(--dep-panel));
		color: var(--dep-path-pill-ancestor-hover-text, var(--dep-focus-ring, var(--dep-chip-active)));
		box-shadow: var(--dep-path-pill-ancestor-hover-shadow, none);
		transform: translateY(-1px);
	}

	.dep-map-pathbar-pill--current {
		border: 1px solid var(--dep-path-pill-current-border, var(--dep-panel-border));
		background: linear-gradient(
			180deg,
			var(--dep-path-pill-current-bg-top, var(--dep-panel)),
			var(--dep-path-pill-current-bg-bottom, var(--dep-panel))
		);
		color: var(--dep-path-pill-current-text, var(--dep-text));
		font-weight: 700;
		box-shadow: var(--dep-path-pill-current-shadow, none);
	}

	.dep-map-markmap-view {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		padding: 0;
	}

	.dep-map-markmap-view--active {
		flex: 1;
		min-height: min(64vh, 38rem);
	}

	.dep-map-root--map-active {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		gap: 0.5rem;
	}

	.dep-map-root--map-active .dep-map-toolbar {
		flex-shrink: 0;
	}

	.dep-map-root--map-active .dep-map-markmap-view--active {
		flex: 1;
		min-height: 0;
	}

	.dep-map-root {
		display: flex;
		flex-direction: column;
		width: 100%;
		flex: 1;
		min-height: 0;
		gap: 0.5rem;
		font-family: var(--dep-font, inherit);
		color: var(--dep-text);
	}

	.dep-map-toolbar {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: var(--dep-radius, 0.5rem);
		background: var(--dep-panel);
		box-shadow: var(--dep-panel-shadow, 0 1px 2px rgba(15, 23, 42, 0.04));
		font-family: var(--dep-font, inherit);
	}

	:global(.dark) .dep-map-toolbar {
		box-shadow: none;
	}

	.dep-map-toolbar-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.dep-map-toolbar-actions {
		justify-content: space-between;
	}

	.dep-map-search-wrap {
		position: relative;
		flex: 1 1 12rem;
		min-width: 10rem;
	}

	.dep-map-search-icon {
		position: absolute;
		left: 0.65rem;
		top: 50%;
		transform: translateY(-50%);
		width: 1rem;
		height: 1rem;
		color: var(--dep-text-muted);
		pointer-events: none;
	}

	.dep-map-search {
		width: 100%;
		min-height: 2.25rem;
		padding: 0.375rem 0.7rem 0.375rem 2.15rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: var(--dep-radius-sm, 0.375rem);
		background: var(--dep-panel);
		color: var(--dep-text);
		font-family: var(--dep-font, inherit);
		font-size: 0.8125rem;
		transition: border-color 0.15s ease, box-shadow 0.15s ease;
	}

	.dep-map-search::placeholder {
		color: var(--dep-text-muted);
		opacity: 0.75;
	}

	.dep-map-search:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 45%, var(--dep-panel-border));
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 18%, transparent);
	}

	.dep-map-chips {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.2rem;
		padding: 0.15rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: 9999px;
		background: color-mix(in srgb, var(--dep-bg) 50%, var(--dep-panel));
	}

	.dep-map-chip {
		padding: 0.3rem 0.6rem;
		border: 1px solid transparent;
		border-radius: 9999px;
		background: transparent;
		color: var(--dep-text-muted);
		font-size: 0.6875rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
	}

	.dep-map-chip:hover:not(.dep-map-chip-active) {
		color: var(--dep-text);
		background: color-mix(in srgb, var(--dep-chip-inactive) 50%, transparent);
	}

	.dep-map-chip-active {
		background: var(--dep-chip-active);
		border-color: var(--dep-chip-active);
		color: #fff;
		box-shadow: 0 1px 2px color-mix(in srgb, var(--dep-chip-active) 25%, transparent);
	}

	.dep-map-direction-chips {
		display: inline-flex;
		flex-wrap: nowrap;
		margin-left: auto;
		padding: 0.15rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: 9999px;
		background: color-mix(in srgb, var(--dep-bg) 50%, var(--dep-panel));
		gap: 0;
	}

	.dep-map-direction-chips .dep-map-chip-direction {
		border-radius: 9999px;
		padding: 0.32rem 0.72rem;
		font-size: 0.6875rem;
		font-weight: 650;
		letter-spacing: 0.01em;
	}

	.dep-map-direction-chips .dep-map-chip-direction:not(.dep-map-chip-active) {
		color: var(--dep-text-muted);
	}

	.dep-map-direction-chips .dep-map-chip-direction-out.dep-map-chip-active {
		background: var(--dep-link-out, #4f46e5);
		border-color: var(--dep-link-out, #4f46e5);
	}

	.dep-map-direction-chips .dep-map-chip-direction-in.dep-map-chip-active {
		background: var(--dep-link-in, #059669);
		border-color: var(--dep-link-in, #059669);
	}

	.dep-map-stat {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.6875rem;
		font-weight: 500;
		letter-spacing: 0.01em;
		color: var(--dep-text-muted);
	}

	.dep-map-coverage-chip {
		padding: 0.12rem 0.45rem;
		border-radius: 9999px;
		border: 1px solid color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 30%, var(--dep-panel-border));
		background: color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 8%, var(--dep-panel));
		color: var(--dep-focus-ring, var(--dep-chip-active));
		font-size: 0.625rem;
		font-weight: 650;
		letter-spacing: 0.02em;
	}

	.dep-map-coverage-chip--global {
		border-color: var(--dep-panel-border);
		background: var(--dep-bg);
		color: var(--dep-text-muted);
		font-weight: 600;
	}
</style>
