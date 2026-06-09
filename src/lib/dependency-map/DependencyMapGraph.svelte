<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { theme } from '$lib/theme';
	import DependencyMapOverview from './DependencyMapOverview.svelte';
	import { getGraphPalette, LEGEND_REL_ORDER, REL_LABELS, REL_ORDER } from './graphColors';
	import { applyDirectionFilter, applyEdgeSourceFilter } from './graphFilters';
	import {
		buildTransitiveDepList,
		getHighlightSets,
		linkEndpointId,
		type ChainMode,
		type TransitiveDepEntry
	} from './transitiveClosure';
	import type { DependencyGraph, GraphNode, LinkRelation, NodeType } from './types';
	import { collapseVisualLinks } from './visualLinks';

	type GraphController = import('./graphController').GraphController;

	export let graph: DependencyGraph;
	export let fullGraph: DependencyGraph | null = null;
	export let focusNodeId: string | null = null;
	export let showTransitive = false;
	export let showInferredEdges = false;
	export let onViewCrd: ((node: GraphNode) => void) | undefined = undefined;
	export let onRefocus: ((nodeId: string) => void) | undefined = undefined;
	export let breadcrumbTrail: Array<{ id: string; label: string }> = [];
	export let onBreadcrumbNavigate: ((nodeId: string) => void) | undefined = undefined;

	type ViewMode = 'overview' | 'graph';

	const INSPECTOR_STORAGE_KEY = 'dep-map-inspector-open';
	const VIEW_STORAGE_KEY = 'dep-map-view-mode';
	const DENSE_LABEL_THRESHOLD = 10;

	let containerEl: HTMLDivElement;
	let svgEl: SVGSVGElement;
	let tooltipEl: HTMLDivElement;

	let controller: GraphController | null = null;
	let selectedId: string | null = null;
	let searchQuery = '';
	let typeFilter: 'all' | NodeType = 'all';
	let groupFilter = '';
	let radialLayout = true;
	let viewMode: ViewMode = 'overview';
	let depSearch = '';
	let chainMode: ChainMode;
	let expandedRelGroups: Record<string, boolean> = {};
	let expandedReasonIds: Record<string, boolean> = {};
	let inspectorOpen = false;
	let showDependsOn = true;
	let showRequiredBy = true;
	let showAllLabels = false;

	$: chainMode = showTransitive ? 'extended' : 'direct';

	$: palette = getGraphPalette($theme);

	$: apiGroups = [...new Set(graph.nodes.map((n) => n.group))].sort();

	$: typeFilteredNodes = graph.nodes.filter((node) => {
		if (typeFilter !== 'all' && node.type !== typeFilter) return false;
		if (groupFilter && node.group !== groupFilter) return false;
		if (searchQuery.trim()) {
			const q = searchQuery.trim().toLowerCase();
			const haystack = `${node.kind} ${node.group} ${node.shortName} ${node.id}`.toLowerCase();
			if (!haystack.includes(q)) return false;
		}
		return true;
	});

	$: overviewGraph = fullGraph ?? graph;
	$: overviewLinks = applyEdgeSourceFilter(overviewGraph.links, showInferredEdges);

	$: edgeSourceFilteredLinks = applyEdgeSourceFilter(graph.links, showInferredEdges);

	$: typeFilteredLinks = edgeSourceFilteredLinks.filter((link) => {
		const source = linkEndpointId(link.source);
		const target = linkEndpointId(link.target);
		const nodeIds = new Set(typeFilteredNodes.map((n) => n.id));
		return nodeIds.has(source) && nodeIds.has(target);
	});

	$: directionFiltered = applyDirectionFilter(typeFilteredNodes, typeFilteredLinks, focusNodeId, {
		showDependsOn,
		showRequiredBy
	});

	$: filteredNodes = directionFiltered.nodes;
	$: filteredLinks = directionFiltered.links;
	$: visualLinks = collapseVisualLinks(filteredLinks);
	$: filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
	$: denseGraph = filteredNodes.length > DENSE_LABEL_THRESHOLD;
	$: showLabelToggle = showTransitive && denseGraph;
	$: if (!showTransitive) showAllLabels = false;

	$: selectedNode = selectedId ? graph.nodes.find((n) => n.id === selectedId) ?? null : null;

	$: highlightSets = selectedId
		? getHighlightSets(selectedId, filteredLinks, chainMode, filteredNodeIds)
		: null;

	$: requiredByDeps = selectedId
		? buildTransitiveDepList(selectedId, filteredLinks, 'incoming', chainMode, filteredNodeIds)
		: [];

	$: dependsOnDeps = selectedId
		? buildTransitiveDepList(selectedId, filteredLinks, 'outgoing', chainMode, filteredNodeIds)
		: [];

	$: directRequiredBy = requiredByDeps.filter((d) => d.depth === 1);
	$: directDependsOn = dependsOnDeps.filter((d) => d.depth === 1);
	$: transitiveRequiredBy = requiredByDeps.filter((d) => d.depth > 1);
	$: transitiveDependsOn = dependsOnDeps.filter((d) => d.depth > 1);

	$: if (controller) {
		chainMode;
		selectedId;
		showAllLabels;
		controller.updateHighlight();
	}

	$: if (selectedId && !filteredNodeIds.has(selectedId)) {
		selectedId =
			focusNodeId && filteredNodeIds.has(focusNodeId) ? focusNodeId : null;
		controller?.updateHighlight();
	}

	$: if (controller) {
		graph;
		filteredNodes;
		visualLinks;
		controller.rebuild();
	}

	function reflowGraphWhenVisible() {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				try {
					controller?.reflowLayout();
				} catch (err) {
					console.error('[dep-map] reflowGraphWhenVisible failed', err);
				}
			});
		});
	}

	$: if (controller && focusNodeId && graph.nodes.some((n) => n.id === focusNodeId)) {
		selectedId = focusNodeId;
		controller.updateHighlight();
		requestAnimationFrame(() => controller?.fitToScreen());
	}

	$: if (controller) {
		controller.updateTheme($theme);
	}

	function nodeLabel(id: string): string {
		const node = graph.nodes.find((n) => n.id === id);
		return node?.kind || node?.shortName || id;
	}

	function relLabel(rel: LinkRelation): string {
		return REL_LABELS[rel] ?? rel;
	}

	function relColor(rel: LinkRelation): string {
		return palette.rel[rel] ?? palette.link;
	}

	function groupDepsByRel(
		deps: TransitiveDepEntry[]
	): Array<[LinkRelation, TransitiveDepEntry[]]> {
		const grouped = new Map<LinkRelation, TransitiveDepEntry[]>();
		for (const dep of deps) {
			const rel = dep.rel ?? 'references';
			const list = grouped.get(rel) ?? [];
			list.push(dep);
			grouped.set(rel, list);
		}
		return REL_ORDER.filter((rel) => grouped.has(rel)).map((rel) => [rel, grouped.get(rel)!]);
	}

	$: directRequiredByGrouped = groupDepsByRel(directRequiredBy);
	$: directDependsOnGrouped = groupDepsByRel(directDependsOn);
	$: transitiveRequiredByGrouped = groupDepsByRel(transitiveRequiredBy);
	$: transitiveDependsOnGrouped = groupDepsByRel(transitiveDependsOn);

	function relGroupKey(section: string, rel: LinkRelation): string {
		return `${section}:${rel}`;
	}

	function isRelGroupExpanded(section: string, rel: LinkRelation): boolean {
		const key = relGroupKey(section, rel);
		const stored = expandedRelGroups[key];
		if (stored !== undefined) return stored;
		return chainMode === 'extended';
	}

	function toggleRelGroup(section: string, rel: LinkRelation) {
		const key = relGroupKey(section, rel);
		expandedRelGroups = { ...expandedRelGroups, [key]: !isRelGroupExpanded(section, rel) };
	}

	function isReasonExpanded(depKey: string): boolean {
		return !!expandedReasonIds[depKey];
	}

	function toggleReason(depKey: string) {
		expandedReasonIds = { ...expandedReasonIds, [depKey]: !expandedReasonIds[depKey] };
	}

	function truncateReason(reason: string | undefined, max = 72): string {
		if (!reason) return '';
		const text = reason.replace(/\s*\([^)]+\)\s*$/, '').trim();
		if (text.length <= max) return text;
		return `${text.slice(0, max).trim()}…`;
	}

	function schemaPath(reason: string | undefined, field: string | undefined): string {
		if (field) return field;
		const match = reason?.match(/\(([^)]+)\)\s*$/);
		return match?.[1] ?? '';
	}

	function depKey(dep: TransitiveDepEntry): string {
		return `${dep.id}-${dep.depth}-${dep.field ?? ''}`;
	}

	function selectNode(id: string | null) {
		selectedId = id;
		controller?.updateHighlight();
		if (id) controller?.focusNode(id);
	}

	function handleDepClick(id: string) {
		if (focusNodeId && id !== focusNodeId) {
			onRefocus?.(id);
			return;
		}
		selectNode(id);
	}

	function handleGraphRefocus(id: string) {
		onRefocus?.(id);
	}

	function clearAll() {
		searchQuery = '';
		typeFilter = 'all';
		groupFilter = '';
		selectNode(null);
	}

	function selectRadialLayout() {
		radialLayout = true;
		controller?.setRadial(true);
	}

	function selectForceLayout() {
		radialLayout = false;
		controller?.setRadial(false);
	}

	function fitGraph() {
		controller?.fitToScreen();
	}

	function resetZoom() {
		controller?.showFullExtent();
	}

	function toggleDependsOn() {
		if (showDependsOn && !showRequiredBy) return;
		showDependsOn = !showDependsOn;
	}

	function toggleRequiredBy() {
		if (showRequiredBy && !showDependsOn) return;
		showRequiredBy = !showRequiredBy;
	}

	function zoomIn() {
		controller?.zoomIn();
	}

	function zoomOut() {
		controller?.zoomOut();
	}

	function toggleShowAllLabels() {
		showAllLabels = !showAllLabels;
		requestAnimationFrame(() => controller?.fitToScreen());
	}

	function toggleInspector(open?: boolean) {
		inspectorOpen = typeof open === 'boolean' ? open : !inspectorOpen;
		if (browser) {
			sessionStorage.setItem(INSPECTOR_STORAGE_KEY, String(inspectorOpen));
		}
		requestAnimationFrame(() => {
			controller?.reflowLayout();
		});
	}

	async function initController() {
		if (!browser || controller || !containerEl || !svgEl) return;

		const { createGraphController } = await import('./graphController');
		controller = createGraphController({
			container: containerEl,
			svg: svgEl,
			tooltip: tooltipEl,
			getFilteredNodes: () => filteredNodes,
			getFilteredLinks: () => visualLinks,
			radialLayout,
			theme: $theme,
			onSelect: selectNode,
			onRefocus: handleGraphRefocus,
			getSelectedId: () => selectedId,
			getChainMode: () => chainMode,
			getCenterNodeId: () => focusNodeId,
			getShowAllLabels: () => showAllLabels
		});

		if (focusNodeId && graph.nodes.some((n) => n.id === focusNodeId)) {
			selectedId = focusNodeId;
			controller.updateHighlight();
		}

		if (viewMode === 'graph') {
			reflowGraphWhenVisible();
		}
	}

	$: if (browser && containerEl && svgEl && !controller) {
		void initController();
	}

	function setViewMode(mode: ViewMode) {
		viewMode = mode;
		if (browser) {
			sessionStorage.setItem(VIEW_STORAGE_KEY, mode);
		}
		if (mode === 'graph') {
			reflowGraphWhenVisible();
		}
	}

	onMount(() => {
		if (!browser) return;

		const storedView = sessionStorage.getItem(VIEW_STORAGE_KEY);
		if (storedView === 'overview' || storedView === 'graph') {
			viewMode = storedView;
		}

		const stored = sessionStorage.getItem(INSPECTOR_STORAGE_KEY);
		if (stored !== null) {
			inspectorOpen = stored === 'true';
		}

		void initController();
	});

	onDestroy(() => {
		controller?.destroy();
		controller = null;
	});
</script>

<div
	class="dep-map-root"
	style:--dep-bg={palette.background}
	style:--dep-panel={palette.panel}
	style:--dep-panel-border={palette.panelBorder}
	style:--dep-text={palette.text}
	style:--dep-text-muted={palette.textMuted}
	style:--dep-chip-active={palette.chipActive}
	style:--dep-chip-inactive={palette.chipInactive}
	style:--dep-tooltip-bg={palette.tooltipBg}
	style:--dep-tooltip-border={palette.tooltipBorder}
>
	<div class="dep-map-toolbar" role="toolbar" aria-label="Dependency map controls">
		<div class="dep-map-toolbar-row">
			<div class="dep-map-view-tabs" role="tablist" aria-label="View mode">
				<button
					type="button"
					role="tab"
					class="dep-map-view-tab"
					class:dep-map-view-tab-active={viewMode === 'overview'}
					aria-selected={viewMode === 'overview'}
					onclick={() => setViewMode('overview')}
				>
					Overview
				</button>
				<button
					type="button"
					role="tab"
					class="dep-map-view-tab"
					class:dep-map-view-tab-active={viewMode === 'graph'}
					aria-selected={viewMode === 'graph'}
					onclick={() => setViewMode('graph')}
				>
					Graph
				</button>
			</div>

			<label class="dep-map-search-wrap">
				<span class="sr-only">{viewMode === 'overview' ? 'Search dependencies' : 'Filter graph nodes'}</span>
				<svg class="dep-map-search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
				</svg>
				<input
					type="search"
					class="dep-map-search"
					placeholder={viewMode === 'overview' ? 'Filter dependencies…' : 'Filter visible nodes…'}
					value={viewMode === 'overview' ? depSearch : searchQuery}
					oninput={(e) => {
						if (viewMode === 'overview') depSearch = e.currentTarget.value;
						else searchQuery = e.currentTarget.value;
					}}
					aria-label={viewMode === 'overview' ? 'Filter dependencies' : 'Filter nodes in graph'}
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

			<label class="dep-map-group-select-wrap">
				<span class="sr-only">API group filter</span>
				<select class="dep-map-group-select" bind:value={groupFilter} aria-label="Filter by API group">
					<option value="">All API groups</option>
					{#each apiGroups as group}
						<option value={group}>{group}</option>
					{/each}
				</select>
			</label>

			<div
				class="dep-map-direction-chips"
				class:dep-map-btn-group-hidden={viewMode !== 'graph'}
				role="group"
				aria-label="Dependency direction filter"
			>
				<button
					type="button"
					class="dep-map-chip dep-map-chip-direction dep-map-chip-direction-out"
					class:dep-map-chip-active={showDependsOn}
					aria-pressed={showDependsOn}
					onclick={toggleDependsOn}
					title="Show edges where focus depends on other CRDs"
				>
					Depends on
				</button>
				<button
					type="button"
					class="dep-map-chip dep-map-chip-direction dep-map-chip-direction-in"
					class:dep-map-chip-active={showRequiredBy}
					aria-pressed={showRequiredBy}
					onclick={toggleRequiredBy}
					title="Show edges where other CRDs depend on focus"
				>
					Required by
				</button>
			</div>
		</div>

		<div class="dep-map-toolbar-row dep-map-toolbar-actions">
			<span class="dep-map-stat" aria-live="polite">
				{#if viewMode === 'overview'}
					{showTransitive ? 'Extended' : 'Direct'} view · {graph.nodes.length} CRDs
				{:else}
					{filteredNodes.length} nodes · {visualLinks.length} edges
				{/if}
			</span>

			<div
				class="dep-map-layout-segment"
				class:dep-map-btn-group-hidden={viewMode !== 'graph'}
				role="group"
				aria-label="Graph layout controls"
			>
				<button
					type="button"
					class="dep-map-segment-btn"
					class:dep-map-segment-btn-active={radialLayout}
					onclick={selectRadialLayout}
					aria-pressed={radialLayout}
				>
					Radial
				</button>
				<button
					type="button"
					class="dep-map-segment-btn"
					class:dep-map-segment-btn-active={!radialLayout}
					onclick={selectForceLayout}
					aria-pressed={!radialLayout}
				>
					Force
				</button>
				<span class="dep-map-segment-divider" aria-hidden="true"></span>
				<button type="button" class="dep-map-segment-btn" onclick={fitGraph} title="Fit all visible nodes and labels in view">
					Fit
				</button>
				<button
					type="button"
					class="dep-map-segment-btn"
					onclick={resetZoom}
					title="Reset zoom to 100%"
				>
					1:1
				</button>
				{#if showLabelToggle}
					<span class="dep-map-segment-divider" aria-hidden="true"></span>
					<button
						type="button"
						class="dep-map-segment-btn"
						class:dep-map-segment-btn-active={showAllLabels}
						onclick={toggleShowAllLabels}
						aria-pressed={showAllLabels}
						title="Show labels on all nodes (direct neighbors always visible)"
					>
						Labels
					</button>
				{/if}
				<button type="button" class="dep-map-segment-btn dep-map-segment-btn-ghost" onclick={clearAll}>
					Reset
				</button>
			</div>

			<button
				type="button"
				class="dep-map-btn dep-map-inspector-toggle"
				class:dep-map-btn-active={inspectorOpen}
				class:dep-map-btn-hidden={viewMode !== 'graph'}
				onclick={() => toggleInspector()}
				aria-pressed={inspectorOpen}
				aria-label={inspectorOpen ? 'Hide inspector panel' : 'Show inspector panel'}
				title={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
			>
				<svg class="dep-map-inspector-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
				</svg>
				<span class="dep-map-inspector-label">Inspector</span>
				<svg
					class="dep-map-inspector-chevron"
					class:dep-map-inspector-chevron--closed={!inspectorOpen}
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
				</svg>
			</button>
		</div>
	</div>

	{#if breadcrumbTrail.length > 1}
		<nav class="dep-map-breadcrumb" aria-label="Focus navigation">
			{#each breadcrumbTrail as crumb, i}
				{#if i > 0}
					<span class="dep-map-breadcrumb-sep" aria-hidden="true">›</span>
				{/if}
				{#if i < breadcrumbTrail.length - 1}
					<button
						type="button"
						class="dep-map-breadcrumb-link"
						onclick={() => onBreadcrumbNavigate?.(crumb.id)}
					>
						{crumb.label}
					</button>
				{:else}
					<span class="dep-map-breadcrumb-current" aria-current="page">{crumb.label}</span>
				{/if}
			{/each}
		</nav>
	{/if}

	{#if focusNodeId}
		<div class="dep-map-overview-shell" class:dep-map-view-hidden={viewMode !== 'overview'}>
			<DependencyMapOverview
				graph={{ ...overviewGraph, links: overviewLinks }}
				focusNodeId={focusNodeId}
				{chainMode}
				{depSearch}
				{showDependsOn}
				{showRequiredBy}
				onSelect={handleDepClick}
				{onViewCrd}
			/>
		</div>
	{/if}

	<div
		class="dep-map-graph-view"
		class:dep-map-view-hidden={viewMode === 'overview'}
		class:dep-map-graph-view--active={viewMode === 'graph'}
	>
	<div class="dep-map-legend-strip" aria-label="Graph legend">
		<div class="dep-map-legend-group">
			<span class="dep-map-legend-label">Nodes</span>
			<span class="dep-map-legend-item">
				<span class="dep-map-dot dep-map-dot-config"></span> Config
			</span>
			<span class="dep-map-legend-item">
				<span class="dep-map-dot dep-map-dot-state"></span> State
			</span>
		</div>
		<span class="dep-map-legend-divider" aria-hidden="true"></span>
		<div class="dep-map-legend-group dep-map-legend-group-direction">
			<span class="dep-map-legend-label">Direction</span>
			<span class="dep-map-legend-item">
				<span class="dep-map-dir-swatch dep-map-dir-swatch-out"></span> Depends on
			</span>
			<span class="dep-map-legend-item">
				<span class="dep-map-dir-swatch dep-map-dir-swatch-in"></span> Required by
			</span>
		</div>
		<span class="dep-map-legend-divider" aria-hidden="true"></span>
		<div class="dep-map-legend-group dep-map-legend-group-edges">
			<span class="dep-map-legend-label">Relations</span>
			{#each LEGEND_REL_ORDER as rel}
				<span class="dep-map-legend-item">
					<span class="dep-map-rel-swatch" style:background={palette.rel[rel]}></span>
					{relLabel(rel)}
				</span>
			{/each}
		</div>
	</div>

	<div class="dep-map-body" class:dep-map-body--panel-hidden={!inspectorOpen}>
		<div class="dep-map-canvas-wrap" bind:this={containerEl}>
			{#if filteredNodes.length === 0}
				<div class="dep-map-canvas-empty" aria-live="polite">
					<p class="dep-map-canvas-empty-title">No nodes to display</p>
					<p class="dep-map-canvas-empty-hint">
						Adjust filters or search to show matching CRDs in the graph.
					</p>
				</div>
			{/if}

			<svg
				class="dep-map-svg"
				bind:this={svgEl}
				role="img"
				aria-label="CRD dependency graph"
				aria-hidden={filteredNodes.length === 0}
			></svg>
			<div class="dep-map-tooltip" bind:this={tooltipEl} aria-hidden="true"></div>

			<div class="dep-map-zoom-controls" role="toolbar" aria-label="Graph zoom controls">
				<button type="button" class="dep-map-zoom-btn" onclick={zoomIn} aria-label="Zoom in">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v12M6 12h12" />
					</svg>
				</button>
				<button type="button" class="dep-map-zoom-btn" onclick={zoomOut} aria-label="Zoom out">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 12h12" />
					</svg>
				</button>
				<button
					type="button"
					class="dep-map-zoom-btn"
					onclick={fitGraph}
					aria-label="Fit graph to view"
					title="Fit all visible nodes and labels in view"
				>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
						/>
					</svg>
				</button>
			</div>
		</div>

		{#if inspectorOpen}
			<aside class="dep-map-panel" aria-label="Selected CRD details">
				{#if selectedNode}
				<div class="dep-map-panel-header">
					<div>
						<h3 class="dep-map-panel-title">{selectedNode.kind}</h3>
						<p class="dep-map-panel-group">{selectedNode.group}</p>
					</div>
					<button
						type="button"
						class="dep-map-panel-close"
						onclick={() => selectNode(null)}
						aria-label="Clear selection"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				<div class="dep-map-panel-meta">
					<span class="dep-map-badge dep-map-badge-{selectedNode.type}">{selectedNode.type}</span>
					<span class="dep-map-version">{selectedNode.version}</span>
				</div>

				{#if selectedNode.description}
					<p class="dep-map-description">{selectedNode.description}</p>
				{/if}

				<section class="dep-map-dep-section">
					<header class="dep-map-dep-header">
						<h4 class="dep-map-dep-heading">Required by</h4>
						<div class="dep-map-dep-stats">
							<span class="dep-map-dep-stat-primary">{directRequiredBy.length} dependencies</span>
							{#if transitiveRequiredBy.length > 0}
								<span class="dep-map-dep-stat-sub">
									+{transitiveRequiredBy.length} transitive
								</span>
							{/if}
						</div>
					</header>

					{#if directRequiredBy.length === 0 && transitiveRequiredBy.length === 0}
						<p class="dep-map-dep-empty">Nothing depends on this resource in this subgraph.</p>
					{:else}
						{#each directRequiredByGrouped as [rel, deps] (rel)}
							{@const groupKey = relGroupKey('required', rel)}
							<div class="dep-map-rel-group">
								<button
									type="button"
									class="dep-map-rel-group-toggle"
									aria-expanded={isRelGroupExpanded('required', rel)}
									onclick={() => toggleRelGroup('required', rel)}
								>
									<span class="dep-map-rel-pill" style:--rel-color={relColor(rel)}>{relLabel(rel)}</span>
									<span class="dep-map-rel-group-count">{deps.length}</span>
									<svg
										class="dep-map-rel-chevron"
										class:dep-map-rel-chevron-open={isRelGroupExpanded('required', rel)}
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										aria-hidden="true"
									>
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
									</svg>
								</button>
								{#if isRelGroupExpanded('required', rel)}
									<ul class="dep-map-dep-cards" role="list">
										{#each deps as dep (depKey(dep))}
											{@const key = depKey(dep)}
											{@const path = schemaPath(dep.reason, dep.field)}
											<li>
												<!-- svelte-ignore a11y_no_static_element_interactions -->
												<div
													class="dep-map-dep-card"
													role="button"
													tabindex="0"
													onclick={() => handleDepClick(dep.id)}
													onkeydown={(e) => e.key === 'Enter' && handleDepClick(dep.id)}
												>
													<div class="dep-map-dep-card-head">
														<span class="dep-map-dep-name">{nodeLabel(dep.id)}</span>
														<span class="dep-map-rel-pill dep-map-rel-pill-sm" style:--rel-color={relColor(dep.rel ?? rel)}>
															{relLabel(dep.rel ?? rel)}
														</span>
													</div>
													{#if dep.reason}
														<p class="dep-map-dep-reason" class:dep-map-dep-reason-expanded={isReasonExpanded(key)}>
															{isReasonExpanded(key) ? dep.reason : truncateReason(dep.reason)}
														</p>
														{#if dep.reason.length > 72}
															<button
																type="button"
																class="dep-map-reason-toggle"
																onclick={(e) => {
																	e.stopPropagation();
																	toggleReason(key);
																}}
															>
																{isReasonExpanded(key) ? 'Show less' : 'Show more'}
															</button>
														{/if}
													{/if}
													{#if path}
														<code class="dep-map-dep-path">{path}</code>
													{/if}
												</div>
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/each}

						{#if chainMode === 'extended' && transitiveRequiredBy.length > 0}
							<details class="dep-map-transitive-block">
								<summary>Transitive required-by ({transitiveRequiredBy.length})</summary>
								{#each transitiveRequiredByGrouped as [rel, deps] (rel)}
									<ul class="dep-map-dep-cards dep-map-dep-cards-compact" role="list">
										{#each deps as dep (depKey(dep))}
											<li>
												<button type="button" class="dep-map-dep-card dep-map-dep-card-compact" onclick={() => handleDepClick(dep.id)}>
													<span class="dep-map-dep-depth">L{dep.depth}</span>
													<span class="dep-map-dep-name">{nodeLabel(dep.id)}</span>
												</button>
											</li>
										{/each}
									</ul>
								{/each}
							</details>
						{/if}
					{/if}
				</section>

				<section class="dep-map-dep-section">
					<header class="dep-map-dep-header">
						<h4 class="dep-map-dep-heading">Depends on</h4>
						<div class="dep-map-dep-stats">
							<span class="dep-map-dep-stat-primary">{directDependsOn.length} dependencies</span>
							{#if transitiveDependsOn.length > 0}
								<span class="dep-map-dep-stat-sub">
									+{transitiveDependsOn.length} transitive
								</span>
							{/if}
						</div>
					</header>

					{#if directDependsOn.length === 0 && transitiveDependsOn.length === 0}
						<p class="dep-map-dep-empty">No dependencies found in this subgraph.</p>
					{:else}
						{#each directDependsOnGrouped as [rel, deps] (rel)}
							<div class="dep-map-rel-group">
								<button
									type="button"
									class="dep-map-rel-group-toggle"
									aria-expanded={isRelGroupExpanded('depends', rel)}
									onclick={() => toggleRelGroup('depends', rel)}
								>
									<span class="dep-map-rel-pill" style:--rel-color={relColor(rel)}>{relLabel(rel)}</span>
									<span class="dep-map-rel-group-count">{deps.length}</span>
									<svg
										class="dep-map-rel-chevron"
										class:dep-map-rel-chevron-open={isRelGroupExpanded('depends', rel)}
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										aria-hidden="true"
									>
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
									</svg>
								</button>
								{#if isRelGroupExpanded('depends', rel)}
									<ul class="dep-map-dep-cards" role="list">
										{#each deps as dep (depKey(dep))}
											{@const key = depKey(dep)}
											{@const path = schemaPath(dep.reason, dep.field)}
											<li>
												<!-- svelte-ignore a11y_no_static_element_interactions -->
												<div
													class="dep-map-dep-card"
													role="button"
													tabindex="0"
													onclick={() => handleDepClick(dep.id)}
													onkeydown={(e) => e.key === 'Enter' && handleDepClick(dep.id)}
												>
													<div class="dep-map-dep-card-head">
														<span class="dep-map-dep-name">{nodeLabel(dep.id)}</span>
														<span class="dep-map-rel-pill dep-map-rel-pill-sm" style:--rel-color={relColor(dep.rel ?? rel)}>
															{relLabel(dep.rel ?? rel)}
														</span>
													</div>
													{#if dep.reason}
														<p class="dep-map-dep-reason" class:dep-map-dep-reason-expanded={isReasonExpanded(key)}>
															{isReasonExpanded(key) ? dep.reason : truncateReason(dep.reason)}
														</p>
														{#if dep.reason.length > 72}
															<button
																type="button"
																class="dep-map-reason-toggle"
																onclick={(e) => {
																	e.stopPropagation();
																	toggleReason(key);
																}}
															>
																{isReasonExpanded(key) ? 'Show less' : 'Show more'}
															</button>
														{/if}
													{/if}
													{#if path}
														<code class="dep-map-dep-path">{path}</code>
													{/if}
												</div>
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/each}

						{#if chainMode === 'extended' && transitiveDependsOn.length > 0}
							<details class="dep-map-transitive-block">
								<summary>Transitive depends-on ({transitiveDependsOn.length})</summary>
								{#each transitiveDependsOnGrouped as [rel, deps] (rel)}
									<ul class="dep-map-dep-cards dep-map-dep-cards-compact" role="list">
										{#each deps as dep (depKey(dep))}
											<li>
												<button type="button" class="dep-map-dep-card dep-map-dep-card-compact" onclick={() => handleDepClick(dep.id)}>
													<span class="dep-map-dep-depth">L{dep.depth}</span>
													<span class="dep-map-dep-name">{nodeLabel(dep.id)}</span>
												</button>
											</li>
										{/each}
									</ul>
								{/each}
							</details>
						{/if}
					{/if}
				</section>

				{#if onViewCrd}
					<button type="button" class="dep-map-view-crd" onclick={() => onViewCrd?.(selectedNode)}>
						View CRD schema
					</button>
				{/if}
				{:else}
					<div class="dep-map-panel-empty">
						<p class="dep-map-panel-empty-title">No node selected</p>
						<p class="dep-map-panel-empty-hint">Click a node in the graph to inspect its dependencies.</p>
					</div>
				{/if}
			</aside>
		{/if}
	</div>
	</div>

</div>

<style>
	.dep-map-view-hidden {
		display: none !important;
	}

	.dep-map-breadcrumb {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.35rem;
		padding: 0.35rem 0.75rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: 0.5rem;
		background: color-mix(in srgb, var(--dep-panel) 90%, var(--dep-bg));
		font-size: 0.75rem;
	}

	.dep-map-breadcrumb-link {
		padding: 0;
		border: none;
		background: none;
		color: var(--dep-chip-active);
		font-size: inherit;
		font-weight: 600;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.dep-map-breadcrumb-link:hover {
		opacity: 0.85;
	}

	.dep-map-breadcrumb-current {
		font-weight: 700;
		color: var(--dep-text);
	}

	.dep-map-breadcrumb-sep {
		color: var(--dep-text-muted);
		opacity: 0.7;
	}

	.dep-map-view-tabs {
		display: flex;
		gap: 0.2rem;
		padding: 0.2rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: 0.5rem;
		background: var(--dep-bg);
		flex-shrink: 0;
	}

	.dep-map-view-tab {
		padding: 0.35rem 0.75rem;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		color: var(--dep-text-muted);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}

	.dep-map-view-tab-active {
		background: var(--dep-chip-active);
		color: #fff;
	}

	.dep-map-overview-shell {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0.15rem 0.25rem 0.5rem;
	}

	.dep-map-graph-view {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		gap: 0.5rem;
	}

	.dep-map-graph-view--active {
		min-height: min(480px, 56vh);
	}

	:global(.dep-map-btn-group-hidden),
	.dep-map-btn-hidden {
		display: none;
	}

	.dep-map-root {
		display: flex;
		flex-direction: column;
		width: 100%;
		flex: 1;
		min-height: 0;
		gap: 0.5rem;
		color: var(--dep-text);
	}

	.dep-map-toolbar {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: 0.75rem;
		background: var(--dep-panel);
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
		padding: 0.45rem 0.75rem 0.45rem 2.25rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: 0.5rem;
		background: var(--dep-bg);
		color: var(--dep-text);
		font-size: 0.8125rem;
	}

	.dep-map-search:focus {
		outline: 2px solid var(--dep-chip-active);
		outline-offset: 1px;
	}

	.dep-map-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.dep-map-chip {
		padding: 0.35rem 0.65rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: 9999px;
		background: var(--dep-chip-inactive);
		color: var(--dep-text-muted);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}

	.dep-map-chip-active {
		background: var(--dep-chip-active);
		border-color: var(--dep-chip-active);
		color: #fff;
	}

	.dep-map-direction-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-left: auto;
	}

	.dep-map-chip-direction-out.dep-map-chip-active {
		background: #4f46e5;
		border-color: #4f46e5;
	}

	.dep-map-chip-direction-in.dep-map-chip-active {
		background: #059669;
		border-color: #059669;
	}

	.dep-map-layout-segment {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.15rem;
		padding: 0.15rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: 0.5rem;
		background: var(--dep-bg);
	}

	.dep-map-segment-btn {
		padding: 0.32rem 0.65rem;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		color: var(--dep-text-muted);
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}

	.dep-map-segment-btn:hover {
		color: var(--dep-text);
		background: color-mix(in srgb, var(--dep-chip-active) 8%, transparent);
	}

	.dep-map-segment-btn-active {
		background: var(--dep-chip-active);
		color: #fff;
	}

	.dep-map-segment-btn-ghost {
		opacity: 0.85;
	}

	.dep-map-segment-divider {
		width: 1px;
		height: 1.1rem;
		margin: 0 0.15rem;
		background: var(--dep-panel-border);
	}

	.dep-map-group-select-wrap {
		flex: 0 1 auto;
	}

	.dep-map-group-select {
		max-width: 14rem;
		padding: 0.45rem 0.65rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: 0.5rem;
		background: var(--dep-bg);
		color: var(--dep-text);
		font-size: 0.8125rem;
	}

	.dep-map-stat {
		font-size: 0.75rem;
		color: var(--dep-text-muted);
	}

	.dep-map-btn-group {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.dep-map-btn {
		padding: 0.35rem 0.7rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: 0.5rem;
		background: var(--dep-bg);
		color: var(--dep-text-muted);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s, color 0.15s, border-color 0.15s;
	}

	.dep-map-btn:hover {
		border-color: var(--dep-chip-active);
		color: var(--dep-text);
	}

	.dep-map-btn-active {
		background: var(--dep-chip-active);
		border-color: var(--dep-chip-active);
		color: #fff;
	}

	.dep-map-btn-ghost {
		background: transparent;
	}

	.dep-map-inspector-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		margin-left: auto;
	}

	.dep-map-inspector-icon {
		width: 0.95rem;
		height: 0.95rem;
		flex-shrink: 0;
	}

	.dep-map-inspector-label {
		font-size: 0.75rem;
		font-weight: 600;
	}

	.dep-map-inspector-chevron {
		width: 0.75rem;
		height: 0.75rem;
		flex-shrink: 0;
		transition: transform 0.15s;
	}

	.dep-map-inspector-chevron--closed {
		transform: rotate(180deg);
	}

	.dep-map-legend-strip {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.85rem;
		padding: 0.55rem 0.85rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: 0.65rem;
		background: color-mix(in srgb, var(--dep-panel) 92%, var(--dep-bg));
		font-size: 0.72rem;
		color: var(--dep-text-muted);
		flex-shrink: 0;
		letter-spacing: 0.01em;
	}

	.dep-map-legend-group {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.65rem;
	}

	.dep-map-legend-group-edges {
		flex: 1 1 auto;
		min-width: 0;
	}

	.dep-map-legend-label {
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--dep-text);
		margin-right: 0.1rem;
	}

	.dep-map-legend-divider {
		width: 1px;
		height: 1rem;
		background: var(--dep-panel-border);
		flex-shrink: 0;
	}

	@media (max-width: 639px) {
		.dep-map-legend-divider {
			display: none;
		}
	}

	.dep-map-body {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		flex: 1;
		min-height: min(48vh, 28rem);
		width: 100%;
		max-width: 100%;
		overflow-x: auto;
	}

	@media (min-width: 1024px) {
		.dep-map-body {
			flex-direction: row;
			align-items: stretch;
			min-height: min(52vh, 32rem);
		}

		.dep-map-body--panel-hidden {
			min-height: min(56vh, 36rem);
		}
	}

	.dep-map-canvas-wrap {
		position: relative;
		flex: 1 1 auto;
		min-width: 0;
		min-height: min(48vh, 28rem);
		width: 100%;
		border: 1px solid var(--dep-panel-border);
		border-radius: 0.85rem;
		background: var(--dep-bg);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
		overflow: auto;
		isolation: isolate;
	}

	@media (min-width: 1024px) {
		.dep-map-canvas-wrap {
			min-height: min(52vh, 32rem);
		}

		.dep-map-body--panel-hidden .dep-map-canvas-wrap {
			min-height: min(56vh, 36rem);
		}
	}

	.dep-map-panel {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding: 0.85rem 1rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: 0.75rem;
		background: var(--dep-panel);
		max-height: 100%;
		overflow-y: auto;
		position: relative;
		z-index: 5;
		flex-shrink: 0;
	}

	@media (min-width: 1024px) {
		.dep-map-panel {
			flex: 0 0 min(18rem, 22vw);
			width: min(18rem, 22vw);
			max-width: 20rem;
			min-width: 14rem;
		}
	}

	.dep-map-svg,
	:global(svg.dep-map-svg-inner) {
		display: block;
		position: relative;
		z-index: 1;
	}

	.dep-map-canvas-empty {
		position: absolute;
		inset: 0;
		z-index: 3;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		padding: 1.5rem;
		text-align: center;
		color: var(--dep-text-muted);
	}

	.dep-map-canvas-empty-title {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--dep-text);
	}

	.dep-map-canvas-empty-hint {
		margin: 0;
		max-width: 18rem;
		font-size: 0.75rem;
		line-height: 1.45;
	}

	:global(.dep-map-svg .dep-node--hover) {
		filter: drop-shadow(0 2px 6px rgba(15, 23, 42, 0.18));
	}

	:global(.dark .dep-map-svg .dep-node--hover) {
		filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.45));
	}

	.dep-map-zoom-controls {
		position: absolute;
		top: 0.65rem;
		right: 0.65rem;
		z-index: 2;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.25rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: 0.5rem;
		background: color-mix(in srgb, var(--dep-panel) 92%, transparent);
		box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08);
		backdrop-filter: blur(6px);
	}

	.dep-map-zoom-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		padding: 0;
		border: 1px solid var(--dep-panel-border);
		border-radius: 0.375rem;
		background: var(--dep-bg);
		color: var(--dep-text-muted);
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s, background 0.15s;
	}

	.dep-map-zoom-btn svg {
		width: 0.95rem;
		height: 0.95rem;
	}

	.dep-map-zoom-btn:hover {
		border-color: var(--dep-chip-active);
		color: var(--dep-chip-active);
		background: color-mix(in srgb, var(--dep-chip-active) 8%, var(--dep-bg));
	}

	.dep-map-tooltip {
		position: fixed;
		z-index: 50;
		pointer-events: none;
		opacity: 0;
		padding: 0.4rem 0.55rem;
		border: 1px solid var(--dep-tooltip-border);
		border-radius: 0.375rem;
		background: var(--dep-tooltip-bg);
		color: var(--dep-text);
		font-size: 0.75rem;
		line-height: 1.35;
		box-shadow: 0 4px 12px rgba(15, 23, 42, 0.12);
		max-width: 16rem;
	}

	.dep-map-panel-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.dep-map-panel-title {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--dep-text);
	}

	.dep-map-panel-group {
		margin: 0.2rem 0 0;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.7rem;
		color: var(--dep-text-muted);
		word-break: break-all;
	}

	.dep-map-panel-close {
		flex-shrink: 0;
		padding: 0.25rem;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		color: var(--dep-text-muted);
		cursor: pointer;
	}

	.dep-map-panel-close:hover {
		background: var(--dep-bg);
		color: var(--dep-text);
	}

	.dep-map-panel-empty {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.5rem 0;
	}

	.dep-map-panel-empty-title {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--dep-text);
	}

	.dep-map-panel-empty-hint {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.45;
		color: var(--dep-text-muted);
	}

	.dep-map-panel-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.dep-map-badge {
		padding: 0.15rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.dep-map-badge-config {
		background: rgba(37, 99, 235, 0.15);
		color: #2563eb;
	}

	.dep-map-badge-state {
		background: rgba(22, 163, 74, 0.15);
		color: #16a34a;
	}

	.dep-map-badge-other {
		background: rgba(100, 116, 139, 0.15);
		color: #64748b;
	}

	:global(.dark) .dep-map-badge-config {
		color: #60a5fa;
	}

	:global(.dark) .dep-map-badge-state {
		color: #4ade80;
	}

	:global(.dark) .dep-map-badge-other {
		color: #94a3b8;
	}

	.dep-map-version {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.7rem;
		color: var(--dep-text-muted);
	}

	.dep-map-description {
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--dep-text-muted);
	}

	.dep-map-dep-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-top: 0.25rem;
		border-top: 1px solid var(--dep-panel-border);
	}

	.dep-map-dep-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.dep-map-dep-heading {
		margin: 0;
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--dep-text);
	}

	.dep-map-dep-stats {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.1rem;
	}

	.dep-map-dep-stat-primary {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--dep-chip-active);
	}

	.dep-map-dep-stat-sub {
		font-size: 0.65rem;
		color: var(--dep-text-muted);
	}

	.dep-map-dep-empty {
		margin: 0;
		padding: 0.65rem 0.75rem;
		border: 1px dashed var(--dep-panel-border);
		border-radius: 0.5rem;
		font-size: 0.75rem;
		color: var(--dep-text-muted);
		text-align: center;
	}

	.dep-map-rel-group {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.dep-map-rel-group-toggle {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		padding: 0.25rem 0;
		border: none;
		background: transparent;
		cursor: pointer;
		text-align: left;
	}

	.dep-map-rel-pill {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem 0.55rem;
		border-radius: 9999px;
		background: color-mix(in srgb, var(--rel-color) 14%, transparent);
		color: var(--rel-color);
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.dep-map-rel-pill-sm {
		font-size: 0.6rem;
		padding: 0.1rem 0.4rem;
	}

	.dep-map-rel-group-count {
		font-size: 0.65rem;
		font-weight: 600;
		color: var(--dep-text-muted);
	}

	.dep-map-rel-chevron {
		margin-left: auto;
		width: 0.85rem;
		height: 0.85rem;
		color: var(--dep-text-muted);
		transition: transform 0.15s;
	}

	.dep-map-rel-chevron-open {
		transform: rotate(180deg);
	}

	.dep-map-dep-cards {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.dep-map-dep-cards-compact {
		gap: 0.25rem;
		margin-top: 0.35rem;
	}

	.dep-map-dep-card {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.3rem;
		width: 100%;
		padding: 0.55rem 0.65rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: 0.5rem;
		background: var(--dep-bg);
		color: var(--dep-text);
		text-align: left;
		cursor: pointer;
		transition: border-color 0.15s, box-shadow 0.15s;
	}

	.dep-map-dep-card:hover {
		border-color: var(--dep-chip-active);
		box-shadow: 0 1px 4px rgba(37, 99, 235, 0.08);
	}

	.dep-map-dep-card-compact {
		flex-direction: row;
		align-items: center;
		padding: 0.4rem 0.55rem;
	}

	.dep-map-dep-card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.dep-map-dep-name {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--dep-text);
	}

	.dep-map-dep-reason {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.45;
		color: var(--dep-text-muted);
	}

	.dep-map-dep-reason-expanded {
		white-space: pre-wrap;
	}

	.dep-map-reason-toggle {
		align-self: flex-start;
		padding: 0;
		border: none;
		background: none;
		color: var(--dep-chip-active);
		font-size: 0.7rem;
		font-weight: 600;
		cursor: pointer;
	}

	.dep-map-dep-path {
		display: block;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.65rem;
		color: var(--dep-text-muted);
		opacity: 0.85;
	}

	.dep-map-dep-depth {
		padding: 0.1rem 0.35rem;
		border-radius: 0.25rem;
		background: rgba(100, 116, 139, 0.12);
		color: var(--dep-text-muted);
		font-size: 0.6rem;
		font-weight: 700;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	}

	.dep-map-transitive-block {
		margin-top: 0.25rem;
		font-size: 0.75rem;
		color: var(--dep-text-muted);
	}

	.dep-map-transitive-block summary {
		cursor: pointer;
		font-weight: 600;
		color: var(--dep-text);
	}

	.dep-map-view-crd {
		margin-top: auto;
		padding: 0.55rem 0.85rem;
		border: none;
		border-radius: 0.5rem;
		background: #2563eb;
		color: #fff;
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s;
	}

	.dep-map-view-crd:hover {
		background: #1d4ed8;
	}

	.dep-map-legend-item {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.dep-map-dot {
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 9999px;
		flex-shrink: 0;
		border: 2px solid rgba(255, 255, 255, 0.85);
		box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
	}

	.dep-map-dot-config {
		background: #2563eb;
	}

	.dep-map-dot-state {
		background: #16a34a;
	}

	.dep-map-rel-swatch {
		display: inline-block;
		width: 1rem;
		height: 0.22rem;
		border-radius: 9999px;
		flex-shrink: 0;
	}

	.dep-map-dir-swatch {
		display: inline-block;
		width: 1.1rem;
		height: 0.24rem;
		border-radius: 9999px;
		flex-shrink: 0;
	}

	.dep-map-dir-swatch-out {
		background: #4f46e5;
	}

	.dep-map-dir-swatch-in {
		background: #059669;
	}

	:global(.dep-map-svg .dep-node-hit) {
		cursor: pointer;
	}

	:global(.dep-map-svg .dep-node-label-group) {
		pointer-events: none;
	}

	:global(.dep-map-svg .dep-node-label) {
		paint-order: stroke fill;
	}

	:global(.dep-map-svg .dep-node-label-bg) {
		pointer-events: none;
	}
</style>
