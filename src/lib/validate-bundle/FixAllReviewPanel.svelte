<script lang="ts">
	import MonacoYamlDiffViewer from './MonacoYamlDiffViewer.svelte';
	import type { FixAllChange } from './fixAllBundle';

	interface Props {
		open: boolean;
		beforeYaml: string;
		afterYaml: string;
		changes: FixAllChange[];
		onClose: () => void;
		onRevert: () => void;
	}

	let { open, beforeYaml, afterYaml, changes, onClose, onRevert }: Props = $props();

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) onClose();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onClose();
	}

	const changeCount = $derived(changes.length);
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

{#if open}
	<div class="fix-all-overlay" role="presentation" onclick={handleBackdropClick}>
		<div
			class="fix-all-panel"
			role="dialog"
			aria-modal="true"
			aria-labelledby="fix-all-title"
		>
			<header class="fix-all-panel__header">
				<div>
					<h2 id="fix-all-title" class="fix-all-panel__title">
						AI Fix — {changeCount} change{changeCount === 1 ? '' : 's'} applied
					</h2>
					<p class="fix-all-panel__subtitle">Review what changed before keeping or reverting.</p>
				</div>
				<button type="button" class="fix-all-panel__close" aria-label="Close" onclick={onClose}>
					×
				</button>
			</header>

			<div class="fix-all-panel__body">
				<section class="fix-all-panel__diff-section">
					<h3 class="fix-all-panel__section-title">Before / After</h3>
					{#key beforeYaml}
						<MonacoYamlDiffViewer
							original={beforeYaml}
							modified={afterYaml}
							label="AI Fix diff"
							fill
						/>
					{/key}
				</section>
			</div>

			<footer class="fix-all-panel__footer">
				<button type="button" class="validate-yaml-btn validate-yaml-btn--ghost" onclick={onRevert}>
					Revert changes
				</button>
				<button
					type="button"
					class="validate-yaml-btn validate-yaml-btn--primary"
					onclick={onClose}
				>
					Keep changes
				</button>
			</footer>
		</div>
	</div>
{/if}

<style>
	.fix-all-overlay {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgba(15, 23, 42, 0.55);
	}

	.fix-all-panel {
		display: flex;
		flex-direction: column;
		width: min(1400px, 100%);
		height: min(80vh, 960px);
		max-height: min(80vh, 960px);
		border-radius: 0.75rem;
		border: 1px solid #bfdbfe;
		background: #fff;
		box-shadow: 0 20px 50px rgba(15, 23, 42, 0.25);
	}

	:global(.dark) .fix-all-panel {
		border-color: rgba(59, 130, 246, 0.35);
		background: #0f172a;
	}

	.fix-all-panel__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.25rem 0.75rem;
		border-bottom: 1px solid #e2e8f0;
	}

	:global(.dark) .fix-all-panel__header {
		border-bottom-color: rgba(56, 100, 150, 0.35);
	}

	.fix-all-panel__title {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
		color: #0f172a;
	}

	:global(.dark) .fix-all-panel__title {
		color: #f1f5f9;
	}

	.fix-all-panel__subtitle {
		margin: 0.25rem 0 0;
		font-size: 0.875rem;
		color: #64748b;
	}

	.fix-all-panel__close {
		border: none;
		background: transparent;
		font-size: 1.5rem;
		line-height: 1;
		cursor: pointer;
		color: #64748b;
		padding: 0.25rem;
	}

	.fix-all-panel__body {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		padding: 0.75rem 1.25rem 1rem;
		display: flex;
		flex-direction: column;
	}

	.fix-all-panel__diff-section {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.fix-all-panel__section-title {
		margin: 0 0 0.5rem;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
		flex-shrink: 0;
	}

	.fix-all-panel__footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 0.75rem 1.25rem 1rem;
		border-top: 1px solid #e2e8f0;
	}

	:global(.dark) .fix-all-panel__footer {
		border-top-color: rgba(56, 100, 150, 0.35);
	}
</style>
