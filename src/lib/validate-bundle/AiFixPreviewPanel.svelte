<script lang="ts">
	import YamlReadonlyViewer from '$lib/validate-bundle/YamlReadonlyViewer.svelte';
	import type { BundleIssue } from '$lib/validate-bundle/types';

	interface Props {
		open: boolean;
		issue: BundleIssue | null;
		loading?: boolean;
		error?: string | null;
		explanation?: string;
		originalYaml?: string;
		fixedYaml?: string | null;
		fixable?: boolean;
		applyBlockedReason?: string | null;
		onClose: () => void;
		onApply: () => void;
	}

	let {
		open,
		issue,
		loading = false,
		error = null,
		explanation = '',
		originalYaml = '',
		fixedYaml = null,
		fixable = false,
		applyBlockedReason = null,
		onClose,
		onApply
	}: Props = $props();

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) onClose();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onClose();
	}

	const title = $derived(
		issue
			? `AI fix — ${issue.resourceKind ?? 'Resource'}${issue.fieldPath ? ` · ${issue.fieldPath}` : ''}`
			: 'AI fix preview'
	);
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

{#if open && issue}
	<div
		class="ai-fix-overlay"
		role="presentation"
		onclick={handleBackdropClick}
	>
		<div
			class="ai-fix-panel"
			role="dialog"
			aria-modal="true"
			aria-labelledby="ai-fix-title"
		>
			<header class="ai-fix-panel__header">
				<div>
					<h2 id="ai-fix-title" class="ai-fix-panel__title">{title}</h2>
					<p class="ai-fix-panel__issue">{issue.message}</p>
				</div>
				<button type="button" class="ai-fix-panel__close" aria-label="Close" onclick={onClose}>
					×
				</button>
			</header>

			<div class="ai-fix-panel__body">
				{#if loading}
					<p class="ai-fix-panel__status" role="status">Generating fix with AI…</p>
				{:else if error}
					<p class="ai-fix-panel__error" role="alert">{error}</p>
				{:else}
					{#if explanation}
						<section class="ai-fix-panel__section">
							<h3 class="ai-fix-panel__section-title">Explanation</h3>
							<p class="ai-fix-panel__explanation">{explanation}</p>
						</section>
					{/if}

					{#if !fixable && !loading}
						<p class="ai-fix-panel__status">This issue could not be auto-fixed. Edit the YAML manually.</p>
					{/if}

					{#if originalYaml || fixedYaml}
						<div class="ai-fix-panel__diff" class:ai-fix-panel__diff--single={!fixedYaml}>
							<section class="ai-fix-panel__yaml-col">
								<h3 class="ai-fix-panel__section-title">Current</h3>
								<YamlReadonlyViewer value={originalYaml} label="Current YAML" />
							</section>
							{#if fixedYaml}
								<section class="ai-fix-panel__yaml-col">
									<h3 class="ai-fix-panel__section-title">Suggested</h3>
									<YamlReadonlyViewer value={fixedYaml} label="Suggested YAML" />
								</section>
							{/if}
						</div>
					{/if}

					{#if applyBlockedReason}
						<p class="ai-fix-panel__error" role="alert">{applyBlockedReason}</p>
					{/if}
				{/if}
			</div>

			<footer class="ai-fix-panel__footer">
				<button type="button" class="validate-yaml-btn validate-yaml-btn--ghost" onclick={onClose}>
					Cancel
				</button>
				<button
					type="button"
					class="validate-yaml-btn validate-yaml-btn--primary validate-yaml-btn--ai"
					disabled={loading || !fixable || !fixedYaml || !!applyBlockedReason}
					onclick={onApply}
				>
					Apply fix
				</button>
			</footer>
		</div>
	</div>
{/if}

<style>
	.ai-fix-overlay {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgba(15, 23, 42, 0.55);
	}

	.ai-fix-panel {
		display: flex;
		flex-direction: column;
		width: min(1100px, 100%);
		max-height: min(90vh, 900px);
		border-radius: 0.75rem;
		border: 1px solid #bfdbfe;
		background: #fff;
		box-shadow: 0 20px 50px rgba(15, 23, 42, 0.25);
	}

	:global(.dark) .ai-fix-panel {
		border-color: rgba(59, 130, 246, 0.35);
		background: #0f172a;
	}

	.ai-fix-panel__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.25rem 0.75rem;
		border-bottom: 1px solid #e2e8f0;
	}

	:global(.dark) .ai-fix-panel__header {
		border-bottom-color: rgba(56, 100, 150, 0.35);
	}

	.ai-fix-panel__title {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		color: #1e3a8a;
	}

	:global(.dark) .ai-fix-panel__title {
		color: #93c5fd;
	}

	.ai-fix-panel__issue {
		margin: 0.25rem 0 0;
		font-size: 0.8125rem;
		color: #64748b;
	}

	.ai-fix-panel__close {
		border: none;
		background: transparent;
		font-size: 1.5rem;
		line-height: 1;
		color: #64748b;
		cursor: pointer;
	}

	.ai-fix-panel__body {
		flex: 1;
		overflow: auto;
		padding: 0.75rem 1.25rem 1rem;
	}

	.ai-fix-panel__section-title {
		margin: 0 0 0.5rem;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
	}

	.ai-fix-panel__explanation {
		margin: 0 0 1rem;
		font-size: 0.875rem;
		line-height: 1.5;
		color: #334155;
	}

	:global(.dark) .ai-fix-panel__explanation {
		color: #cbd5e1;
	}

	.ai-fix-panel__diff {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.ai-fix-panel__diff--single {
		grid-template-columns: 1fr;
	}

	.ai-fix-panel__yaml-col {
		min-width: 0;
	}

	.ai-fix-panel__yaml-col :global(.yaml-readonly-viewer) {
		max-height: 320px;
		overflow: auto;
		border: 1px solid #e2e8f0;
		border-radius: 0.5rem;
	}

	.ai-fix-panel__status,
	.ai-fix-panel__error {
		font-size: 0.875rem;
	}

	.ai-fix-panel__error {
		color: #b45309;
	}

	.ai-fix-panel__footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 0.75rem 1.25rem 1rem;
		border-top: 1px solid #e2e8f0;
	}

	:global(.dark) .ai-fix-panel__footer {
		border-top-color: rgba(56, 100, 150, 0.35);
	}

	@media (max-width: 768px) {
		.ai-fix-panel__diff {
			grid-template-columns: 1fr;
		}
	}
</style>
