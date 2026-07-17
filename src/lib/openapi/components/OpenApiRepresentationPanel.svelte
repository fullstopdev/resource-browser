<script lang="ts">
	import { copyToClipboard } from '$lib/copyToClipboard';
	import OpenApiExampleBlock from '$lib/openapi/components/OpenApiExampleBlock.svelte';
	import OpenApiSchemaTree from '$lib/openapi/components/OpenApiSchemaTree.svelte';
	import {
		buildRepresentationMediaOptions,
		formatExampleForRepresentation,
		resolveRepresentationExamples,
		type OpenApiExample,
		type RepresentationFormat,
		type RepresentationMediaOption
	} from '$lib/openapi/openApiExamples';
	import type { JsonSchemaObject } from '$lib/openapi/schemaBrowser';

	interface Props {
		spec: Record<string, unknown>;
		contentTypes: string[];
		schema?: JsonSchemaObject;
		schemaRef?: string;
		schemaType?: string;
		hasEmptySchema?: boolean;
		examples?: OpenApiExample[];
		darkMode?: boolean;
		onSchemaRefClick?: (schemaName: string) => void;
	}

	let {
		spec,
		contentTypes,
		schema,
		schemaRef = '',
		schemaType = '',
		hasEmptySchema = false,
		examples = [],
		darkMode = false,
		onSchemaRefClick
	}: Props = $props();

	type ViewMode = 'example' | 'schema';

	let activeMediaId = $state('');
	let viewMode = $state<ViewMode>('example');
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;

	const mediaOptions = $derived(buildRepresentationMediaOptions(contentTypes));

	const contentKey = $derived(`${contentTypes.join(',')}|${schemaRef}|${hasEmptySchema}`);

	const activeMedia = $derived.by((): RepresentationMediaOption | undefined => {
		if (mediaOptions.length === 0) return undefined;
		return mediaOptions.find((o) => o.id === activeMediaId) ?? mediaOptions[0];
	});

	const activeFormat = $derived.by((): RepresentationFormat => {
		return activeMedia?.format ?? 'text';
	});

	const resolvedExamples = $derived(
		resolveRepresentationExamples(spec, examples, schema, { hasEmptySchema })
	);

	const showStructuredPanel = $derived(!hasEmptySchema && Boolean(schema || schemaRef));

	const primaryExample = $derived(resolvedExamples[0]);

	const exampleBody = $derived.by(() => {
		if (!primaryExample) return '';
		return formatExampleForRepresentation(primaryExample, activeFormat);
	});

	const multipleNamedExamples = $derived(
		resolvedExamples.length > 1 ||
			resolvedExamples.some((e) => Boolean(e.name) && !e.synthesized)
	);

	const copyLabel = $derived(
		activeFormat === 'yaml' ? 'Copy YAML' : activeFormat === 'json' ? 'Copy JSON' : 'Copy'
	);

	$effect(() => {
		const key = contentKey;
		const options = buildRepresentationMediaOptions(contentTypes);
		activeMediaId = options[0]?.id ?? '';
		viewMode = 'example';
		copied = false;
		if (copyTimer) {
			clearTimeout(copyTimer);
			copyTimer = undefined;
		}
		void key;
	});

	async function handleCopy() {
		if (!exampleBody) return;
		const ok = await copyToClipboard(exampleBody);
		if (!ok) return;
		copied = true;
		if (copyTimer) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => {
			copied = false;
			copyTimer = undefined;
		}, 1500);
	}
</script>

{#if hasEmptySchema}
	<p class="oa-repr__plain">
		{contentTypes.join(' · ')} — {schemaType || 'plain text'}
	</p>
{:else if showStructuredPanel}
	<div class="oa-repr" class:oa-repr--dark={darkMode}>
		<div class="oa-repr__toolbar">
			{#if mediaOptions.length > 0}
				<div class="oa-repr__formats" role="tablist" aria-label="Media type">
					{#each mediaOptions as option (option.id)}
						<button
							type="button"
							role="tab"
							class="oa-repr__format"
							class:oa-repr__format--active={activeMedia?.id === option.id}
							aria-selected={activeMedia?.id === option.id}
							onclick={() => (activeMediaId = option.id)}
						>
							{option.label}
						</button>
					{/each}
				</div>
			{/if}

			<div class="oa-repr__views" role="tablist" aria-label="Representation view">
				<button
					type="button"
					role="tab"
					class="oa-repr__view"
					class:oa-repr__view--active={viewMode === 'example'}
					aria-selected={viewMode === 'example'}
					onclick={() => (viewMode = 'example')}
				>
					Example
				</button>
				<button
					type="button"
					role="tab"
					class="oa-repr__view"
					class:oa-repr__view--active={viewMode === 'schema'}
					aria-selected={viewMode === 'schema'}
					onclick={() => (viewMode = 'schema')}
				>
					Schema
				</button>
			</div>
		</div>

		{#if viewMode === 'example'}
			<div class="oa-repr__example" role="tabpanel">
				{#if multipleNamedExamples}
					<OpenApiExampleBlock
						examples={resolvedExamples.map((example) => ({
							...example,
							formatted: formatExampleForRepresentation(example, activeFormat)
						}))}
						{darkMode}
						title="Example"
						copyLabel={copyLabel}
					/>
				{:else if primaryExample && exampleBody}
					<section class="oa-repr__code-block">
						<header class="oa-repr__code-head">
							<span class="oa-repr__code-label">
								{#if primaryExample.synthesized}
									Example
									<span class="oa-repr__synth-hint">from schema</span>
								{:else}
									{primaryExample.summary || primaryExample.name || 'Example'}
								{/if}
							</span>
							<button
								type="button"
								class="oa-repr__copy"
								class:oa-repr__copy--done={copied}
								aria-label={copied ? 'Copied' : copyLabel}
								title={copied ? 'Copied' : copyLabel}
								onclick={() => void handleCopy()}
							>
								{copied ? 'Copied' : 'Copy'}
							</button>
						</header>
						{#if primaryExample.description && !primaryExample.synthesized}
							<p class="oa-repr__code-desc">{primaryExample.description}</p>
						{/if}
						<pre class="oa-repr__pre"><code>{exampleBody}</code></pre>
					</section>
				{:else}
					<p class="oa-repr__empty">No example available for this media type.</p>
				{/if}
			</div>
		{:else}
			<div class="oa-repr__schema" role="tabpanel">
				<OpenApiSchemaTree
					{spec}
					{schema}
					{schemaRef}
					title={schemaRef || 'Schema'}
					{darkMode}
					defaultExpanded={true}
					{onSchemaRefClick}
				/>
			</div>
		{/if}
	</div>
{:else if examples.length > 0}
	<OpenApiExampleBlock {examples} {darkMode} title="Example" />
{/if}

<style>
	.oa-repr {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		border: 1px solid color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 90%, transparent);
		border-radius: var(--oa-radius, 0.5rem);
		padding: 0.65rem 0.7rem 0.75rem;
		background: color-mix(in srgb, var(--oa-canvas-bottom, #f1f5f9) 35%, var(--oa-panel, #fff));
	}

	.oa-repr--dark {
		background: color-mix(in srgb, var(--oa-canvas-top, rgba(15, 42, 72, 0.55)) 40%, transparent);
		border-color: var(--oa-panel-border, rgba(56, 100, 150, 0.35));
	}

	.oa-repr__toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.oa-repr__formats,
	.oa-repr__views {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		padding: 0.15rem;
		border-radius: var(--oa-radius-sm, 0.375rem);
		background: color-mix(in srgb, var(--oa-canvas-bottom, #f1f5f9) 70%, transparent);
		border: 1px solid color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 80%, transparent);
	}

	.oa-repr--dark .oa-repr__formats,
	.oa-repr--dark .oa-repr__views {
		background: color-mix(in srgb, #000 22%, transparent);
		border-color: var(--oa-panel-border, rgba(56, 100, 150, 0.35));
	}

	.oa-repr__format,
	.oa-repr__view {
		border: none;
		border-radius: calc(var(--oa-radius-sm, 0.375rem) - 1px);
		padding: 0.28rem 0.65rem;
		font-family: inherit;
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--oa-text-muted, #64748b);
		background: transparent;
		cursor: pointer;
		transition:
			background 0.12s ease,
			color 0.12s ease,
			box-shadow 0.12s ease;
	}

	.oa-repr__format:hover,
	.oa-repr__view:hover {
		color: var(--oa-text, #0f172a);
	}

	.oa-repr__format--active,
	.oa-repr__view--active {
		background: var(--oa-panel, #fff);
		color: var(--oa-focus-ring, #2563eb);
		box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
	}

	.oa-repr--dark .oa-repr__format--active,
	.oa-repr--dark .oa-repr__view--active {
		background: color-mix(in srgb, var(--oa-panel) 85%, transparent);
		color: color-mix(in srgb, var(--oa-focus-ring, #60a5fa) 90%, #fff);
	}

	.oa-repr__format:focus-visible,
	.oa-repr__view:focus-visible,
	.oa-repr__copy:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--oa-focus-ring, #2563eb) 35%, transparent);
	}

	.oa-repr__code-block {
		border: 1px solid color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 90%, transparent);
		border-radius: var(--oa-radius, 0.5rem);
		background: color-mix(in srgb, var(--oa-canvas-bottom, #f1f5f9) 55%, var(--oa-panel, #fff));
		overflow: hidden;
	}

	.oa-repr--dark .oa-repr__code-block {
		background: color-mix(in srgb, var(--oa-canvas-top, rgba(15, 42, 72, 0.55)) 45%, transparent);
		border-color: var(--oa-panel-border, rgba(56, 100, 150, 0.35));
	}

	.oa-repr__code-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.55rem 0.4rem 0.65rem;
		min-height: 2rem;
	}

	.oa-repr__code-label {
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--oa-text-muted, #64748b);
	}

	.oa-repr__synth-hint {
		margin-left: 0.35rem;
		font-weight: 600;
		text-transform: none;
		letter-spacing: 0;
		opacity: 0.75;
	}

	.oa-repr__copy {
		flex-shrink: 0;
		margin-left: auto;
		border: 1px solid var(--oa-panel-border, #e2e8f0);
		border-radius: var(--oa-radius-sm, 0.375rem);
		background: var(--oa-panel, #fff);
		padding: 0.2rem 0.5rem;
		font-family: inherit;
		font-size: 0.625rem;
		font-weight: 600;
		color: var(--oa-text-muted, #64748b);
		cursor: pointer;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			color 0.12s ease;
	}

	.oa-repr--dark .oa-repr__copy {
		background: color-mix(in srgb, var(--oa-panel) 80%, transparent);
		border-color: var(--oa-panel-border, rgba(56, 100, 150, 0.35));
	}

	.oa-repr__copy:hover {
		border-color: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 40%, var(--oa-panel-border));
		color: var(--oa-text, #0f172a);
	}

	.oa-repr__copy--done {
		border-color: color-mix(in srgb, #16a34a 45%, transparent);
		background: color-mix(in srgb, #16a34a 12%, transparent);
		color: #16a34a;
	}

	.oa-repr--dark .oa-repr__copy--done {
		color: #86efac;
	}

	.oa-repr__code-desc {
		margin: 0;
		padding: 0 0.65rem 0.4rem;
		font-size: 0.75rem;
		color: var(--oa-text-muted, #64748b);
		line-height: 1.4;
	}

	.oa-repr__pre {
		margin: 0;
		padding: 0.55rem 0.7rem 0.7rem;
		overflow-x: auto;
		max-height: 22rem;
		overflow-y: auto;
		border-top: 1px solid color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 75%, transparent);
		background: color-mix(in srgb, #0f172a 4%, var(--oa-panel, #fff));
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.6875rem;
		line-height: 1.45;
		color: var(--oa-text, #0f172a);
	}

	.oa-repr--dark .oa-repr__pre {
		background: color-mix(in srgb, #000 28%, transparent);
		border-top-color: var(--oa-panel-border, rgba(56, 100, 150, 0.35));
		color: color-mix(in srgb, var(--oa-text, #e2e8f0) 92%, #fff);
	}

	.oa-repr__pre code {
		font-family: inherit;
		font-size: inherit;
		white-space: pre;
	}

	.oa-repr__empty,
	.oa-repr__plain {
		margin: 0.25rem 0;
		font-size: 0.8125rem;
		color: var(--oa-text-muted, #475569);
	}

	.oa-repr__schema {
		min-width: 0;
	}
</style>
