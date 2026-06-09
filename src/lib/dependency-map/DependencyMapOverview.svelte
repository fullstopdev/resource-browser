<script lang="ts">
	import { getGraphPalette, REL_LABELS, REL_ORDER } from './graphColors';
	import {
		buildTransitiveDepList,
		type ChainMode,
		type TransitiveDepEntry
	} from './transitiveClosure';
	import type { DependencyGraph, GraphNode, LinkRelation } from './types';
	import { theme } from '$lib/theme';

	const INITIAL_VISIBLE = 6;
	const SHOW_MORE_STEP = 12;

	let {
		graph,
		focusNodeId,
		chainMode = 'direct',
		depSearch = '',
		showDependsOn = true,
		showRequiredBy = true,
		onSelect,
		onViewCrd
	}: {
		graph: DependencyGraph;
		focusNodeId: string;
		chainMode?: ChainMode;
		depSearch?: string;
		showDependsOn?: boolean;
		showRequiredBy?: boolean;
		onSelect?: (id: string) => void;
		onViewCrd?: (node: GraphNode) => void;
	} = $props();

	let expandedRelGroups = $state<Record<string, boolean>>({});
	let visibleCounts = $state<Record<string, number>>({});
	let expandedReasonIds = $state<Record<string, boolean>>({});

	const palette = $derived(getGraphPalette($theme));
	const focusNode = $derived(graph.nodes.find((n) => n.id === focusNodeId) ?? null);

	const requiredByDeps = $derived(
		buildTransitiveDepList(focusNodeId, graph.links, 'incoming', chainMode)
	);
	const dependsOnDeps = $derived(
		buildTransitiveDepList(focusNodeId, graph.links, 'outgoing', chainMode)
	);

	const directRequiredBy = $derived(requiredByDeps.filter((d) => d.depth === 1));
	const directDependsOn = $derived(dependsOnDeps.filter((d) => d.depth === 1));
	const transitiveRequiredBy = $derived(requiredByDeps.filter((d) => d.depth > 1));
	const transitiveDependsOn = $derived(dependsOnDeps.filter((d) => d.depth > 1));

	function nodeFor(id: string): GraphNode | undefined {
		return graph.nodes.find((n) => n.id === id);
	}

	function nodeLabel(id: string): string {
		const node = nodeFor(id);
		return node?.kind || node?.shortName || id;
	}

	function nodeGroup(id: string): string {
		return nodeFor(id)?.group ?? id.split('.').slice(1).join('.');
	}

	function relLabel(rel: LinkRelation): string {
		return REL_LABELS[rel] ?? rel;
	}

	function relColor(rel: LinkRelation): string {
		return palette.rel[rel] ?? palette.link;
	}

	function matchesSearch(dep: TransitiveDepEntry): boolean {
		const q = depSearch.trim().toLowerCase();
		if (!q) return true;
		const node = nodeFor(dep.id);
		const haystack = `${nodeLabel(dep.id)} ${nodeGroup(dep.id)} ${node?.shortName ?? ''} ${dep.field ?? ''} ${dep.reason ?? ''}`.toLowerCase();
		return haystack.includes(q);
	}

	function filterDeps(deps: TransitiveDepEntry[]): TransitiveDepEntry[] {
		return deps.filter(matchesSearch);
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

	function groupDepsByApiGroup(
		deps: TransitiveDepEntry[]
	): Array<[string, TransitiveDepEntry[]]> {
		const grouped = new Map<string, TransitiveDepEntry[]>();
		for (const dep of deps) {
			const group = nodeGroup(dep.id);
			const list = grouped.get(group) ?? [];
			list.push(dep);
			grouped.set(group, list);
		}
		return [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	}

	const filteredDirectRequiredBy = $derived(filterDeps(directRequiredBy));
	const filteredDirectDependsOn = $derived(filterDeps(directDependsOn));
	const filteredTransitiveRequiredBy = $derived(filterDeps(transitiveRequiredBy));
	const filteredTransitiveDependsOn = $derived(filterDeps(transitiveDependsOn));

	const directRequiredByGrouped = $derived(groupDepsByRel(filteredDirectRequiredBy));
	const directDependsOnGrouped = $derived(groupDepsByRel(filteredDirectDependsOn));

	const apiGroupsInDeps = $derived(
		new Set([
			...filteredDirectRequiredBy.map((d) => nodeGroup(d.id)),
			...filteredDirectDependsOn.map((d) => nodeGroup(d.id))
		]).size
	);

	const summaryStats = $derived({
		dependsOn: filteredDirectDependsOn.length,
		requiredBy: filteredDirectRequiredBy.length,
		transitiveDependsOn: filteredTransitiveDependsOn.length,
		transitiveRequiredBy: filteredTransitiveRequiredBy.length,
		apiGroups: apiGroupsInDeps,
		nodes: graph.nodes.length,
		edges: graph.links.length
	});

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

	function visibleLimit(section: string, rel: LinkRelation): number {
		return visibleCounts[relGroupKey(section, rel)] ?? INITIAL_VISIBLE;
	}

	function showMore(section: string, rel: LinkRelation, total: number) {
		const key = relGroupKey(section, rel);
		const current = visibleCounts[key] ?? INITIAL_VISIBLE;
		visibleCounts = { ...visibleCounts, [key]: Math.min(current + SHOW_MORE_STEP, total) };
	}

	function depKey(dep: TransitiveDepEntry): string {
		return `${dep.id}-${dep.depth}-${dep.field ?? ''}`;
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

	function isReasonExpanded(key: string): boolean {
		return !!expandedReasonIds[key];
	}

	function toggleReason(key: string) {
		expandedReasonIds = { ...expandedReasonIds, [key]: !expandedReasonIds[key] };
	}

	function handleDepClick(id: string) {
		onSelect?.(id);
	}

	function shortGroupLabel(group: string): string {
		return group.replace(/\.eda\.nokia\.com$/, '').replace(/\.nokia\.com$/, '');
	}
</script>

<div
	class="dep-overview"
	style:--dep-bg={palette.background}
	style:--dep-panel={palette.panel}
	style:--dep-panel-border={palette.panelBorder}
	style:--dep-text={palette.text}
	style:--dep-text-muted={palette.textMuted}
	style:--dep-chip-active={palette.chipActive}
>
	{#if focusNode}
		<header class="dep-overview-hero">
			<div class="dep-overview-hero-main">
				<div class="dep-overview-hero-icon" aria-hidden="true">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
						/>
					</svg>
				</div>
				<div class="dep-overview-hero-text">
					<h2 class="dep-overview-kind">{focusNode.kind}</h2>
					<p class="dep-overview-group">{focusNode.group}</p>
				</div>
				<span class="dep-overview-badge dep-overview-badge-{focusNode.type}">{focusNode.type}</span>
			</div>
			{#if focusNode.description}
				<p class="dep-overview-desc">{focusNode.description}</p>
			{/if}
		</header>

		<div class="dep-overview-stats" aria-label="Dependency summary">
			<div class="dep-overview-stat-card">
				<span class="dep-overview-stat-value">{summaryStats.dependsOn}</span>
				<span class="dep-overview-stat-label">Depends on</span>
			</div>
			<div class="dep-overview-stat-card">
				<span class="dep-overview-stat-value">{summaryStats.requiredBy}</span>
				<span class="dep-overview-stat-label">Required by</span>
			</div>
			<div class="dep-overview-stat-card dep-overview-stat-card-muted">
				<span class="dep-overview-stat-value">{summaryStats.apiGroups}</span>
				<span class="dep-overview-stat-label">API groups</span>
			</div>
			{#if chainMode === 'extended' && (summaryStats.transitiveDependsOn > 0 || summaryStats.transitiveRequiredBy > 0)}
				<div class="dep-overview-stat-card dep-overview-stat-card-muted">
					<span class="dep-overview-stat-value">
						{summaryStats.transitiveDependsOn + summaryStats.transitiveRequiredBy}
					</span>
					<span class="dep-overview-stat-label">Transitive</span>
				</div>
			{/if}
		</div>
	{/if}

	<div
		class="dep-overview-columns"
		class:dep-overview-columns-single={showDependsOn !== showRequiredBy}
	>
		{#if showDependsOn}
		<section class="dep-overview-section" aria-labelledby="dep-depends-heading">
			<header class="dep-overview-section-header">
				<h3 id="dep-depends-heading" class="dep-overview-section-title">
					<svg class="dep-overview-section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
					</svg>
					Depends on
				</h3>
				<span class="dep-overview-section-count">{filteredDirectDependsOn.length} direct</span>
			</header>

			{#if filteredDirectDependsOn.length === 0 && filteredTransitiveDependsOn.length === 0}
				<p class="dep-overview-empty">
					{depSearch.trim() ? 'No matching dependencies.' : 'No direct dependencies in this view.'}
				</p>
			{:else}
				{#each directDependsOnGrouped as [rel, deps] (rel)}
					{@const limit = visibleLimit('depends', rel)}
					{@const visibleDeps = deps.slice(0, limit)}
					<div class="dep-overview-rel-group">
						<button
							type="button"
							class="dep-overview-rel-toggle"
							aria-expanded={isRelGroupExpanded('depends', rel)}
							onclick={() => toggleRelGroup('depends', rel)}
						>
							<span class="dep-overview-rel-pill" style:--rel-color={relColor(rel)}>{relLabel(rel)}</span>
							<span class="dep-overview-rel-count">{deps.length}</span>
							<svg
								class="dep-overview-rel-chevron"
								class:dep-overview-rel-chevron-open={isRelGroupExpanded('depends', rel)}
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
							</svg>
						</button>
						{#if isRelGroupExpanded('depends', rel)}
							<ul class="dep-overview-cards" role="list">
								{#each visibleDeps as dep (depKey(dep))}
									{@const key = depKey(dep)}
									{@const path = schemaPath(dep.reason, dep.field)}
									{@const node = nodeFor(dep.id)}
									<li>
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div
											class="dep-overview-card"
											role="button"
											tabindex="0"
											onclick={() => handleDepClick(dep.id)}
											onkeydown={(e) => e.key === 'Enter' && handleDepClick(dep.id)}
										>
											<div class="dep-overview-card-head">
												<span class="dep-overview-card-kind">{nodeLabel(dep.id)}</span>
												{#if node}
													<span class="dep-overview-card-group" title={node.group}>{shortGroupLabel(node.group)}</span>
												{/if}
											</div>
											{#if dep.reason}
												<p class="dep-overview-card-reason">
													{isReasonExpanded(key) ? dep.reason : truncateReason(dep.reason)}
												</p>
												{#if dep.reason.length > 72}
													<button
														type="button"
														class="dep-overview-reason-toggle"
														onclick={(e) => {
															e.stopPropagation();
															toggleReason(key);
														}}
													>
														{isReasonExpanded(key) ? 'Less' : 'More'}
													</button>
												{/if}
											{/if}
											{#if path}
												<code class="dep-overview-card-path">{path}</code>
											{/if}
										</div>
									</li>
								{/each}
							</ul>
							{#if deps.length > limit}
								<button
									type="button"
									class="dep-overview-show-more"
									onclick={() => showMore('depends', rel, deps.length)}
								>
									Show {Math.min(SHOW_MORE_STEP, deps.length - limit)} more ({deps.length - limit} remaining)
								</button>
							{/if}
						{/if}
					</div>
				{/each}

				{#if chainMode === 'extended' && filteredTransitiveDependsOn.length > 0}
					<details class="dep-overview-transitive" open>
						<summary>Transitive depends-on ({filteredTransitiveDependsOn.length})</summary>
						{#each groupDepsByApiGroup(filteredTransitiveDependsOn) as [group, deps] (group)}
							<div class="dep-overview-api-group">
								<span class="dep-overview-api-label">{shortGroupLabel(group)}</span>
								<ul class="dep-overview-cards dep-overview-cards-compact" role="list">
									{#each deps.slice(0, 20) as dep (depKey(dep))}
										<li>
											<button type="button" class="dep-overview-card dep-overview-card-compact" onclick={() => handleDepClick(dep.id)}>
												<span class="dep-overview-depth">L{dep.depth}</span>
												<span class="dep-overview-card-kind">{nodeLabel(dep.id)}</span>
											</button>
										</li>
									{/each}
								</ul>
								{#if deps.length > 20}
									<p class="dep-overview-more-hint">+{deps.length - 20} more in {shortGroupLabel(group)}</p>
								{/if}
							</div>
						{/each}
					</details>
				{/if}
			{/if}
		</section>
		{/if}

		{#if showRequiredBy}
		<section class="dep-overview-section" aria-labelledby="dep-required-heading">
			<header class="dep-overview-section-header">
				<h3 id="dep-required-heading" class="dep-overview-section-title">
					<svg class="dep-overview-section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
					</svg>
					Required by
				</h3>
				<span class="dep-overview-section-count">{filteredDirectRequiredBy.length} direct</span>
			</header>

			{#if filteredDirectRequiredBy.length === 0 && filteredTransitiveRequiredBy.length === 0}
				<p class="dep-overview-empty">
					{depSearch.trim() ? 'No matching dependents.' : 'Nothing depends on this resource in this view.'}
				</p>
			{:else}
				{#each directRequiredByGrouped as [rel, deps] (rel)}
					{@const limit = visibleLimit('required', rel)}
					{@const visibleDeps = deps.slice(0, limit)}
					<div class="dep-overview-rel-group">
						<button
							type="button"
							class="dep-overview-rel-toggle"
							aria-expanded={isRelGroupExpanded('required', rel)}
							onclick={() => toggleRelGroup('required', rel)}
						>
							<span class="dep-overview-rel-pill" style:--rel-color={relColor(rel)}>{relLabel(rel)}</span>
							<span class="dep-overview-rel-count">{deps.length}</span>
							<svg
								class="dep-overview-rel-chevron"
								class:dep-overview-rel-chevron-open={isRelGroupExpanded('required', rel)}
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
							</svg>
						</button>
						{#if isRelGroupExpanded('required', rel)}
							<ul class="dep-overview-cards" role="list">
								{#each visibleDeps as dep (depKey(dep))}
									{@const key = depKey(dep)}
									{@const path = schemaPath(dep.reason, dep.field)}
									{@const node = nodeFor(dep.id)}
									<li>
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div
											class="dep-overview-card"
											role="button"
											tabindex="0"
											onclick={() => handleDepClick(dep.id)}
											onkeydown={(e) => e.key === 'Enter' && handleDepClick(dep.id)}
										>
											<div class="dep-overview-card-head">
												<span class="dep-overview-card-kind">{nodeLabel(dep.id)}</span>
												{#if node}
													<span class="dep-overview-card-group" title={node.group}>{shortGroupLabel(node.group)}</span>
												{/if}
											</div>
											{#if dep.reason}
												<p class="dep-overview-card-reason">
													{isReasonExpanded(key) ? dep.reason : truncateReason(dep.reason)}
												</p>
												{#if dep.reason.length > 72}
													<button
														type="button"
														class="dep-overview-reason-toggle"
														onclick={(e) => {
															e.stopPropagation();
															toggleReason(key);
														}}
													>
														{isReasonExpanded(key) ? 'Less' : 'More'}
													</button>
												{/if}
											{/if}
											{#if path}
												<code class="dep-overview-card-path">{path}</code>
											{/if}
										</div>
									</li>
								{/each}
							</ul>
							{#if deps.length > limit}
								<button
									type="button"
									class="dep-overview-show-more"
									onclick={() => showMore('required', rel, deps.length)}
								>
									Show {Math.min(SHOW_MORE_STEP, deps.length - limit)} more ({deps.length - limit} remaining)
								</button>
							{/if}
						{/if}
					</div>
				{/each}

				{#if chainMode === 'extended' && filteredTransitiveRequiredBy.length > 0}
					<details class="dep-overview-transitive" open>
						<summary>Transitive required-by ({filteredTransitiveRequiredBy.length})</summary>
						{#each groupDepsByApiGroup(filteredTransitiveRequiredBy) as [group, deps] (group)}
							<div class="dep-overview-api-group">
								<span class="dep-overview-api-label">{shortGroupLabel(group)}</span>
								<ul class="dep-overview-cards dep-overview-cards-compact" role="list">
									{#each deps.slice(0, 20) as dep (depKey(dep))}
										<li>
											<button type="button" class="dep-overview-card dep-overview-card-compact" onclick={() => handleDepClick(dep.id)}>
												<span class="dep-overview-depth">L{dep.depth}</span>
												<span class="dep-overview-card-kind">{nodeLabel(dep.id)}</span>
											</button>
										</li>
									{/each}
								</ul>
								{#if deps.length > 20}
									<p class="dep-overview-more-hint">+{deps.length - 20} more in {shortGroupLabel(group)}</p>
								{/if}
							</div>
						{/each}
					</details>
				{/if}
			{/if}
		</section>
		{/if}
	</div>

	{#if onViewCrd && focusNode}
		<button type="button" class="dep-overview-view-crd" onclick={() => onViewCrd?.(focusNode)}>
			View CRD schema
		</button>
	{/if}
</div>

<style>
	.dep-overview {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		color: var(--dep-text);
	}

	.dep-overview-hero {
		padding: 0.85rem 1rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: 0.75rem;
		background: var(--dep-panel);
	}

	.dep-overview-hero-main {
		display: flex;
		align-items: flex-start;
		gap: 0.65rem;
	}

	.dep-overview-hero-icon {
		flex-shrink: 0;
		width: 2rem;
		height: 2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 0.5rem;
		background: color-mix(in srgb, var(--dep-chip-active) 12%, var(--dep-panel));
		color: var(--dep-chip-active);
	}

	.dep-overview-hero-icon svg {
		width: 1.1rem;
		height: 1.1rem;
	}

	.dep-overview-hero-text {
		flex: 1;
		min-width: 0;
	}

	.dep-overview-kind {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 700;
		line-height: 1.2;
	}

	.dep-overview-group {
		margin: 0.15rem 0 0;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.7rem;
		color: var(--dep-text-muted);
		word-break: break-all;
	}

	.dep-overview-badge {
		flex-shrink: 0;
		padding: 0.15rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.dep-overview-badge-config {
		background: rgba(37, 99, 235, 0.12);
		color: #2563eb;
	}

	.dep-overview-badge-state {
		background: rgba(22, 163, 74, 0.12);
		color: #16a34a;
	}

	.dep-overview-desc {
		margin: 0.65rem 0 0;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--dep-text-muted);
	}

	.dep-overview-stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(5.5rem, 1fr));
		gap: 0.5rem;
	}

	.dep-overview-stat-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
		padding: 0.65rem 0.5rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: 0.65rem;
		background: var(--dep-panel);
	}

	.dep-overview-stat-card-muted .dep-overview-stat-value {
		color: var(--dep-text-muted);
	}

	.dep-overview-stat-value {
		font-size: 1.35rem;
		font-weight: 800;
		line-height: 1;
		color: var(--dep-chip-active);
		font-variant-numeric: tabular-nums;
	}

	.dep-overview-stat-label {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--dep-text-muted);
		text-align: center;
	}

	.dep-overview-columns {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.85rem;
	}

	@media (min-width: 900px) {
		.dep-overview-columns {
			grid-template-columns: 1fr 1fr;
			align-items: start;
		}

		.dep-overview-columns-single {
			grid-template-columns: 1fr;
		}
	}

	.dep-overview-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: 0.75rem;
		background: var(--dep-panel);
		min-height: 8rem;
	}

	.dep-overview-section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding-bottom: 0.35rem;
		border-bottom: 1px solid var(--dep-panel-border);
	}

	.dep-overview-section-title {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
		font-size: 0.875rem;
		font-weight: 700;
	}

	.dep-overview-section-icon {
		width: 1rem;
		height: 1rem;
		color: var(--dep-chip-active);
	}

	.dep-overview-section-count {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--dep-text-muted);
	}

	.dep-overview-empty {
		margin: 0;
		padding: 1rem 0.75rem;
		border: 1px dashed var(--dep-panel-border);
		border-radius: 0.5rem;
		font-size: 0.75rem;
		color: var(--dep-text-muted);
		text-align: center;
	}

	.dep-overview-rel-group {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.dep-overview-rel-toggle {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: 0.5rem;
		background: var(--dep-bg);
		color: inherit;
		font: inherit;
		cursor: pointer;
		text-align: left;
		pointer-events: auto;
		transition: border-color 0.15s;
	}

	.dep-overview-rel-toggle:hover {
		border-color: var(--dep-chip-active);
	}

	.dep-overview-rel-pill {
		display: inline-flex;
		padding: 0.12rem 0.5rem;
		border-radius: 9999px;
		background: color-mix(in srgb, var(--rel-color) 14%, transparent);
		color: var(--rel-color);
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.dep-overview-rel-count {
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--dep-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.dep-overview-rel-chevron {
		margin-left: auto;
		width: 0.85rem;
		height: 0.85rem;
		color: var(--dep-text-muted);
		transition: transform 0.15s;
	}

	.dep-overview-rel-chevron-open {
		transform: rotate(180deg);
	}

	.dep-overview-cards {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.dep-overview-cards-compact {
		gap: 0.25rem;
	}

	.dep-overview-card {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.25rem;
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

	.dep-overview-card:hover {
		border-color: var(--dep-chip-active);
		box-shadow: 0 1px 4px rgba(37, 99, 235, 0.08);
	}

	.dep-overview-card-compact {
		flex-direction: row;
		align-items: center;
		padding: 0.4rem 0.55rem;
	}

	.dep-overview-card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.dep-overview-card-kind {
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--dep-text);
	}

	.dep-overview-card-group {
		flex-shrink: 0;
		padding: 0.1rem 0.4rem;
		border-radius: 0.25rem;
		background: color-mix(in srgb, var(--dep-text-muted) 12%, transparent);
		font-size: 0.6rem;
		font-weight: 600;
		color: var(--dep-text-muted);
		max-width: 45%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dep-overview-card-reason {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.4;
		color: var(--dep-text-muted);
	}

	.dep-overview-reason-toggle {
		align-self: flex-start;
		padding: 0;
		border: none;
		background: none;
		font-size: 0.65rem;
		font-weight: 600;
		color: var(--dep-chip-active);
		cursor: pointer;
	}

	.dep-overview-card-path {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.62rem;
		color: var(--dep-text-muted);
		opacity: 0.85;
	}

	.dep-overview-depth {
		padding: 0.1rem 0.35rem;
		border-radius: 0.25rem;
		background: rgba(100, 116, 139, 0.12);
		font-size: 0.6rem;
		font-weight: 700;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		color: var(--dep-text-muted);
	}

	.dep-overview-show-more {
		padding: 0.4rem;
		border: 1px dashed var(--dep-panel-border);
		border-radius: 0.5rem;
		background: transparent;
		color: var(--dep-chip-active);
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
	}

	.dep-overview-show-more:hover {
		border-color: var(--dep-chip-active);
		background: color-mix(in srgb, var(--dep-chip-active) 6%, var(--dep-bg));
	}

	.dep-overview-transitive {
		margin-top: 0.25rem;
		font-size: 0.75rem;
		color: var(--dep-text-muted);
	}

	.dep-overview-transitive summary {
		cursor: pointer;
		font-weight: 600;
		color: var(--dep-text);
		padding: 0.35rem 0;
	}

	.dep-overview-api-group {
		margin-top: 0.5rem;
	}

	.dep-overview-api-label {
		display: block;
		margin-bottom: 0.35rem;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--dep-text-muted);
	}

	.dep-overview-more-hint {
		margin: 0.25rem 0 0;
		font-size: 0.65rem;
		color: var(--dep-text-muted);
	}

	.dep-overview-view-crd {
		align-self: flex-start;
		padding: 0.55rem 0.85rem;
		border: none;
		border-radius: 0.5rem;
		background: var(--dep-chip-active);
		color: #fff;
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
	}

	.dep-overview-view-crd:hover {
		filter: brightness(0.92);
	}
</style>
