<script lang="ts">
	import { copyToClipboard } from '$lib/copyToClipboard';
	import OpenApiExampleBlock from '$lib/openapi/components/OpenApiExampleBlock.svelte';
	import OpenApiRepresentationPanel from '$lib/openapi/components/OpenApiRepresentationPanel.svelte';
	import OpenApiSchemaTree from '$lib/openapi/components/OpenApiSchemaTree.svelte';
	import VendorExtensionsSection from '$lib/openapi/components/VendorExtensionsSection.svelte';
	import {
		formatOperationDescriptionParagraphs,
		getOperationTagLabel,
		groupMediaContentBySchema,
		groupParametersByLocation,
		isErrorResponseStatus,
		isPrimaryQueryParameter,
		shouldCollapseOperationDescription,
		shouldShowInlineParameterSchema,
		type OpenApiOperation
	} from '$lib/openapi/pathBrowser';

	interface Props {
		operation: OpenApiOperation;
		spec: Record<string, unknown>;
		darkMode?: boolean;
		onSchemaGraphNavigate?: (schemaName: string) => void;
		/** Open Schema Graph on API map focused on this operation (not schema-deps). */
		onShowInSchemaGraph?: (operation: OpenApiOperation) => void;
	}

	let {
		operation,
		spec,
		darkMode = false,
		onSchemaGraphNavigate,
		onShowInSchemaGraph
	}: Props = $props();

	let descriptionExpanded = $state(false);
	let activeResponseTab = $state('');
	let copiedPath = $state(false);
	let copyPathTimer: ReturnType<typeof setTimeout> | undefined;

	const descriptionCollapsible = $derived(
		shouldCollapseOperationDescription(operation.description)
	);
	const showFullDescription = $derived(
		Boolean(operation.description) &&
			(!descriptionCollapsible || descriptionExpanded || !operation.summary)
	);
	const descriptionParagraphs = $derived(
		formatOperationDescriptionParagraphs(operation.description ?? '')
	);
	const parameterGroups = $derived(groupParametersByLocation(operation.parameters));
	const hasParameters = $derived(operation.parameters.length > 0);
	const responseTabs = $derived(operation.responses);
	const tagLabel = $derived(getOperationTagLabel(operation));
	const showSchemaGraphLink = $derived(Boolean(onShowInSchemaGraph));

	$effect(() => {
		operation.id;
		descriptionExpanded = false;
		activeResponseTab = operation.responses[0]?.status ?? '';
		copiedPath = false;
		if (copyPathTimer) {
			clearTimeout(copyPathTimer);
			copyPathTimer = undefined;
		}
	});

	async function handleCopyPath() {
		const ok = await copyToClipboard(operation.path);
		if (!ok) return;
		copiedPath = true;
		if (copyPathTimer) clearTimeout(copyPathTimer);
		copyPathTimer = setTimeout(() => {
			copiedPath = false;
			copyPathTimer = undefined;
		}, 1500);
	}

	function handleSchemaRefClick(schemaName: string) {
		onSchemaGraphNavigate?.(schemaName);
	}

	function handleShowInSchemaGraph() {
		onShowInSchemaGraph?.(operation);
	}
</script>

<article
	class="openapi-operation"
	class:openapi-operation--dark={darkMode}
	id={operation.operationId || operation.id}
>
	<div class="openapi-operation__actions" role="toolbar" aria-label="Operation actions">
		{#if showSchemaGraphLink}
			<button
				type="button"
				class="openapi-operation__action openapi-operation__action--primary"
				onclick={handleShowInSchemaGraph}
			>
				<svg
					class="openapi-operation__action-icon"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M13 10V3L4 14h7v7l9-11h-7z"
					/>
				</svg>
				Show in Schema Graph
			</button>
		{/if}
		<button
			type="button"
			class="openapi-operation__action openapi-operation__action--secondary"
			class:openapi-operation__action--copied={copiedPath}
			aria-label={copiedPath ? 'Path copied' : 'Copy path to clipboard'}
			title={copiedPath ? 'Copied' : 'Copy path'}
			onclick={() => void handleCopyPath()}
		>
			{#if copiedPath}
				<svg
					class="openapi-operation__action-icon"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M5 13l4 4L19 7"
					/>
				</svg>
				Copied
			{:else}
				<svg
					class="openapi-operation__action-icon"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
					/>
				</svg>
				Copy path
			{/if}
		</button>
	</div>

	<div class="openapi-operation__meta">
		{#if tagLabel}
			<span class="openapi-operation__chip">{tagLabel}</span>
		{/if}
		<span
			class="openapi-operation__chip"
			class:openapi-operation__chip--success={operation.security.isPublic}
			class:openapi-operation__chip--auth={!operation.security.isPublic &&
				operation.security.requirements.length > 0}
			title={operation.security.inherited
				? 'Inherited from document-level security'
				: operation.security.isPublic
					? 'Operation declares security: []'
					: 'Operation-level security'}
		>
			{operation.security.label}
		</span>
		{#if operation.deprecated}
			<span class="openapi-operation__chip openapi-operation__chip--danger">Deprecated</span>
		{/if}
		{#if operation.isQueryEndpoint}
			<span class="openapi-operation__chip openapi-operation__chip--success">EQL / Query</span>
		{/if}
	</div>

	{#if operation.summary || operation.description}
		<div class="openapi-operation__desc-block">
			{#if operation.summary}
				<p class="openapi-operation__summary">
					{operation.summary}
					{#if descriptionCollapsible && !descriptionExpanded && operation.description}
						<button
							type="button"
							class="openapi-operation__desc-toggle"
							onclick={() => (descriptionExpanded = true)}
						>
							Show more
						</button>
					{/if}
				</p>
			{/if}

			{#if showFullDescription}
				<div class="openapi-operation__description">
					{#each descriptionParagraphs as paragraph (paragraph)}
						<p class="openapi-operation__description-p">{paragraph}</p>
					{/each}
				</div>
				{#if descriptionCollapsible && descriptionExpanded && operation.summary}
					<button
						type="button"
						class="openapi-operation__desc-toggle"
						onclick={() => (descriptionExpanded = false)}
					>
						Show less
					</button>
				{/if}
			{:else if operation.description && !operation.summary}
				<div class="openapi-operation__description">
					{#each descriptionParagraphs as paragraph (paragraph)}
						<p class="openapi-operation__description-p">{paragraph}</p>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	{#if operation.externalDocs}
		<p class="openapi-operation__external">
			<a href={operation.externalDocs.url} target="_blank" rel="noopener noreferrer">
				{operation.externalDocs.description || 'External documentation'}
			</a>
		</p>
	{/if}

	{#if operation.extensions.length > 0}
		<div class="openapi-operation__extensions">
			<VendorExtensionsSection
				extensions={operation.extensions}
				{darkMode}
				compact
				title="Operation extensions"
			/>
		</div>
	{/if}

	{#if hasParameters}
		<section class="openapi-operation__card">
			<header class="openapi-operation__card-head">
				<h3 class="openapi-operation__card-title">Parameters</h3>
				<p class="openapi-operation__card-sub">Path, query, header, and cookie inputs</p>
			</header>
			<div class="openapi-operation__card-body">
				{#each parameterGroups as group (group.in)}
					<div class="openapi-operation__param-group">
						<h4 class="openapi-operation__group-label">{group.label}</h4>
						<div class="openapi-operation__table-wrap">
							<table class="openapi-operation__table">
								<thead>
									<tr>
										<th scope="col">Name</th>
										<th scope="col">In</th>
										<th scope="col">Type</th>
										<th scope="col">Required</th>
										<th scope="col">Description</th>
									</tr>
								</thead>
								<tbody>
									{#each group.parameters as param (param.name)}
										<tr
											class:openapi-operation__param-row--primary={isPrimaryQueryParameter(
												param,
												operation
											)}
										>
											<td>
												<code>{param.name}</code>
												{#if param.deprecated}
													<span class="openapi-operation__chip openapi-operation__chip--danger"
														>deprecated</span
													>
												{/if}
											</td>
											<td>{param.in}</td>
											<td>
												<code>{param.type}</code>
												{#if param.typeHints.length > 0}
													<div class="openapi-operation__type-hints">
														{#each param.typeHints as hint (hint)}
															<span class="openapi-operation__type-hint">{hint}</span>
														{/each}
													</div>
												{/if}
												{#if param.schemaRef}
													{#if onSchemaGraphNavigate}
														<button
															type="button"
															class="openapi-operation__schema-chip"
															onclick={() => handleSchemaRefClick(param.schemaRef!)}
														>
															{param.schemaRef}
														</button>
													{:else}
														<span class="openapi-operation__schema-chip"
															>{param.schemaRef}</span
														>
													{/if}
												{/if}
											</td>
											<td>{param.required ? 'yes' : 'no'}</td>
											<td>
												{param.description || '—'}
												{#if param.examples.length > 0}
													{#if param.examples.length === 1 && !param.examples[0]!.formatted.includes('\n') && param.examples[0]!.formatted.length <= 80}
														<div class="openapi-operation__example">
															e.g. {param.examples[0]!.formatted}
														</div>
													{:else}
														<div class="openapi-operation__param-examples">
															<OpenApiExampleBlock
																examples={param.examples}
																{darkMode}
																title="Example"
															/>
														</div>
													{/if}
												{:else if param.example}
													<div class="openapi-operation__example">e.g. {param.example}</div>
												{/if}
												{#if shouldShowInlineParameterSchema(param) && param.schema}
													<details class="openapi-operation__inline-schema">
														<summary>Schema</summary>
														<OpenApiSchemaTree
															{spec}
															schema={param.schema}
															schemaRef={param.schemaRef}
															title={param.name}
															{darkMode}
															onSchemaRefClick={onSchemaGraphNavigate
																? handleSchemaRefClick
																: undefined}
														/>
													</details>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#if operation.requestBody}
		<section class="openapi-operation__card">
			<header class="openapi-operation__card-head">
				<div class="openapi-operation__card-head-row">
					<div>
						<h3 class="openapi-operation__card-title">Request</h3>
						<p class="openapi-operation__card-sub">Request body schema</p>
					</div>
					{#if operation.requestBody.required}
						<span class="openapi-operation__chip openapi-operation__chip--danger">Required</span>
					{/if}
				</div>
			</header>
			<div class="openapi-operation__card-body">
				{#if operation.requestBody.description}
					<p class="openapi-operation__body-desc">{operation.requestBody.description}</p>
				{/if}
				{#each groupMediaContentBySchema(operation.requestBody.content) as media (media.contentTypes.join(','))}
					<div class="openapi-operation__media">
						<OpenApiRepresentationPanel
							{spec}
							contentTypes={media.contentTypes}
							schema={media.schema}
							schemaRef={media.schemaRef}
							schemaType={media.schemaType}
							hasEmptySchema={media.hasEmptySchema}
							examples={media.examples}
							{darkMode}
							onSchemaRefClick={onSchemaGraphNavigate ? handleSchemaRefClick : undefined}
						/>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#if operation.responses.length > 0}
		<section class="openapi-operation__card">
			<header class="openapi-operation__card-head">
				<h3 class="openapi-operation__card-title">Responses</h3>
				<p class="openapi-operation__card-sub">Status codes and response schemas</p>
			</header>
			<div class="openapi-operation__card-body">
				<div
					class="openapi-operation__response-tabs"
					role="tablist"
					aria-label="Response status codes"
				>
					{#each responseTabs as response (response.status)}
						<button
							type="button"
							role="tab"
							class="openapi-operation__response-tab"
							class:openapi-operation__response-tab--active={activeResponseTab === response.status}
							class:openapi-operation__response-tab--error={isErrorResponseStatus(response.status)}
							aria-selected={activeResponseTab === response.status}
							onclick={() => (activeResponseTab = response.status)}
						>
							{response.status}
						</button>
					{/each}
				</div>

				{#each responseTabs as response (response.status)}
					{#if activeResponseTab === response.status}
						<div class="openapi-operation__response-panel" role="tabpanel">
							<p class="openapi-operation__response-desc">
								{response.description || 'No description'}
							</p>
							{#if response.extensions.length > 0}
								<VendorExtensionsSection
									extensions={response.extensions}
									{darkMode}
									compact
									title="Response extensions"
								/>
							{/if}
							{#if response.headers.length > 0}
								<div class="openapi-operation__table-wrap">
									<table class="openapi-operation__table">
										<thead>
											<tr>
												<th scope="col">Header</th>
												<th scope="col">Type</th>
												<th scope="col">Required</th>
												<th scope="col">Description</th>
											</tr>
										</thead>
										<tbody>
											{#each response.headers as header (header.name)}
												<tr>
													<td><code>{header.name}</code></td>
													<td><code>{header.type}</code></td>
													<td>{header.required ? 'yes' : 'no'}</td>
													<td>{header.description || '—'}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{/if}
							{#each groupMediaContentBySchema(response.content) as media (media.contentTypes.join(','))}
								<div class="openapi-operation__media">
									<OpenApiRepresentationPanel
										{spec}
										contentTypes={media.contentTypes}
										schema={media.schema}
										schemaRef={media.schemaRef}
										schemaType={media.schemaType}
										hasEmptySchema={media.hasEmptySchema}
										examples={media.examples}
										{darkMode}
										onSchemaRefClick={onSchemaGraphNavigate
											? handleSchemaRefClick
											: undefined}
									/>
								</div>
							{/each}
						</div>
					{/if}
				{/each}
			</div>
		</section>
	{/if}
</article>

<style>
	.openapi-operation {
		font-family: var(--oa-font, 'NokiaPureText', ui-sans-serif, system-ui, sans-serif);
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: 100%;
		max-width: none;
		color: var(--oa-text, #0f172a);
	}

	.openapi-operation__actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-start;
		gap: 0.5rem;
		margin: -1.15rem -1rem 0;
		padding: 0.65rem 1rem;
		border-bottom: 1px solid var(--oa-panel-border, #e2e8f0);
		/* Match ResourceModal tab strip: light slate / dark border-slate-800 */
		background: color-mix(in srgb, var(--oa-canvas-bottom, #f1f5f9) 55%, var(--oa-panel, #fff));
	}

	@media (min-width: 640px) {
		.openapi-operation__actions {
			margin: -1.15rem -1.35rem 0;
			padding: 0.65rem 1.35rem;
		}
	}

	.openapi-operation--dark .openapi-operation__actions {
		background: color-mix(in srgb, var(--oa-panel, #0f172a) 92%, #000);
		border-bottom-color: var(--oa-panel-border, #1e293b);
	}

	.openapi-operation__action {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2.25rem;
		border-radius: var(--oa-radius, 0.5rem);
		padding: 0.4rem 0.85rem;
		font-size: 0.8125rem;
		font-weight: 600;
		line-height: 1.2;
		cursor: pointer;
		font-family: inherit;
		border: 1px solid var(--oa-panel-border, #e2e8f0);
		background: var(--oa-section, var(--oa-panel, #fff));
		color: var(--oa-text, #0f172a);
		transition:
			background 0.15s ease,
			border-color 0.15s ease,
			color 0.15s ease,
			box-shadow 0.15s ease;
	}

	.openapi-operation--dark .openapi-operation__action {
		background: color-mix(in srgb, var(--oa-section, #0f2a48) 88%, transparent);
		border-color: var(--oa-panel-border, #334155);
		color: var(--oa-text, #e2e8f0);
	}

	.openapi-operation__action--primary {
		border-color: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 40%, var(--oa-panel-border, #e2e8f0));
		color: var(--oa-focus-ring, #2563eb);
	}

	.openapi-operation--dark .openapi-operation__action--primary {
		border-color: color-mix(in srgb, var(--oa-focus-ring, #60a5fa) 45%, var(--oa-panel-border, #334155));
		color: var(--oa-focus-ring, #60a5fa);
	}

	.openapi-operation__action--primary:hover,
	.openapi-operation__action--secondary:hover {
		border-color: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 50%, var(--oa-panel-border));
		background: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 10%, var(--oa-section, var(--oa-panel)));
		color: var(--oa-focus-ring, #2563eb);
	}

	.openapi-operation__action--secondary {
		color: var(--oa-text-muted, #64748b);
	}

	.openapi-operation--dark .openapi-operation__action--secondary {
		color: var(--oa-text-muted, #94a3b8);
	}

	.openapi-operation__action:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--oa-focus-ring, #2563eb) 35%, transparent);
	}

	.openapi-operation__action--copied {
		border-color: color-mix(in srgb, #16a34a 45%, transparent);
		background: color-mix(in srgb, #16a34a 12%, transparent);
		color: #16a34a;
	}

	.openapi-operation--dark .openapi-operation__action--copied {
		color: #86efac;
		background: color-mix(in srgb, #16a34a 14%, var(--oa-section, #0f2a48));
	}

	.openapi-operation__action-icon {
		width: 0.9rem;
		height: 0.9rem;
		flex-shrink: 0;
	}

	.openapi-operation__meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		width: 100%;
		max-width: none;
	}

	.openapi-operation__chip {
		display: inline-flex;
		align-items: center;
		border-radius: 9999px;
		padding: 0.2rem 0.55rem;
		font-size: 0.6875rem;
		font-weight: 700;
		line-height: 1.2;
		background: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 12%, transparent);
		color: var(--oa-focus-ring, #2563eb);
		border: 1px solid color-mix(in srgb, var(--oa-focus-ring, #2563eb) 22%, transparent);
	}

	.openapi-operation__chip--success {
		background: color-mix(in srgb, var(--oa-method-post, #16a34a) 12%, transparent);
		border-color: color-mix(in srgb, var(--oa-method-post, #16a34a) 28%, transparent);
		color: var(--oa-method-post, #16a34a);
	}

	.openapi-operation__chip--danger {
		background: color-mix(in srgb, var(--oa-method-delete, #dc2626) 10%, transparent);
		border-color: color-mix(in srgb, var(--oa-method-delete, #dc2626) 28%, transparent);
		color: var(--oa-method-delete, #dc2626);
	}

	.openapi-operation__chip--auth {
		background: color-mix(in srgb, var(--oa-method-put, #d97706) 12%, transparent);
		border-color: color-mix(in srgb, var(--oa-method-put, #d97706) 28%, transparent);
		color: var(--oa-method-put, #d97706);
	}

	.openapi-operation__type-hints {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin-top: 0.25rem;
	}

	.openapi-operation__type-hint {
		display: block;
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.625rem;
		font-weight: 500;
		line-height: 1.35;
		color: var(--oa-text-muted, #64748b);
		word-break: break-word;
	}

	.openapi-operation__desc-block {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
		max-width: none;
	}

	.openapi-operation__summary {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
		line-height: 1.45;
		color: var(--oa-text, #0f172a);
		width: 100%;
		max-width: none;
	}

	.openapi-operation__description {
		width: 100%;
		max-width: none;
		font-size: 0.8125rem;
		color: var(--oa-text-muted, #64748b);
		line-height: 1.55;
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}

	.openapi-operation__description-p {
		margin: 0;
		width: 100%;
		max-width: none;
	}

	.openapi-operation__desc-toggle {
		display: inline;
		margin-left: 0.35rem;
		border: none;
		background: none;
		padding: 0;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--oa-focus-ring, #2563eb);
		cursor: pointer;
		font-family: inherit;
		white-space: nowrap;
	}

	.openapi-operation__desc-toggle:hover {
		text-decoration: underline;
	}

	.openapi-operation__external {
		margin: 0;
		font-size: 0.8125rem;
	}

	.openapi-operation__external a {
		color: var(--oa-focus-ring, #2563eb);
		font-weight: 600;
	}

	/* Section cards — same pattern as ResourceModal Spec/Status:
	   light: white + slate border; dark: #0f2a48 on slate-900 shell */
	.openapi-operation__card {
		border: 1px solid var(--oa-panel-border, #e2e8f0);
		border-radius: 0.75rem;
		overflow: hidden;
		background: var(--oa-section, var(--oa-panel, #ffffff));
		box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
	}

	.openapi-operation--dark .openapi-operation__card {
		background: var(--oa-section, #0f2a48);
		border-color: color-mix(in srgb, #1e3a5f 70%, var(--oa-panel-border, #334155));
		box-shadow: none;
	}

	.openapi-operation__card-head {
		padding: 0.85rem 1rem;
		border-bottom: 1px solid color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 85%, transparent);
		background: color-mix(in srgb, var(--oa-canvas-bottom, #f8fafc) 50%, var(--oa-section, #fff));
	}

	.openapi-operation--dark .openapi-operation__card-head {
		background: color-mix(in srgb, var(--oa-section, #0f2a48) 92%, #000);
		border-bottom-color: color-mix(in srgb, var(--oa-panel-border, #334155) 80%, transparent);
	}

	.openapi-operation__card-head-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.openapi-operation__card-title {
		margin: 0;
		font-family: var(--oa-font-headline, 'NokiaPureHeadline', ui-sans-serif, system-ui, sans-serif);
		font-size: 0.9375rem;
		font-weight: 700;
		color: var(--oa-text, #0f172a);
		letter-spacing: -0.01em;
	}

	.openapi-operation__card-sub {
		margin: 0.15rem 0 0;
		font-size: 0.75rem;
		color: var(--oa-text-muted, #64748b);
	}

	.openapi-operation__card-body {
		padding: 0.9rem 1rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.openapi-operation__group-label {
		margin: 0 0 0.4rem;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--oa-text-muted, #64748b);
	}

	.openapi-operation__table-wrap {
		overflow-x: auto;
		border: 1px solid color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 90%, transparent);
		border-radius: var(--oa-radius, 0.5rem);
	}

	.openapi-operation__table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.75rem;
	}

	.openapi-operation__table th,
	.openapi-operation__table td {
		padding: 0.55rem 0.65rem;
		border-bottom: 1px solid color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 70%, transparent);
		text-align: left;
		vertical-align: top;
	}

	.openapi-operation__table tr:last-child td {
		border-bottom: none;
	}

	.openapi-operation__table th {
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--oa-text-muted, #64748b);
		background: color-mix(in srgb, var(--oa-canvas-bottom, #f1f5f9) 55%, transparent);
	}

	.openapi-operation__table code {
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.6875rem;
	}

	.openapi-operation__param-row--primary {
		background: color-mix(in srgb, var(--oa-method-post, #16a34a) 5%, transparent);
	}

	.openapi-operation__schema-chip {
		display: inline-flex;
		align-items: center;
		margin-top: 0.2rem;
		border-radius: 9999px;
		padding: 0.1rem 0.45rem;
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.625rem;
		font-weight: 600;
		border: 1px solid color-mix(in srgb, var(--oa-link-ref, #4f46e5) 28%, transparent);
		background: color-mix(in srgb, var(--oa-link-ref, #4f46e5) 10%, transparent);
		color: var(--oa-link-ref, #4f46e5);
		cursor: default;
	}

	button.openapi-operation__schema-chip {
		cursor: pointer;
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
	}

	button.openapi-operation__schema-chip:hover {
		background: color-mix(in srgb, var(--oa-link-ref, #4f46e5) 18%, transparent);
	}

	.openapi-operation__example {
		margin-top: 0.25rem;
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.625rem;
		color: var(--oa-text-muted, #64748b);
	}

	.openapi-operation__param-examples {
		margin-top: 0.375rem;
	}

	.openapi-operation__media {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.openapi-operation__inline-schema {
		margin-top: 0.375rem;
	}

	.openapi-operation__body-desc {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--oa-text-muted, #64748b);
	}

	.openapi-operation__response-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.openapi-operation__response-tab {
		border: 1px solid var(--oa-panel-border, #cbd5e1);
		border-radius: var(--oa-radius-sm, 0.375rem);
		padding: 0.35rem 0.65rem;
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.6875rem;
		font-weight: 700;
		background: var(--oa-section, var(--oa-panel, #fff));
		color: var(--oa-text-muted, #475569);
		cursor: pointer;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			color 0.12s ease,
			box-shadow 0.12s ease;
	}

	.openapi-operation--dark .openapi-operation__response-tab {
		background: color-mix(in srgb, var(--oa-section, #0f2a48) 85%, #000);
		border-color: var(--oa-panel-border, #334155);
		color: var(--oa-text-muted, #94a3b8);
	}

	.openapi-operation__response-tab:hover {
		border-color: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 35%, var(--oa-panel-border));
		color: var(--oa-text, #0f172a);
	}

	.openapi-operation__response-tab--active {
		border-color: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 50%, transparent);
		background: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 14%, transparent);
		color: var(--oa-focus-ring, #2563eb);
		box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--oa-focus-ring, #2563eb) 55%, transparent);
	}

	.openapi-operation__response-tab--error.openapi-operation__response-tab--active {
		border-color: color-mix(in srgb, var(--oa-method-delete, #dc2626) 45%, transparent);
		background: color-mix(in srgb, var(--oa-method-delete, #dc2626) 10%, transparent);
		color: var(--oa-method-delete, #dc2626);
	}

	.openapi-operation__response-desc {
		margin: 0 0 0.625rem;
		font-size: 0.8125rem;
		color: var(--oa-text-muted, #64748b);
	}

	@media (max-width: 639px) {
		.openapi-operation__actions {
			gap: 0.4rem;
		}

		.openapi-operation__action {
			flex: 1 1 auto;
			justify-content: center;
		}

		.openapi-operation__card-body {
			padding: 0.75rem;
		}

		.openapi-operation__card-head {
			padding: 0.75rem;
		}
	}
</style>
