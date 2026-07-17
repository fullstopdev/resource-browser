<script lang="ts">
	import { tick } from 'svelte';
	import { browser } from '$app/environment';

	import Render from '$lib/components/Render.svelte';
	import { expandAll, expandAllScope, ulExpanded } from '$lib/store';
	import {
		collectEdaAnnotatedPaths,
		countNestedSchemaEntries,
		openApiComponentToRenderSchema,
		splitSpecStatusSections,
		type SchemaExplorerEntry
	} from '$lib/openapi/schemaBrowser';
	import VendorExtensionsSection from '$lib/openapi/components/VendorExtensionsSection.svelte';

	interface Props {
		entry: SchemaExplorerEntry;
		/** Root→current chain for this schema in the component tree. */
		ancestryPath?: SchemaExplorerEntry[];
		spec: Record<string, unknown>;
		darkMode?: boolean;
		initialFocusPath?: string;
		onNestedSelect?: (entry: SchemaExplorerEntry) => void;
	}

	let {
		entry,
		ancestryPath = [],
		spec,
		darkMode = false,
		initialFocusPath = '',
		onNestedSelect
	}: Props = $props();

	let specExpanded = $state(true);
	let statusExpanded = $state(true);
	let edaExpanded = $state(false);
	let nestedTreeExpanded = $state(true);
	let nestedBranchOpen = $state<Record<string, boolean>>({});
	let focusPath = $state('');
	let renderHash = $state('');

	const renderSchema = $derived(openApiComponentToRenderSchema(spec, entry.name));
	const sections = $derived(renderSchema ? splitSpecStatusSections(renderSchema) : null);
	const edaFields = $derived(collectEdaAnnotatedPaths(entry.properties));
	const edaFieldCount = $derived((entry.edaExtension ? 1 : 0) + edaFields.length);
	const nestedDescendantCount = $derived(countNestedSchemaEntries(entry));
	const ancestors = $derived(ancestryPath.length > 1 ? ancestryPath.slice(0, -1) : []);

	$effect(() => {
		entry.name;
		specExpanded = true;
		statusExpanded = true;
		edaExpanded = false;
		nestedTreeExpanded = true;
		nestedBranchOpen = {};
		focusPath = '';
		renderHash = '';
		expandAll.set(false);
		expandAllScope.set('local');
		ulExpanded.set([]);
	});

	function isBranchOpen(name: string, depth: number): boolean {
		return nestedBranchOpen[name] ?? depth < 1;
	}

	function toggleBranch(name: string, depth: number) {
		nestedBranchOpen = {
			...nestedBranchOpen,
			[name]: !isBranchOpen(name, depth)
		};
	}

	$effect(() => {
		if (initialFocusPath) {
			focusPath = initialFocusPath;
			renderHash = initialFocusPath;
			scrollToField(initialFocusPath);
		}
	});

	function handleGlobalExpand() {
		expandAllScope.set('global');
		if ($ulExpanded.length > 0) {
			expandAll.set(false);
		} else {
			expandAll.set(true);
		}
	}

	function scrollToField(fieldId: string, attemptsLeft = 20) {
		if (!browser || !fieldId) return;
		tick().then(() => {
			requestAnimationFrame(() => {
				const el = document.getElementById(fieldId);
				if (!el) {
					if (attemptsLeft > 0) {
						setTimeout(() => scrollToField(fieldId, attemptsLeft - 1), 50);
					}
					return;
				}
				el.scrollIntoView({ behavior: 'smooth', block: 'center' });
				try {
					(el as HTMLElement).focus({ preventScroll: true });
				} catch {
					/* ignore */
				}
				el.classList.add('bg-amber-100', 'dark:bg-amber-900/20');
				setTimeout(() => {
					el.classList.remove('bg-amber-100', 'dark:bg-amber-900/20');
				}, 2000);
			});
		});
	}

	function selectBreadcrumb(path: string) {
		focusPath = path;
		renderHash = path;
		scrollToField(path);
	}

	function breadcrumbSegments(path: string): string[] {
		return path.split('.').filter(Boolean);
	}

	function breadcrumbPrefix(path: string, index: number): string {
		return breadcrumbSegments(path)
			.slice(0, index + 1)
			.join('.');
	}
</script>

{#snippet nestedTreeNode(node: SchemaExplorerEntry, depth: number, isLast: boolean)}
	{@const childCount = countNestedSchemaEntries(node)}
	{@const hasChildren = Boolean(node.nestedEntries?.length)}
	{@const branchOpen = isBranchOpen(node.name, depth)}
	<li
		class="openapi-schema-detail__component-tree-node"
		class:openapi-schema-detail__component-tree-node--last={isLast}
		role="treeitem"
		aria-selected="false"
		aria-expanded={hasChildren ? branchOpen : undefined}
	>
		<div class="openapi-schema-detail__component-tree-row">
			{#if hasChildren}
				<button
					type="button"
					class="openapi-schema-detail__component-tree-toggle"
					aria-label={branchOpen ? `Collapse ${node.presentation.label}` : `Expand ${node.presentation.label}`}
					onclick={() => toggleBranch(node.name, depth)}
				>
					{branchOpen ? '▾' : '▸'}
				</button>
			{:else}
				<span class="openapi-schema-detail__component-tree-toggle-spacer" aria-hidden="true">└</span>
			{/if}
			{#if onNestedSelect}
				<button
					type="button"
					class="openapi-schema-detail__component-tree-link"
					onclick={() => onNestedSelect(node)}
				>
					<span class="openapi-schema-detail__nested-name">{node.presentation.label}</span>
					<span class="openapi-schema-detail__nested-type">{node.type}</span>
					{#if childCount > 0}
						<span class="openapi-schema-detail__component-tree-count">{childCount}</span>
					{/if}
				</button>
			{:else}
				<span class="openapi-schema-detail__component-tree-link openapi-schema-detail__component-tree-link--static">
					<span class="openapi-schema-detail__nested-name">{node.presentation.label}</span>
					<span class="openapi-schema-detail__nested-type">{node.type}</span>
				</span>
			{/if}
		</div>
		{#if hasChildren && branchOpen}
			<ul class="openapi-schema-detail__component-tree-list" role="group">
				{#each node.nestedEntries ?? [] as child, index (child.name)}
					{@render nestedTreeNode(child, depth + 1, index === (node.nestedEntries?.length ?? 0) - 1)}
				{/each}
			</ul>
		{/if}
	</li>
{/snippet}

<div class="openapi-schema-detail" class:openapi-schema-detail--dark={darkMode}>
	<header class="openapi-schema-detail__header">
		<div class="openapi-schema-detail__title-row">
			<div class="openapi-schema-detail__title-wrap">
				<div class="openapi-schema-detail__title">
					<h3 class="openapi-schema-detail__name">{entry.presentation.label}</h3>
					<span class="openapi-schema-detail__type">{entry.type}</span>
					{#if entry.presentation.isQueryRelated}
						<span class="openapi-schema-detail__query-badge">Query / EQL</span>
					{/if}
					{#if edaFieldCount > 0}
						<span class="openapi-schema-detail__eda-badge">{edaFieldCount} EDA UI</span>
					{/if}
				</div>
				<p class="openapi-schema-detail__technical">{entry.name}</p>
				{#if ancestors.length > 0}
					<nav class="openapi-schema-detail__ancestry" aria-label="Schema tree location">
						<span class="openapi-schema-detail__ancestry-label">In tree</span>
						{#each ancestryPath as step, index (step.name)}
							{#if index > 0}
								<span class="openapi-schema-detail__ancestry-sep" aria-hidden="true">›</span>
							{/if}
							{#if index < ancestryPath.length - 1 && onNestedSelect}
								<button
									type="button"
									class="openapi-schema-detail__ancestry-link"
									onclick={() => onNestedSelect(step)}
								>
									{step.presentation.label}
								</button>
							{:else}
								<span
									class="openapi-schema-detail__ancestry-current"
									aria-current={index === ancestryPath.length - 1 ? 'location' : undefined}
								>
									{step.presentation.label}
								</span>
							{/if}
						{/each}
					</nav>
				{/if}
				{#if entry.description}
					<p class="openapi-schema-detail__description">{entry.description}</p>
				{/if}
				<p class="openapi-schema-detail__meta">
					<span>{entry.presentation.subtitle}</span>
					{#if entry.parentName}
						<span>· nested under {entry.parentName}</span>
					{/if}
					{#if entry.properties.length > 0}
						<span>· {entry.properties.length} top-level fields</span>
					{/if}
					{#if nestedDescendantCount > 0}
						<span>· {nestedDescendantCount} nested type{nestedDescendantCount === 1 ? '' : 's'}</span>
					{/if}
				</p>
			</div>
			<div class="openapi-schema-detail__actions">
				{#if entry.crdCatalogHref}
					<a class="openapi-schema-detail__crd-link" href={entry.crdCatalogHref}>
						CRD catalog →
					</a>
				{/if}
				<button
					type="button"
					class="openapi-schema-detail__expand-btn"
					onclick={handleGlobalExpand}
					title={$ulExpanded.length > 0 ? 'Collapse all fields' : 'Expand all fields'}
				>
					<svg
						class="openapi-schema-detail__expand-icon"
						class:openapi-schema-detail__expand-icon--open={$ulExpanded.length > 0}
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
					</svg>
					<span>{$ulExpanded.length > 0 ? 'Collapse' : 'Expand'} all</span>
				</button>
			</div>
		</div>
	</header>

	<div class="openapi-schema-detail__body">
		{#if entry.extensions.length > 0}
			<div class="openapi-schema-detail__extensions">
				<VendorExtensionsSection extensions={entry.extensions} {darkMode} title="Schema extensions" />
			</div>
		{/if}

		{#if focusPath}
			<nav class="openapi-schema-detail__breadcrumb" aria-label="Property path">
				{#each breadcrumbSegments(focusPath) as segment, index (index)}
					{#if index > 0}
						<span class="openapi-schema-detail__breadcrumb-sep" aria-hidden="true">›</span>
					{/if}
					<button
						type="button"
						class="openapi-schema-detail__breadcrumb-link"
						onclick={() => selectBreadcrumb(breadcrumbPrefix(focusPath, index))}
					>
						{segment}
					</button>
				{/each}
			</nav>
		{/if}

		{#if !renderSchema}
			<div class="openapi-schema-detail__error">Could not load schema definition.</div>
		{:else if sections?.spec || sections?.status}
			<div class="openapi-schema-detail__sections">
				{#if sections.spec}
					<section class="openapi-schema-detail__card">
						<button
							type="button"
							class="openapi-schema-detail__card-header"
							onclick={() => (specExpanded = !specExpanded)}
							aria-expanded={specExpanded}
						>
							<div>
								<h4 class="openapi-schema-detail__card-title">Specification</h4>
								<p class="openapi-schema-detail__card-subtitle">Required configuration fields</p>
							</div>
							<svg
								class="openapi-schema-detail__card-chevron"
								class:openapi-schema-detail__card-chevron--open={specExpanded}
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
							</svg>
						</button>
						{#if specExpanded}
							<div class="openapi-schema-detail__tree">
								<Render
									hash={renderHash}
									source="eda"
									type="spec"
									data={sections.spec}
									showType={false}
									onResourcePage={true}
								/>
							</div>
						{/if}
					</section>
				{/if}

				{#if sections.status}
					<section class="openapi-schema-detail__card">
						<button
							type="button"
							class="openapi-schema-detail__card-header"
							onclick={() => (statusExpanded = !statusExpanded)}
							aria-expanded={statusExpanded}
						>
							<div>
								<h4 class="openapi-schema-detail__card-title">Status</h4>
								<p class="openapi-schema-detail__card-subtitle">Runtime status fields</p>
							</div>
							<svg
								class="openapi-schema-detail__card-chevron"
								class:openapi-schema-detail__card-chevron--open={statusExpanded}
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
							</svg>
						</button>
						{#if statusExpanded}
							<div class="openapi-schema-detail__tree">
								<Render
									hash={renderHash}
									source="eda"
									type="status"
									data={sections.status}
									showType={false}
									onResourcePage={true}
								/>
							</div>
						{/if}
					</section>
				{/if}
			</div>
		{:else if sections?.root}
			<section class="openapi-schema-detail__card">
				<div class="openapi-schema-detail__card-header openapi-schema-detail__card-header--static">
					<div>
						<h4 class="openapi-schema-detail__card-title">Properties</h4>
						<p class="openapi-schema-detail__card-subtitle">Schema fields and nested objects</p>
					</div>
				</div>
				<div class="openapi-schema-detail__tree">
					<Render
						hash={renderHash}
						source="eda"
						type="schema"
						data={sections.root}
						showType={false}
						onResourcePage={true}
					/>
				</div>
			</section>
		{/if}

		{#if entry.nestedEntries?.length}
			<section class="openapi-schema-detail__card openapi-schema-detail__card--nested">
				<button
					type="button"
					class="openapi-schema-detail__card-header"
					onclick={() => (nestedTreeExpanded = !nestedTreeExpanded)}
					aria-expanded={nestedTreeExpanded}
				>
					<div>
						<h4 class="openapi-schema-detail__card-title">Component type tree</h4>
						<p class="openapi-schema-detail__card-subtitle">
							{nestedDescendantCount} nested schema{nestedDescendantCount === 1 ? '' : 's'} under
							{entry.presentation.label}
						</p>
					</div>
					<svg
						class="openapi-schema-detail__card-chevron"
						class:openapi-schema-detail__card-chevron--open={nestedTreeExpanded}
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
					</svg>
				</button>
				{#if nestedTreeExpanded}
					<div class="openapi-schema-detail__component-tree" role="tree" aria-label="Nested component schemas">
						<div class="openapi-schema-detail__component-tree-root" role="none">
							<span class="openapi-schema-detail__component-tree-root-label">{entry.presentation.label}</span>
							<span class="openapi-schema-detail__nested-type">{entry.type}</span>
						</div>
						<ul class="openapi-schema-detail__component-tree-list">
							{#each entry.nestedEntries as nested, index (nested.name)}
								{@render nestedTreeNode(nested, 0, index === entry.nestedEntries.length - 1)}
							{/each}
						</ul>
					</div>
				{/if}
			</section>
		{/if}

		{#if edaFieldCount > 0}
			<section class="openapi-schema-detail__card openapi-schema-detail__card--eda">
				<button
					type="button"
					class="openapi-schema-detail__card-header"
					onclick={() => (edaExpanded = !edaExpanded)}
					aria-expanded={edaExpanded}
				>
					<div>
						<h4 class="openapi-schema-detail__card-title">EDA UI metadata</h4>
						<p class="openapi-schema-detail__card-subtitle">
							Nokia EDA UI annotations on {edaFieldCount} field{edaFieldCount === 1 ? '' : 's'}
						</p>
					</div>
					<svg
						class="openapi-schema-detail__card-chevron"
						class:openapi-schema-detail__card-chevron--open={edaExpanded}
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
					</svg>
				</button>
				{#if edaExpanded}
					<div class="openapi-schema-detail__eda-body">
						{#if entry.edaExtension}
							<div>
								<p class="openapi-schema-detail__eda-path">{entry.name}</p>
								<VendorExtensionsSection
									extensions={entry.extensions.filter((ext) => ext.key === 'x-eda-nokia-com')}
									{darkMode}
									compact
									title="Schema-level EDA"
									propertyName={entry.name}
								/>
							</div>
						{/if}
						{#each edaFields as field (field.path)}
							<div>
								<button
									type="button"
									class="openapi-schema-detail__eda-field-link"
									onclick={() => selectBreadcrumb(field.path)}
								>
									{field.path}
								</button>
								<VendorExtensionsSection
									extensions={field.extensions}
									{darkMode}
									compact
									title="Field EDA"
									propertyName={field.name}
								/>
							</div>
						{/each}
					</div>
				{/if}
			</section>
		{/if}
	</div>
</div>

<style>
	.openapi-schema-detail {
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;
	}

	.openapi-schema-detail__header {
		flex-shrink: 0;
		padding-bottom: 0.875rem;
		border-bottom: 1px solid #e2e8f0;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__header {
		border-bottom-color: rgba(56, 100, 150, 0.35);
	}

	.openapi-schema-detail__title-row {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.openapi-schema-detail__title-wrap {
		flex: 1 1 12rem;
		min-width: 0;
	}

	.openapi-schema-detail__title {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.openapi-schema-detail__name {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		color: #0f172a;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__name {
		color: #f1f5f9;
	}

	.openapi-schema-detail__type {
		font-family: 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.75rem;
		color: #2563eb;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__type {
		color: #93c5fd;
	}

	.openapi-schema-detail__query-badge {
		border-radius: 9999px;
		padding: 0.125rem 0.5rem;
		font-size: 0.6875rem;
		font-weight: 700;
		background: rgba(124, 58, 237, 0.12);
		color: #6d28d9;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__query-badge {
		background: rgba(167, 139, 250, 0.15);
		color: #c4b5fd;
	}

	.openapi-schema-detail__eda-badge {
		border-radius: 9999px;
		padding: 0.125rem 0.5rem;
		font-size: 0.6875rem;
		font-weight: 700;
		background: rgba(37, 99, 235, 0.12);
		color: #2563eb;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__eda-badge {
		background: rgba(96, 165, 250, 0.15);
		color: #93c5fd;
	}

	.openapi-schema-detail__technical {
		margin: 0.25rem 0 0;
		font-family: 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.6875rem;
		color: #64748b;
		word-break: break-all;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__technical {
		color: #94a3b8;
	}

	.openapi-schema-detail__description {
		margin: 0.625rem 0 0;
		font-size: 0.8125rem;
		line-height: 1.55;
		color: #475569;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__description {
		color: #94a3b8;
	}

	.openapi-schema-detail__meta {
		margin: 0.375rem 0 0;
		font-size: 0.75rem;
		color: #64748b;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__meta {
		color: #94a3b8;
	}

	.openapi-schema-detail__actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.openapi-schema-detail__crd-link {
		font-size: 0.8125rem;
		font-weight: 600;
		color: #2563eb;
		text-decoration: none;
	}

	.openapi-schema-detail__crd-link:hover {
		text-decoration: underline;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__crd-link {
		color: #93c5fd;
	}

	.openapi-schema-detail__expand-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		border: 1px solid #e2e8f0;
		border-radius: 0.5rem;
		padding: 0.375rem 0.75rem;
		font-size: 0.8125rem;
		font-weight: 600;
		font-family: inherit;
		background: #ffffff;
		color: #334155;
		cursor: pointer;
		transition:
			border-color 0.12s ease,
			background 0.12s ease;
	}

	.openapi-schema-detail__expand-btn:hover {
		border-color: #2563eb;
		background: #f8fafc;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__expand-btn {
		border-color: rgba(56, 100, 150, 0.35);
		background: rgba(15, 23, 42, 0.85);
		color: #cbd5e1;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__expand-btn:hover {
		border-color: #60a5fa;
		background: rgba(56, 100, 150, 0.2);
	}

	.openapi-schema-detail__expand-icon {
		width: 1rem;
		height: 1rem;
		transition: transform 0.15s ease;
	}

	.openapi-schema-detail__expand-icon--open {
		transform: rotate(180deg);
	}

	.openapi-schema-detail__body {
		flex: 1 1 auto;
		min-height: 0;
		overflow: auto;
		padding-top: 0.875rem;
	}

	.openapi-schema-detail__extensions {
		margin-bottom: 0.75rem;
	}

	.openapi-schema-detail__breadcrumb {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
		margin-bottom: 0.75rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid #e2e8f0;
		border-radius: 0.5rem;
		background: #f8fafc;
		font-size: 0.8125rem;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__breadcrumb {
		border-color: rgba(56, 100, 150, 0.35);
		background: rgba(15, 23, 42, 0.5);
	}

	.openapi-schema-detail__breadcrumb-sep {
		color: #94a3b8;
	}

	.openapi-schema-detail__breadcrumb-link {
		border: none;
		background: none;
		padding: 0;
		font-family: 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.75rem;
		color: #2563eb;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__breadcrumb-link {
		color: #93c5fd;
	}

	.openapi-schema-detail__error {
		border: 1px solid #fecaca;
		border-radius: 0.625rem;
		background: #fef2f2;
		padding: 1.5rem;
		text-align: center;
		font-size: 0.875rem;
		color: #b91c1c;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__error {
		border-color: rgba(248, 113, 113, 0.35);
		background: rgba(127, 29, 29, 0.2);
		color: #fca5a5;
	}

	.openapi-schema-detail__sections {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.openapi-schema-detail__card {
		overflow: hidden;
		border: 1px solid #e2e8f0;
		border-radius: 0.625rem;
		background: #ffffff;
		box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
	}

	.openapi-schema-detail--dark .openapi-schema-detail__card {
		border-color: rgba(56, 100, 150, 0.35);
		background: rgba(15, 42, 72, 0.35);
		box-shadow: none;
	}

	.openapi-schema-detail__card--eda {
		margin-top: 0.75rem;
		border-color: rgba(37, 99, 235, 0.25);
		background: rgba(239, 246, 255, 0.5);
	}

	.openapi-schema-detail--dark .openapi-schema-detail__card--eda {
		border-color: rgba(96, 165, 250, 0.25);
		background: rgba(15, 42, 72, 0.25);
	}

	.openapi-schema-detail__card-header {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem;
		border: none;
		border-bottom: 1px solid #f1f5f9;
		background: none;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		transition: background 0.12s ease;
	}

	.openapi-schema-detail__card-header:hover {
		background: #f8fafc;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__card-header {
		border-bottom-color: rgba(56, 100, 150, 0.2);
	}

	.openapi-schema-detail--dark .openapi-schema-detail__card-header:hover {
		background: rgba(56, 100, 150, 0.15);
	}

	.openapi-schema-detail__card-header--static {
		cursor: default;
	}

	.openapi-schema-detail__card-header--static:hover {
		background: none;
	}

	.openapi-schema-detail__card-title {
		margin: 0;
		font-family: 'NokiaPureHeadline', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__card-title {
		color: #94a3b8;
	}

	.openapi-schema-detail__card-subtitle {
		margin: 0.125rem 0 0;
		font-size: 0.75rem;
		color: #94a3b8;
	}

	.openapi-schema-detail__card-chevron {
		width: 1rem;
		height: 1rem;
		flex-shrink: 0;
		color: #94a3b8;
		transition: transform 0.15s ease;
	}

	.openapi-schema-detail__card-chevron--open {
		transform: rotate(180deg);
	}

	.openapi-schema-detail__tree {
		overflow-x: auto;
		padding: 0.75rem;
		font-size: 0.8125rem;
	}

	.openapi-schema-detail__ancestry {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		margin: 0.5rem 0 0;
		padding: 0.45rem 0.625rem;
		border: 1px solid #e2e8f0;
		border-left: 3px solid #2563eb;
		border-radius: 0.5rem;
		background: #f8fafc;
		font-size: 0.75rem;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__ancestry {
		border-color: rgba(56, 100, 150, 0.35);
		border-left-color: #60a5fa;
		background: rgba(15, 23, 42, 0.55);
	}

	.openapi-schema-detail__ancestry-label {
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: #64748b;
		font-size: 0.625rem;
	}

	.openapi-schema-detail__ancestry-sep {
		color: #94a3b8;
	}

	.openapi-schema-detail__ancestry-link {
		border: none;
		background: none;
		padding: 0;
		font-family: 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.75rem;
		color: #2563eb;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__ancestry-link {
		color: #93c5fd;
	}

	.openapi-schema-detail__ancestry-current {
		font-family: 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.75rem;
		font-weight: 700;
		color: #0f172a;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__ancestry-current {
		color: #f1f5f9;
	}

	.openapi-schema-detail__component-tree {
		padding: 0.75rem;
	}

	.openapi-schema-detail__component-tree-root {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		margin-bottom: 0.5rem;
		padding: 0.4rem 0.5rem;
		border-radius: 0.4rem;
		background: rgba(37, 99, 235, 0.08);
	}

	.openapi-schema-detail--dark .openapi-schema-detail__component-tree-root {
		background: rgba(96, 165, 250, 0.1);
	}

	.openapi-schema-detail__component-tree-root-label {
		font-size: 0.8125rem;
		font-weight: 700;
		color: #0f172a;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__component-tree-root-label {
		color: #f1f5f9;
	}

	.openapi-schema-detail__component-tree-list {
		list-style: none;
		margin: 0;
		padding: 0 0 0 0.75rem;
		margin-left: 0.45rem;
		border-left: 1px solid #cbd5e1;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__component-tree-list {
		border-left-color: rgba(56, 100, 150, 0.45);
	}

	.openapi-schema-detail__component-tree-node {
		position: relative;
		margin: 0.2rem 0;
	}

	.openapi-schema-detail__component-tree-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.openapi-schema-detail__component-tree-toggle,
	.openapi-schema-detail__component-tree-toggle-spacer {
		flex: 0 0 1.1rem;
		width: 1.1rem;
		border: none;
		background: none;
		padding: 0;
		font-size: 0.6875rem;
		color: #64748b;
		cursor: pointer;
		font-family: inherit;
		text-align: center;
	}

	.openapi-schema-detail__component-tree-toggle-spacer {
		cursor: default;
		color: #94a3b8;
	}

	.openapi-schema-detail__component-tree-link {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		border: 1px solid transparent;
		border-radius: 0.375rem;
		padding: 0.25rem 0.45rem;
		background: transparent;
		cursor: pointer;
		font-family: inherit;
		text-align: left;
		transition: background 0.12s ease;
	}

	.openapi-schema-detail__component-tree-link:hover {
		background: rgba(37, 99, 235, 0.08);
		border-color: rgba(37, 99, 235, 0.2);
	}

	.openapi-schema-detail--dark .openapi-schema-detail__component-tree-link:hover {
		background: rgba(96, 165, 250, 0.1);
		border-color: rgba(96, 165, 250, 0.25);
	}

	.openapi-schema-detail__component-tree-link--static {
		cursor: default;
	}

	.openapi-schema-detail__component-tree-count {
		border-radius: 9999px;
		padding: 0.05rem 0.35rem;
		font-size: 0.625rem;
		font-weight: 700;
		background: #e2e8f0;
		color: #475569;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__component-tree-count {
		background: rgba(56, 100, 150, 0.35);
		color: #cbd5e1;
	}

	.openapi-schema-detail__nested-name {
		font-size: 0.8125rem;
		font-weight: 600;
		color: #0f172a;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__nested-name {
		color: #f1f5f9;
	}

	.openapi-schema-detail__nested-type {
		font-family: 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.6875rem;
		color: #2563eb;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__nested-type {
		color: #93c5fd;
	}

	.openapi-schema-detail__eda-body {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.75rem;
	}

	.openapi-schema-detail__eda-path {
		margin: 0 0 0.25rem;
		font-family: 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.75rem;
		font-weight: 600;
		color: #64748b;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__eda-path {
		color: #94a3b8;
	}

	.openapi-schema-detail__eda-field-link {
		margin: 0 0 0.25rem;
		border: none;
		background: none;
		padding: 0;
		font-family: 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.75rem;
		font-weight: 600;
		color: #2563eb;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.openapi-schema-detail--dark .openapi-schema-detail__eda-field-link {
		color: #93c5fd;
	}
</style>
