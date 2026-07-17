<script lang="ts">
	import { getEdaFieldPresentation } from '$lib/openapi/edaPresentation';
	import type { VendorExtensionEntry } from '$lib/openapi/vendorExtensions';
	import { parseEdaExtension } from '$lib/openapi/vendorExtensions';

	interface Props {
		extensions: VendorExtensionEntry[];
		darkMode?: boolean;
		compact?: boolean;
		title?: string;
		/** When true, structured fields render expanded (default for EDA extensions). */
		defaultExpanded?: boolean;
		/** Optional property name for EDA title/secondary pairing. */
		propertyName?: string;
	}

	let {
		extensions,
		darkMode = false,
		compact = false,
		title = 'Extensions',
		defaultExpanded = true,
		propertyName = ''
	}: Props = $props();

	let showRaw = $state<Record<string, boolean>>({});
	let showDetails = $state<Record<string, boolean>>({});

	function toggleRaw(key: string) {
		showRaw = { ...showRaw, [key]: !showRaw[key] };
	}

	function toggleDetails(key: string) {
		showDetails = { ...showDetails, [key]: !showDetails[key] };
	}

	function edaPresentationFor(extension: VendorExtensionEntry) {
		return getEdaFieldPresentation(propertyName || 'field', parseEdaExtension(extension.raw));
	}
</script>

{#if extensions.length > 0}
	<div
		class="vendor-extensions"
		class:vendor-extensions--dark={darkMode}
		class:vendor-extensions--compact={compact}
	>
		<h5 class="vendor-extensions__title" class:vendor-extensions__title--compact={compact}>
			{title}
			<span class="vendor-extensions__title-count">{extensions.length}</span>
		</h5>

		{#each extensions as extension (extension.key)}
			{@const isEda = extension.key === 'x-eda-nokia-com'}
			{@const eda = isEda ? edaPresentationFor(extension) : null}
			<section
				class="vendor-extensions__group"
				class:vendor-extensions__group--eda={isEda}
			>
				<div class="vendor-extensions__group-head">
					<span class="vendor-extensions__group-label">{extension.label}</span>
					{#if !isEda && extension.fields.length > 0}
						<span class="vendor-extensions__field-count">{extension.fields.length} fields</span>
					{/if}
					{#if !isEda}
						<code class="vendor-extensions__group-key">{extension.key}</code>
					{/if}
					<button
						type="button"
						class="vendor-extensions__raw-toggle"
						aria-pressed={showRaw[extension.key] ?? false}
						onclick={() => toggleRaw(extension.key)}
					>
						{showRaw[extension.key] ? 'Hide raw' : 'View raw'}
					</button>
				</div>

				{#if showRaw[extension.key]}
					<pre class="vendor-extensions__raw">{JSON.stringify(extension.raw, null, 2)}</pre>
				{:else if isEda && eda}
					<div class="vendor-extensions__eda">
						{#if eda.label.secondaryName || (propertyName && eda.label.title !== propertyName)}
							<div class="vendor-extensions__eda-title-row">
								<span class="vendor-extensions__eda-title">{eda.label.title}</span>
								{#if eda.label.secondaryName}
									<code class="vendor-extensions__eda-name">{eda.label.secondaryName}</code>
								{/if}
							</div>
						{/if}

						{#if eda.visibleIfLabel}
							<span class="vendor-extensions__chip vendor-extensions__chip--warn" title={eda.visibleIf}>
								{eda.visibleIfLabel}
							</span>
						{/if}

						{#if eda.summary}
							<p class="vendor-extensions__eda-summary">{eda.summary}</p>
						{/if}
						{#if eda.description}
							<p class="vendor-extensions__eda-desc">{eda.description}</p>
						{/if}

						{#if eda.chips.length > 0}
							<div class="vendor-extensions__chips" role="list">
								{#each eda.chips as chip (chip.id)}
									<span
										class="vendor-extensions__chip vendor-extensions__chip--{chip.tone}"
										role="listitem"
										title={chip.title}
									>
										{chip.label}
									</span>
								{/each}
							</div>
						{/if}

						{#if eda.sections.length > 0}
							<div class="vendor-extensions__eda-sections">
								{#each eda.sections as section (section.id)}
									<div class="vendor-extensions__eda-section">
										<span class="vendor-extensions__eda-section-label">{section.label}</span>
										<ul class="vendor-extensions__eda-section-list">
											{#each section.items as item (item)}
												<li><code>{item}</code></li>
											{/each}
										</ul>
									</div>
								{/each}
							</div>
						{/if}

						{#if eda.group}
							<p class="vendor-extensions__eda-meta">
								Grouped with <code>{eda.group}</code>
							</p>
						{/if}

						{#if eda.detailRows.length > 0}
							<button
								type="button"
								class="vendor-extensions__details-toggle"
								aria-expanded={showDetails[extension.key] ?? false}
								onclick={() => toggleDetails(extension.key)}
							>
								{showDetails[extension.key] ? 'Hide details' : 'More details'}
							</button>
							{#if showDetails[extension.key]}
								<dl class="vendor-extensions__fields">
									{#each eda.detailRows as row (row.key)}
										<div class="vendor-extensions__field">
											<dt class="vendor-extensions__field-label">{row.label}</dt>
											<dd class="vendor-extensions__field-value">{row.value}</dd>
										</div>
									{/each}
								</dl>
							{/if}
						{/if}

						{#if !eda.hasUiMetadata}
							<p class="vendor-extensions__empty">No UI metadata.</p>
						{/if}
					</div>
				{:else if extension.fields.length > 0 && (defaultExpanded || isEda)}
					<dl class="vendor-extensions__fields">
						{#each extension.fields as field (field.key)}
							<div class="vendor-extensions__field">
								<dt class="vendor-extensions__field-label">{field.label}</dt>
								<dd
									class="vendor-extensions__field-value"
									class:vendor-extensions__field-value--json={field.valueType === 'json'}
								>
									{#if field.valueType === 'boolean'}
										<span
											class="vendor-extensions__bool"
											class:vendor-extensions__bool--yes={field.value === 'yes'}
										>
											{field.value}
										</span>
									{:else}
										{field.value}
									{/if}
								</dd>
							</div>
						{/each}
					</dl>
				{:else}
					<p class="vendor-extensions__empty">No structured fields.</p>
				{/if}
			</section>
		{/each}
	</div>
{/if}

<style>
	.vendor-extensions {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		font-family: var(--oa-font, 'NokiaPureText', ui-sans-serif, system-ui, sans-serif);
	}

	.vendor-extensions__title {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin: 0 0 0.25rem;
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--oa-text-muted, #64748b);
	}

	.vendor-extensions__title--compact {
		font-size: 0.625rem;
		margin-bottom: 0.125rem;
	}

	.vendor-extensions__title-count {
		border-radius: 9999px;
		padding: 0.05rem 0.35rem;
		font-size: 0.625rem;
		font-weight: 700;
		background: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 12%, transparent);
		color: var(--oa-focus-ring, #2563eb);
	}

	.vendor-extensions__group {
		border: 1px solid var(--oa-panel-border, #e2e8f0);
		border-radius: var(--oa-radius, 0.5rem);
		background: color-mix(in srgb, var(--oa-canvas-bottom, #f1f5f9) 55%, var(--oa-panel, #fff));
		padding: 0.625rem 0.75rem;
		box-shadow: 0 1px 0 color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 40%, transparent);
	}

	.vendor-extensions__group--eda {
		border-color: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 32%, var(--oa-panel-border, #e2e8f0));
		background: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 6%, var(--oa-panel, #fff));
	}

	.vendor-extensions--dark .vendor-extensions__group {
		background: color-mix(in srgb, var(--oa-panel, rgba(15, 42, 72, 0.88)) 88%, transparent);
	}

	.vendor-extensions--dark .vendor-extensions__group--eda {
		border-color: color-mix(in srgb, var(--oa-focus-ring, #60a5fa) 35%, var(--oa-panel-border));
		background: color-mix(in srgb, var(--oa-focus-ring, #60a5fa) 10%, var(--oa-panel));
	}

	.vendor-extensions__field-count {
		border-radius: 9999px;
		padding: 0.05rem 0.35rem;
		font-size: 0.625rem;
		font-weight: 700;
		background: color-mix(in srgb, var(--oa-method-post, #16a34a) 12%, transparent);
		color: var(--oa-method-post, #047857);
	}

	.vendor-extensions--compact .vendor-extensions__group {
		padding: 0.5rem 0.625rem;
	}

	.vendor-extensions__group-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		margin-bottom: 0.5rem;
	}

	.vendor-extensions__group-label {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--oa-text, #334155);
	}

	.vendor-extensions__group-key {
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.625rem;
		color: var(--oa-text-muted, #64748b);
	}

	.vendor-extensions__raw-toggle,
	.vendor-extensions__details-toggle {
		margin-left: auto;
		border: 1px solid var(--oa-panel-border, #e2e8f0);
		border-radius: var(--oa-radius-sm, 0.25rem);
		padding: 0.12rem 0.45rem;
		font-size: 0.625rem;
		font-weight: 600;
		font-family: inherit;
		background: var(--oa-panel, #ffffff);
		color: var(--oa-text-muted, #475569);
		cursor: pointer;
	}

	.vendor-extensions__details-toggle {
		margin: 0.35rem 0 0;
		margin-left: 0;
	}

	.vendor-extensions--dark .vendor-extensions__raw-toggle,
	.vendor-extensions--dark .vendor-extensions__details-toggle {
		border-color: var(--oa-panel-border, rgba(56, 100, 150, 0.35));
		background: color-mix(in srgb, var(--oa-panel) 90%, transparent);
		color: var(--oa-text-muted, #94a3b8);
	}

	.vendor-extensions__eda {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.4rem;
	}

	.vendor-extensions__eda-title-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.4rem;
	}

	.vendor-extensions__eda-title {
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--oa-text, #0f172a);
	}

	.vendor-extensions__eda-name {
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.6875rem;
		color: var(--oa-text-muted, #64748b);
	}

	.vendor-extensions__eda-summary {
		margin: 0;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--oa-text, #334155);
	}

	.vendor-extensions__eda-desc {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.45;
		color: var(--oa-text-muted, #64748b);
	}

	.vendor-extensions__eda-meta {
		margin: 0;
		font-size: 0.6875rem;
		color: var(--oa-text-muted, #64748b);
	}

	.vendor-extensions__eda-meta code {
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.625rem;
	}

	.vendor-extensions__chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.vendor-extensions__eda-sections {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		width: 100%;
	}

	.vendor-extensions__eda-section {
		width: 100%;
		padding: 0.35rem 0.5rem;
		border-radius: var(--oa-radius-sm, 0.375rem);
		border: 1px solid color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 85%, transparent);
		background: color-mix(in srgb, var(--oa-canvas-bottom, #f1f5f9) 45%, var(--oa-panel, #fff));
	}

	.vendor-extensions--dark .vendor-extensions__eda-section {
		background: color-mix(in srgb, var(--oa-canvas-top, rgba(15, 42, 72, 0.55)) 40%, transparent);
	}

	.vendor-extensions__eda-section-label {
		display: block;
		margin-bottom: 0.2rem;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--oa-text-muted, #64748b);
	}

	.vendor-extensions__eda-section-list {
		margin: 0;
		padding-left: 1rem;
		font-size: 0.6875rem;
		color: var(--oa-text, #334155);
		line-height: 1.4;
	}

	.vendor-extensions__eda-section-list code {
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.625rem;
		word-break: break-word;
	}

	.vendor-extensions__chip {
		display: inline-flex;
		align-items: center;
		max-width: 100%;
		border-radius: 9999px;
		padding: 0.12rem 0.5rem;
		font-size: 0.625rem;
		font-weight: 700;
		line-height: 1.3;
		border: 1px solid transparent;
		background: color-mix(in srgb, var(--oa-text-muted, #64748b) 12%, transparent);
		color: var(--oa-text-muted, #475569);
		cursor: default;
	}

	.vendor-extensions__chip--info {
		background: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 12%, transparent);
		border-color: color-mix(in srgb, var(--oa-focus-ring, #2563eb) 22%, transparent);
		color: var(--oa-focus-ring, #2563eb);
	}

	.vendor-extensions__chip--warn {
		background: color-mix(in srgb, var(--oa-method-put, #d97706) 12%, transparent);
		border-color: color-mix(in srgb, var(--oa-method-put, #d97706) 28%, transparent);
		color: var(--oa-method-put, #d97706);
		cursor: help;
	}

	.vendor-extensions__chip--success {
		background: color-mix(in srgb, var(--oa-method-post, #16a34a) 12%, transparent);
		border-color: color-mix(in srgb, var(--oa-method-post, #16a34a) 28%, transparent);
		color: var(--oa-method-post, #16a34a);
	}

	.vendor-extensions__chip--danger {
		background: color-mix(in srgb, var(--oa-method-delete, #dc2626) 10%, transparent);
		border-color: color-mix(in srgb, var(--oa-method-delete, #dc2626) 28%, transparent);
		color: var(--oa-method-delete, #dc2626);
	}

	.vendor-extensions__chip--neutral {
		background: color-mix(in srgb, var(--oa-chip-inactive, #e2e8f0) 80%, transparent);
		border-color: var(--oa-panel-border, #e2e8f0);
		color: var(--oa-text-muted, #475569);
	}

	.vendor-extensions__fields {
		display: grid;
		grid-template-columns: minmax(7rem, 10rem) minmax(0, 1fr);
		gap: 0.25rem 0.75rem;
		margin: 0.25rem 0 0;
		width: 100%;
	}

	.vendor-extensions__field {
		display: contents;
	}

	.vendor-extensions__field-label {
		margin: 0;
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--oa-text-muted, #64748b);
		text-transform: capitalize;
	}

	.vendor-extensions__field-value {
		margin: 0;
		font-size: 0.75rem;
		color: var(--oa-text, #334155);
		word-break: break-word;
		white-space: pre-wrap;
	}

	.vendor-extensions__field-value--json {
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.6875rem;
	}

	.vendor-extensions__bool {
		border-radius: 9999px;
		padding: 0.05rem 0.4rem;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		background: color-mix(in srgb, var(--oa-text-muted, #64748b) 12%, transparent);
		color: var(--oa-text-muted, #475569);
	}

	.vendor-extensions__bool--yes {
		background: color-mix(in srgb, var(--oa-method-post, #16a34a) 12%, transparent);
		color: var(--oa-method-post, #047857);
	}

	.vendor-extensions__raw {
		margin: 0;
		padding: 0.5rem;
		border-radius: var(--oa-radius-sm, 0.375rem);
		background: var(--oa-panel, #ffffff);
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.6875rem;
		color: var(--oa-text, #334155);
		overflow-x: auto;
		white-space: pre;
	}

	.vendor-extensions--dark .vendor-extensions__raw {
		background: color-mix(in srgb, var(--oa-panel) 85%, transparent);
		color: var(--oa-text, #cbd5e1);
	}

	.vendor-extensions__empty {
		margin: 0;
		font-size: 0.75rem;
		color: var(--oa-text-muted, #94a3b8);
	}

	@media (max-width: 639px) {
		.vendor-extensions__fields {
			grid-template-columns: 1fr;
			gap: 0.1rem;
		}

		.vendor-extensions__field-label {
			margin-top: 0.25rem;
		}
	}
</style>
