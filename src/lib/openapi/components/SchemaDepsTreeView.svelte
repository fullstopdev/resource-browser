<script lang="ts">
	import type { SchemaDepsTreeNode } from '$lib/schemaGraph/schemaDepsTree';
	import SchemaDepsTreeNodeView from './SchemaDepsTreeNode.svelte';

	interface Props {
		tree: SchemaDepsTreeNode | null;
		selectedSchema?: string;
		onSelect: (schemaName: string) => void;
	}

	let { tree, selectedSchema = '', onSelect }: Props = $props();

	let expanded = $state<Record<string, boolean>>({});

	function onToggle(key: string) {
		expanded = { ...expanded, [key]: !(expanded[key] ?? true) };
	}

	$effect(() => {
		tree;
		expanded = {};
	});
</script>

{#if !tree}
	<p class="oa-deps-tree__empty">Select a root schema to explore $ref dependencies.</p>
{:else}
	<ul class="oa-deps-tree" aria-label="Schema $ref dependency tree">
		<SchemaDepsTreeNodeView
			node={tree}
			path="root"
			{selectedSchema}
			{expanded}
			{onToggle}
			{onSelect}
		/>
	</ul>
{/if}

<style>
	.oa-deps-tree {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.oa-deps-tree__empty {
		margin: 0;
		padding: 2rem 1rem;
		text-align: center;
		font-size: 0.875rem;
		color: var(--oa-text-muted, #64748b);
	}
</style>
