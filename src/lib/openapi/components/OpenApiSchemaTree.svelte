<script lang="ts">
	import {
		getEdaFieldPresentation,
		type EdaFieldPresentation
	} from '$lib/openapi/edaPresentation';
	import {
		CIRCULAR_REF_MARKER,
		type JsonSchemaObject,
		type SchemaPropertyNode
	} from '$lib/openapi/schemaBrowser';
	import { createSchemaResolver } from '$lib/openapi/schemaResolver';

	interface Props {
		spec: Record<string, unknown>;
		schema?: JsonSchemaObject;
		schemaRef?: string;
		title?: string;
		darkMode?: boolean;
		defaultExpanded?: boolean;
		onSchemaRefClick?: (schemaName: string) => void;
	}

	let {
		spec,
		schema,
		schemaRef = '',
		title = 'Schema',
		darkMode = false,
		defaultExpanded = false,
		onSchemaRefClick
	}: Props = $props();

	let expanded = $state(false);
	let openNodes = $state<Record<string, boolean>>({});

	const resolver = $derived(createSchemaResolver(spec));

	$effect(() => {
		schemaRef;
		title;
		expanded = defaultExpanded;
		openNodes = {};
	});

	const rootSchema = $derived.by((): JsonSchemaObject | null => {
		if (schema && Object.keys(schema).length > 0) return schema;
		if (schemaRef) {
			const resolved = resolver.resolveRef(schemaRef);
			return resolved ?? { $ref: `#/components/schemas/${schemaRef}` };
		}
		return null;
	});

	const propertyTree = $derived.by(() => {
		if (!expanded || !rootSchema) return [];
		return resolver.buildTree(rootSchema);
	});

	const typeLabel = $derived.by(() => {
		if (!rootSchema) return '';
		return resolver.describe(rootSchema);
	});

	/** Avoid duplicating the schema name when describe() returns the same $ref name. */
	const showTypeLabel = $derived(Boolean(typeLabel) && typeLabel !== schemaRef);

	type PropertyRow =
		| { kind: 'single'; node: SchemaPropertyNode }
		| { kind: 'group'; group: string; nodes: SchemaPropertyNode[] };

	function edaFor(node: SchemaPropertyNode): EdaFieldPresentation {
		return getEdaFieldPresentation(node.name, node.edaExtension);
	}

	function groupPropertyRows(nodes: SchemaPropertyNode[]): PropertyRow[] {
		const rows: PropertyRow[] = [];
		let i = 0;
		while (i < nodes.length) {
			const node = nodes[i]!;
			const groupName = node.edaExtension?.['ui-single-line-group'];
			if (groupName) {
				const grouped: SchemaPropertyNode[] = [node];
				let j = i + 1;
				while (j < nodes.length) {
					const next = nodes[j]!;
					if (next.edaExtension?.['ui-single-line-group'] === groupName) {
						grouped.push(next);
						j++;
					} else break;
				}
				rows.push({ kind: 'group', group: String(groupName), nodes: grouped });
				i = j;
			} else {
				rows.push({ kind: 'single', node });
				i++;
			}
		}
		return rows;
	}

	function isNodeOpen(path: string, hasChildren: boolean): boolean {
		if (!hasChildren) return false;
		return openNodes[path] ?? false;
	}

	function toggleNode(path: string, hasChildren: boolean) {
		if (!hasChildren) return;
		openNodes = { ...openNodes, [path]: !isNodeOpen(path, hasChildren) };
	}

	function isMarkerDescription(description: string): boolean {
		return description === CIRCULAR_REF_MARKER || description.startsWith('unresolved reference:');
	}

	function formatGroupLabel(group: string): string {
		return group.replace(/[_-]+/g, ' ');
	}
</script>

{#snippet propertyMeta(node: SchemaPropertyNode, eda: EdaFieldPresentation)}
	<div class="openapi-schema-tree__head">
		<span class="openapi-schema-tree__name">{eda.label.title}</span>
		{#if eda.label.secondaryName}
			<code class="openapi-schema-tree__prop-name">{eda.label.secondaryName}</code>
		{/if}
		{#if node.required}
			<span class="openapi-schema-tree__required">required</span>
		{/if}
		{#if node.readOnly}
			<span class="openapi-schema-tree__chip openapi-schema-tree__chip--warn" title="Read-only property"
				>readOnly</span
			>
		{/if}
		{#if node.writeOnly}
			<span class="openapi-schema-tree__chip openapi-schema-tree__chip--neutral" title="Write-only property"
				>writeOnly</span
			>
		{/if}
		<code class="openapi-schema-tree__type">{node.type}</code>
		{#if eda.visibleIfLabel}
			<span class="openapi-schema-tree__visible-if" title={eda.visibleIf}>
				{eda.visibleIfLabel}
			</span>
		{/if}
	</div>
	{#if eda.chips.length > 0}
		<div class="openapi-schema-tree__chips" role="list">
			{#each eda.chips as chip (chip.id)}
				<span
					class="openapi-schema-tree__chip openapi-schema-tree__chip--{chip.tone}"
					role="listitem"
					title={chip.title}
				>
					{chip.label}
				</span>
			{/each}
		</div>
	{/if}
	{#if eda.sections.length > 0}
		<div class="openapi-schema-tree__eda-sections">
			{#each eda.sections as section (section.id)}
				<div class="openapi-schema-tree__eda-section">
					<span class="openapi-schema-tree__eda-section-label">{section.label}</span>
					<ul class="openapi-schema-tree__eda-section-list">
						{#each section.items as item (item)}
							<li><code>{item}</code></li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
	{/if}
	{#if eda.summary}
		<p class="openapi-schema-tree__eda-summary">{eda.summary}</p>
	{/if}
	{#if eda.description}
		<p class="openapi-schema-tree__eda-desc">{eda.description}</p>
	{/if}
	{#if node.description && !isMarkerDescription(node.description)}
		<p class="openapi-schema-tree__description">{node.description}</p>
	{:else if isMarkerDescription(node.description)}
		<p class="openapi-schema-tree__marker">{node.description}</p>
	{/if}
	{#if node.constraints.length > 0}
		{@const visibleConstraints = node.constraints.filter(
			(c) => c !== 'readOnly' && c !== 'writeOnly'
		)}
		{#if visibleConstraints.length > 0}
			<ul class="openapi-schema-tree__constraints">
				{#each visibleConstraints as constraint (constraint)}
					<li>{constraint}</li>
				{/each}
			</ul>
		{/if}
	{/if}
	{#if node.example}
		<div class="openapi-schema-tree__example">
			<span class="openapi-schema-tree__example-label">Example</span>
			<code class="openapi-schema-tree__example-value">{node.example}</code>
		</div>
	{/if}
{/snippet}

{#snippet propertyNode(node: SchemaPropertyNode, depth: number)}
	{@const eda = edaFor(node)}
	{@const hasChildren = node.children.length > 0}
	{@const open = isNodeOpen(node.path, hasChildren)}
	<li class="openapi-schema-tree__item" style:--depth={depth}>
		<div class="openapi-schema-tree__row">
			{#if hasChildren}
				<button
					type="button"
					class="openapi-schema-tree__toggle"
					aria-expanded={open}
					aria-label={open ? `Collapse ${eda.label.title}` : `Expand ${eda.label.title}`}
					onclick={() => toggleNode(node.path, hasChildren)}
				>
					{open ? '▾' : '▸'}
				</button>
			{:else}
				<span class="openapi-schema-tree__toggle-spacer" aria-hidden="true"></span>
			{/if}
			<div class="openapi-schema-tree__content">
				{@render propertyMeta(node, eda)}
			</div>
		</div>
		{#if hasChildren && open}
			<ul class="openapi-schema-tree__children">
				{#each groupPropertyRows(node.children) as row (row.kind === 'group' ? row.group : row.node.path)}
					{#if row.kind === 'group'}
						{@render inlineGroup(row.group, row.nodes, depth)}
					{:else}
						{@render propertyNode(row.node, depth + 1)}
					{/if}
				{/each}
			</ul>
		{/if}
	</li>
{/snippet}

{#snippet inlineGroup(group: string, nodes: SchemaPropertyNode[], depth: number)}
	<li class="openapi-schema-tree__inline-group" style:--depth={depth}>
		<span class="openapi-schema-tree__inline-group-label">{formatGroupLabel(group)}</span>
		<div class="openapi-schema-tree__inline-group-fields">
			{#each nodes as groupedNode (groupedNode.path)}
				{@const eda = edaFor(groupedNode)}
				<div class="openapi-schema-tree__inline-field">
					<span class="openapi-schema-tree__inline-field-title">{eda.label.title}</span>
					{#if eda.label.secondaryName}
						<code class="openapi-schema-tree__prop-name">{eda.label.secondaryName}</code>
					{/if}
					<code class="openapi-schema-tree__type">{groupedNode.type}</code>
					{#if groupedNode.readOnly}
						<span
							class="openapi-schema-tree__chip openapi-schema-tree__chip--warn"
							title="Read-only property">readOnly</span
						>
					{/if}
					{#if groupedNode.writeOnly}
						<span
							class="openapi-schema-tree__chip openapi-schema-tree__chip--neutral"
							title="Write-only property">writeOnly</span
						>
					{/if}
					{#if eda.visibleIfLabel}
						<span class="openapi-schema-tree__visible-if" title={eda.visibleIf}>
							{eda.visibleIfLabel}
						</span>
					{/if}
					{#each eda.chips as chip (chip.id)}
						<span
							class="openapi-schema-tree__chip openapi-schema-tree__chip--{chip.tone}"
							title={chip.title}
						>
							{chip.label}
						</span>
					{/each}
				</div>
			{/each}
		</div>
	</li>
{/snippet}

<section class="openapi-schema-tree" class:openapi-schema-tree--dark={darkMode}>
	<div class="openapi-schema-tree__header">
		<button
			type="button"
			class="openapi-schema-tree__expand"
			aria-expanded={expanded}
			onclick={() => (expanded = !expanded)}
		>
			<span class="openapi-schema-tree__chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
			<span class="openapi-schema-tree__title">{title}</span>
			{#if showTypeLabel}
				<code class="openapi-schema-tree__root-type">{typeLabel}</code>
			{/if}
		</button>
		{#if schemaRef}
			{#if onSchemaRefClick}
				<button
					type="button"
					class="openapi-schema-tree__ref openapi-schema-tree__ref--chip openapi-schema-tree__ref--btn"
					onclick={() => onSchemaRefClick(schemaRef)}
				>
					{schemaRef}
				</button>
			{:else}
				<span class="openapi-schema-tree__ref openapi-schema-tree__ref--chip">{schemaRef}</span>
			{/if}
		{/if}
	</div>

	{#if expanded && rootSchema}
		{#if propertyTree.length === 0}
			<p class="openapi-schema-tree__empty">
				{#if rootSchema.description && isMarkerDescription(String(rootSchema.description))}
					<span class="openapi-schema-tree__marker">{rootSchema.description}</span>
				{:else}
					No properties defined.
				{/if}
			</p>
		{:else}
			<ul class="openapi-schema-tree__list">
				{#each groupPropertyRows(propertyTree) as row (row.kind === 'group' ? row.group : row.node.path)}
					{#if row.kind === 'group'}
						{@render inlineGroup(row.group, row.nodes, 0)}
					{:else}
						{@render propertyNode(row.node, 0)}
					{/if}
				{/each}
			</ul>
		{/if}
	{/if}
</section>

<style>
	.openapi-schema-tree {
		border: 1px solid var(--oa-panel-border, #e2e8f0);
		border-radius: var(--oa-radius, 0.5rem);
		background: var(--oa-panel, #ffffff);
		overflow: hidden;
		box-shadow: 0 1px 0 color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 50%, transparent);
	}

	.openapi-schema-tree--dark {
		border-color: var(--oa-panel-border, rgba(56, 100, 150, 0.35));
		background: color-mix(in srgb, var(--oa-panel, rgba(15, 42, 72, 0.88)) 92%, transparent);
	}

	.openapi-schema-tree__header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.7rem;
		background: color-mix(in srgb, var(--oa-canvas-bottom, #f1f5f9) 55%, var(--oa-panel, #fff));
		border-bottom: 1px solid color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 70%, transparent);
	}

	.openapi-schema-tree--dark .openapi-schema-tree__header {
		background: color-mix(in srgb, var(--oa-canvas-top, rgba(15, 42, 72, 0.55)) 55%, transparent);
	}

	.openapi-schema-tree__expand {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		flex: 1 1 auto;
		min-width: 0;
		padding: 0.2rem 0.1rem;
		border: none;
		background: transparent;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
	}

	.openapi-schema-tree__expand:focus-visible {
		outline: none;
		border-radius: var(--oa-radius-sm, 0.375rem);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--oa-focus-ring, #2563eb) 35%, transparent);
	}

	.openapi-schema-tree__chevron {
		color: var(--oa-text-muted, #64748b);
		font-size: 0.75rem;
	}

	.openapi-schema-tree__title {
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--oa-text, #0f172a);
	}

	.openapi-schema-tree__root-type {
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.6875rem;
		color: var(--oa-text-muted, #64748b);
	}

	.openapi-schema-tree__ref {
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.6875rem;
		color: var(--oa-link-ref, #4f46e5);
	}

	.openapi-schema-tree__ref--chip {
		display: inline-flex;
		align-items: center;
		border-radius: 9999px;
		padding: 0.12rem 0.5rem;
		font-weight: 600;
		border: 1px solid color-mix(in srgb, var(--oa-link-ref, #4f46e5) 28%, transparent);
		background: color-mix(in srgb, var(--oa-link-ref, #4f46e5) 10%, transparent);
	}

	.openapi-schema-tree__ref--btn {
		cursor: pointer;
		font-family: inherit;
		line-height: 1.2;
		transition: background 0.12s ease;
	}

	.openapi-schema-tree__ref--btn:hover {
		background: color-mix(in srgb, var(--oa-link-ref, #4f46e5) 18%, transparent);
	}

	.openapi-schema-tree__list,
	.openapi-schema-tree__children {
		list-style: none;
		margin: 0;
		padding: 0.55rem 0.75rem 0.8rem;
	}

	.openapi-schema-tree__children {
		padding-left: calc(0.75rem + var(--depth, 0) * 0.7rem);
		border-left: 1px solid color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 85%, transparent);
		margin-left: 0.55rem;
	}

	.openapi-schema-tree__row {
		display: flex;
		gap: 0.25rem;
		align-items: flex-start;
	}

	.openapi-schema-tree__toggle,
	.openapi-schema-tree__toggle-spacer {
		flex: 0 0 1rem;
		width: 1rem;
		height: 1.5rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: none;
		background: none;
		font-size: 0.6875rem;
		color: var(--oa-text-muted, #64748b);
		cursor: pointer;
		font-family: inherit;
	}

	.openapi-schema-tree__toggle-spacer {
		cursor: default;
	}

	.openapi-schema-tree__content {
		flex: 1 1 auto;
		min-width: 0;
		padding-bottom: 0.55rem;
	}

	.openapi-schema-tree__head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}

	.openapi-schema-tree__name {
		font-size: 0.8125rem;
		font-weight: 650;
		color: var(--oa-text, #0f172a);
	}

	.openapi-schema-tree__prop-name {
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.625rem;
		font-weight: 500;
		color: var(--oa-text-muted, #64748b);
		opacity: 0.9;
	}

	.openapi-schema-tree__required {
		border-radius: 9999px;
		padding: 0.05rem 0.35rem;
		font-size: 0.625rem;
		font-weight: 700;
		background: color-mix(in srgb, var(--oa-method-delete, #dc2626) 10%, transparent);
		color: var(--oa-method-delete, #dc2626);
	}

	.openapi-schema-tree__type {
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.625rem;
		color: var(--oa-method-get, #2563eb);
	}

	.openapi-schema-tree__visible-if {
		border-radius: 9999px;
		padding: 0.05rem 0.4rem;
		font-size: 0.625rem;
		font-weight: 600;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		background: color-mix(in srgb, var(--oa-method-put, #d97706) 12%, transparent);
		color: var(--oa-method-put, #d97706);
		border: 1px solid color-mix(in srgb, var(--oa-method-put, #d97706) 22%, transparent);
		cursor: help;
	}

	.openapi-schema-tree__chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-top: 0.3rem;
	}

	.openapi-schema-tree__eda-sections {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-top: 0.35rem;
	}

	.openapi-schema-tree__eda-section {
		padding: 0.35rem 0.45rem;
		border-radius: var(--oa-radius-sm, 0.375rem);
		border: 1px solid color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 85%, transparent);
		background: color-mix(in srgb, var(--oa-canvas-bottom, #f1f5f9) 40%, var(--oa-panel, #fff));
	}

	.openapi-schema-tree--dark .openapi-schema-tree__eda-section {
		background: color-mix(in srgb, var(--oa-canvas-top, rgba(15, 42, 72, 0.55)) 35%, transparent);
	}

	.openapi-schema-tree__eda-section-label {
		display: block;
		margin-bottom: 0.2rem;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--oa-text-muted, #64748b);
	}

	.openapi-schema-tree__eda-section-list {
		margin: 0;
		padding-left: 1rem;
		font-size: 0.6875rem;
		color: var(--oa-text, #334155);
		line-height: 1.4;
	}

	.openapi-schema-tree__eda-section-list code {
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.625rem;
		word-break: break-word;
	}

	.openapi-schema-tree__chip {
		display: inline-flex;
		align-items: center;
		border-radius: 9999px;
		padding: 0.05rem 0.4rem;
		font-size: 0.6rem;
		font-weight: 700;
		line-height: 1.25;
		border: 1px solid transparent;
		background: color-mix(in srgb, var(--oa-text-muted, #64748b) 12%, transparent);
		color: var(--oa-text-muted, #475569);
	}

	.openapi-schema-tree__chip--info {
		background: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 12%, transparent);
		border-color: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 22%, transparent);
		color: var(--oa-focus-ring, #2563eb);
	}

	.openapi-schema-tree__chip--warn {
		background: color-mix(in srgb, var(--oa-method-put, #d97706) 12%, transparent);
		border-color: color-mix(in srgb, var(--oa-method-put, #d97706) 22%, transparent);
		color: var(--oa-method-put, #d97706);
	}

	.openapi-schema-tree__chip--success {
		background: color-mix(in srgb, var(--oa-method-post, #16a34a) 12%, transparent);
		border-color: color-mix(in srgb, var(--oa-method-post, #16a34a) 22%, transparent);
		color: var(--oa-method-post, #16a34a);
	}

	.openapi-schema-tree__chip--danger {
		background: color-mix(in srgb, var(--oa-method-delete, #dc2626) 10%, transparent);
		border-color: color-mix(in srgb, var(--oa-method-delete, #dc2626) 22%, transparent);
		color: var(--oa-method-delete, #dc2626);
	}

	.openapi-schema-tree__chip--neutral {
		background: color-mix(in srgb, var(--oa-chip-inactive, #e2e8f0) 80%, transparent);
		border-color: var(--oa-panel-border, #e2e8f0);
	}

	.openapi-schema-tree__eda-summary {
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--oa-text, #334155);
		line-height: 1.4;
	}

	.openapi-schema-tree__eda-desc {
		margin: 0.2rem 0 0;
		font-size: 0.75rem;
		color: var(--oa-text-muted, #64748b);
		line-height: 1.45;
	}

	.openapi-schema-tree__description {
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
		color: var(--oa-text-muted, #64748b);
		line-height: 1.45;
	}

	.openapi-schema-tree__marker {
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
		font-style: italic;
		color: var(--oa-method-put, #d97706);
	}

	.openapi-schema-tree__constraints {
		margin: 0.25rem 0 0;
		padding-left: 1rem;
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.625rem;
		color: var(--oa-text-muted, #475569);
	}

	.openapi-schema-tree__example {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.35rem;
		margin-top: 0.3rem;
	}

	.openapi-schema-tree__example-label {
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--oa-text-muted, #94a3b8);
	}

	.openapi-schema-tree__example-value {
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.625rem;
		color: var(--oa-text-muted, #475569);
		word-break: break-word;
		white-space: pre-wrap;
	}

	.openapi-schema-tree__inline-group {
		margin-bottom: 0.55rem;
		padding: 0.5rem 0.6rem;
		border: 1px solid color-mix(in srgb, var(--oa-focus-ring, #2563eb) 18%, var(--oa-panel-border, #cbd5e1));
		border-radius: var(--oa-radius, 0.5rem);
		background: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 4%, var(--oa-panel, #fff));
	}

	.openapi-schema-tree--dark .openapi-schema-tree__inline-group {
		border-color: color-mix(in srgb, var(--oa-focus-ring, #60a5fa) 28%, var(--oa-panel-border));
		background: color-mix(in srgb, var(--oa-focus-ring, #60a5fa) 8%, var(--oa-panel));
	}

	.openapi-schema-tree__inline-group-label {
		display: block;
		margin-bottom: 0.35rem;
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--oa-text-muted, #64748b);
	}

	.openapi-schema-tree__inline-group-fields {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.openapi-schema-tree__inline-field {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.75rem;
		color: var(--oa-text, #0f172a);
	}

	.openapi-schema-tree__inline-field-title {
		font-weight: 650;
	}

	.openapi-schema-tree__empty {
		padding: 0.5rem 0.75rem 0.75rem;
		font-size: 0.8125rem;
		color: var(--oa-text-muted, #64748b);
	}

	@media (max-width: 639px) {
		.openapi-schema-tree__visible-if {
			white-space: normal;
		}

		.openapi-schema-tree__children {
			padding-left: 0.65rem;
			margin-left: 0.35rem;
		}
	}
</style>
