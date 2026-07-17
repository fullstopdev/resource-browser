<script lang="ts">
	import type { SchemaDepsTreeNode as TreeNode } from '$lib/schemaGraph/schemaDepsTree';
	import SchemaDepsTreeNode from './SchemaDepsTreeNode.svelte';

	interface Props {
		node: TreeNode;
		path: string;
		depth?: number;
		selectedSchema?: string;
		expanded: Record<string, boolean>;
		onToggle: (key: string) => void;
		onSelect: (schemaName: string) => void;
	}

	let {
		node,
		path,
		depth = 0,
		selectedSchema = '',
		expanded,
		onToggle,
		onSelect
	}: Props = $props();

	const key = $derived(
		`${path}/${node.schemaName}:${node.viaProperty}:${node.isBackEdge ? 'b' : 'f'}`
	);
	const hasChildren = $derived(node.children.length > 0);
	const open = $derived(expanded[key] ?? true);
</script>

<li class="oa-deps-tree__item">
	<div
		class="oa-deps-tree__row"
		class:oa-deps-tree__row--selected={selectedSchema === node.schemaName && !node.isBackEdge}
		class:oa-deps-tree__row--back={node.isBackEdge}
	>
		{#if hasChildren}
			<button
				type="button"
				class="oa-deps-tree__chevron"
				aria-expanded={open}
				aria-label={open ? 'Collapse' : 'Expand'}
				onclick={() => onToggle(key)}
			>
				{open ? '▾' : '▸'}
			</button>
		{:else}
			<span class="oa-deps-tree__chevron oa-deps-tree__chevron--spacer" aria-hidden="true"></span>
		{/if}

		<button type="button" class="oa-deps-tree__node" onclick={() => onSelect(node.schemaName)}>
			{#if node.viaProperty}
				<span class="oa-deps-tree__via" title={node.viaProperty}>{node.viaProperty}</span>
				<span class="oa-deps-tree__arrow" aria-hidden="true">→</span>
			{/if}
			<span class="oa-deps-tree__name">{node.schemaName}</span>
			{#if node.isBackEdge}
				<span class="oa-deps-tree__badge">cycle</span>
			{:else if node.isRecursive}
				<span class="oa-deps-tree__badge">recursive</span>
			{/if}
		</button>
	</div>

	{#if hasChildren && open}
		<ul class="oa-deps-tree__children">
			{#each node.children as child (`${key}/${child.schemaName}:${child.viaProperty}:${child.isBackEdge ? 'b' : 'f'}`)}
				<SchemaDepsTreeNode
					node={child}
					path={key}
					depth={depth + 1}
					{selectedSchema}
					{expanded}
					{onToggle}
					{onSelect}
				/>
			{/each}
		</ul>
	{/if}
</li>

<style>
	.oa-deps-tree__children {
		list-style: none;
		margin: 0 0 0 0.75rem;
		padding: 0 0 0 0.75rem;
		border-left: 1px solid color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 85%, transparent);
	}

	.oa-deps-tree__item {
		margin: 0;
		list-style: none;
	}

	.oa-deps-tree__row {
		display: flex;
		align-items: center;
		gap: 0.15rem;
		min-height: 2rem;
		padding: 0.1rem 0.25rem;
		border-radius: var(--oa-radius, 0.5rem);
	}

	.oa-deps-tree__row--selected {
		background: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 12%, transparent);
		box-shadow: inset 3px 0 0 var(--oa-focus-ring, #2563eb);
	}

	.oa-deps-tree__row--back .oa-deps-tree__name {
		font-style: italic;
		color: var(--oa-text-muted, #64748b);
	}

	.oa-deps-tree__chevron {
		flex: 0 0 1.25rem;
		width: 1.25rem;
		height: 1.5rem;
		border: none;
		background: transparent;
		color: var(--oa-text-muted, #64748b);
		cursor: pointer;
		font-size: 0.7rem;
		line-height: 1;
		padding: 0;
	}

	.oa-deps-tree__chevron--spacer {
		cursor: default;
	}

	.oa-deps-tree__node {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
		flex: 1 1 auto;
		border: none;
		background: transparent;
		padding: 0.25rem 0.35rem;
		border-radius: var(--oa-radius-sm, 0.375rem);
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		color: var(--oa-text, #0f172a);
	}

	.oa-deps-tree__node:hover {
		background: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 8%, transparent);
	}

	.oa-deps-tree__via {
		font-family: var(--oa-font-code, ui-monospace, monospace);
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--oa-link-ref, #4f46e5);
		max-width: 14rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.oa-deps-tree__arrow {
		color: var(--oa-text-muted, #64748b);
		font-size: 0.75rem;
	}

	.oa-deps-tree__name {
		font-family: var(--oa-font-code, ui-monospace, monospace);
		font-size: 0.8125rem;
		font-weight: 700;
	}

	.oa-deps-tree__badge {
		padding: 0.1rem 0.4rem;
		border-radius: 9999px;
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		background: rgba(251, 191, 36, 0.15);
		border: 1px solid rgba(251, 191, 36, 0.45);
		color: #d97706;
	}
</style>
