<script lang="ts">
	import { browser } from '$app/environment';
	import type { Snippet } from 'svelte';

	interface Props {
		open: boolean;
		titleId: string;
		darkMode?: boolean;
		/** default ≈ 832px; docs ≈ 880px; wide ≈ 1152px */
		size?: 'default' | 'docs' | 'wide';
		onClose: () => void;
		header?: Snippet;
		toolbar?: Snippet;
		children: Snippet;
	}

	let {
		open,
		titleId,
		darkMode = false,
		size = 'default',
		onClose,
		header,
		toolbar,
		children
	}: Props = $props();

	function portal(node: HTMLElement) {
		if (!browser) return { destroy() {} };
		document.body.appendChild(node);
		return {
			destroy() {
				try {
					node.parentNode?.removeChild(node);
				} catch {
					/* ignore */
				}
			}
		};
	}

	function setBodyScrollLock(locked: boolean) {
		if (!browser) return;
		document.body.style.overflow = locked ? 'hidden' : '';
	}

	$effect(() => {
		setBodyScrollLock(open);
		return () => setBodyScrollLock(false);
	});

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) {
			event.preventDefault();
			onClose();
		}
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) onClose();
	}
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

{#if open}
	<!--
		Portal escapes the page `.oa-root`, so tokens must live on this node.
		`oa-root` + `dark` (when darkMode) keeps shell/cards/buttons on one theme.
	-->
	<div
		use:portal
		class="oa-modal-portal oa-root"
		class:oa-modal-portal--dark={darkMode}
		class:dark={darkMode}
		role="presentation"
		onclick={handleBackdropClick}
	>
		<button
			type="button"
			class="oa-modal-backdrop"
			onclick={onClose}
			aria-label="Close dialog"
			tabindex={-1}
		></button>

		<div
			class="oa-modal-panel"
			class:oa-modal-panel--docs={size === 'docs'}
			class:oa-modal-panel--wide={size === 'wide'}
			class:oa-modal-panel--dark={darkMode}
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
		>
			{#if header}
				<header class="oa-modal-header">
					{@render header()}
				</header>
			{/if}
			{#if toolbar}
				<div class="oa-modal-toolbar">
					{@render toolbar()}
				</div>
			{/if}
			<div class="oa-modal-body">
				{@render children()}
			</div>
		</div>
	</div>
{/if}

<style>
	:global(.oa-modal-portal) {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: stretch;
		justify-content: center;
		padding: 0;
		font-family: var(--oa-font, 'NokiaPureText', ui-sans-serif, system-ui, sans-serif);
	}

	@media (min-width: 768px) {
		:global(.oa-modal-portal) {
			align-items: center;
			padding: 1rem;
		}
	}

	:global(.oa-modal-backdrop) {
		position: absolute;
		inset: 0;
		border: none;
		padding: 0;
		margin: 0;
		cursor: pointer;
		background: var(--oa-modal-backdrop, rgba(15, 23, 42, 0.58));
		backdrop-filter: blur(3px);
	}

	:global(.oa-modal-panel) {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100dvh;
		max-height: 100dvh;
		overflow: hidden;
		/* Match ResourceModal: bg-white / dark:bg-slate-900 */
		background: var(--oa-panel, #ffffff);
		border: 1px solid var(--oa-panel-border, #e2e8f0);
		box-shadow: var(--oa-modal-shadow);
		color: var(--oa-text, #0f172a);
	}

	:global(.oa-modal-panel--dark),
	:global(.oa-modal-portal--dark .oa-modal-panel) {
		background: var(--oa-panel, #0f172a);
		border-color: var(--oa-panel-border, #334155);
		color: var(--oa-text, #f1f5f9);
	}

	@media (min-width: 768px) {
		:global(.oa-modal-panel) {
			width: min(45rem, 100%);
			height: auto;
			max-height: min(90vh, 960px);
			border-radius: var(--oa-radius-xl, 0.875rem);
		}

		:global(.oa-modal-panel--docs) {
			width: min(55rem, 100%);
		}

		:global(.oa-modal-panel--wide) {
			width: min(72rem, 100%);
		}
	}

	:global(.oa-modal-header) {
		position: sticky;
		top: 0;
		z-index: 2;
		flex-shrink: 0;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.875rem 1rem 0.75rem;
		border-bottom: 1px solid var(--oa-panel-border, #e2e8f0);
		background: color-mix(in srgb, var(--oa-panel, #fff) 94%, transparent);
		backdrop-filter: blur(10px);
	}

	:global(.oa-modal-portal--dark .oa-modal-header) {
		border-bottom-color: var(--oa-panel-border, #1e293b);
		background: color-mix(in srgb, var(--oa-panel, #0f172a) 94%, transparent);
	}

	@media (min-width: 640px) {
		:global(.oa-modal-header) {
			padding: 1rem 1.35rem 0.875rem;
		}
	}

	:global(.oa-modal-toolbar) {
		flex-shrink: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		border-bottom: 1px solid color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 85%, transparent);
		background: color-mix(in srgb, var(--oa-canvas-bottom, #f1f5f9) 55%, var(--oa-panel, #fff));
	}

	@media (min-width: 640px) {
		:global(.oa-modal-toolbar) {
			padding: 0.625rem 1.35rem;
		}
	}

	:global(.oa-modal-portal--dark .oa-modal-toolbar),
	:global(.dark .oa-modal-toolbar) {
		background: color-mix(
			in srgb,
			var(--oa-canvas-bottom, rgba(7, 20, 40, 0.65)) 40%,
			var(--oa-panel)
		);
	}

	:global(.oa-modal-body) {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 1rem 1rem 1.35rem;
		-webkit-overflow-scrolling: touch;
	}

	@media (min-width: 640px) {
		:global(.oa-modal-body) {
			padding: 1.15rem 1.35rem 1.6rem;
		}
	}

	:global(.oa-modal-header-text) {
		min-width: 0;
		flex: 1;
	}

	:global(.oa-modal-eyebrow) {
		margin: 0 0 0.3rem;
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--oa-text-muted, #64748b);
	}

	:global(.oa-modal-title) {
		margin: 0;
		font-family: var(--oa-font-headline, 'NokiaPureHeadline', ui-sans-serif, system-ui, sans-serif);
		font-size: 1.125rem;
		font-weight: 700;
		line-height: 1.3;
		color: var(--oa-text, #0f172a);
		word-break: break-word;
	}

	:global(.oa-modal-subtitle) {
		margin: 0.3rem 0 0;
		font-size: 0.75rem;
		color: var(--oa-text-muted, #64748b);
	}

	:global(.oa-modal-close) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: var(--oa-radius, 0.5rem);
		border: 1px solid transparent;
		background: transparent;
		color: var(--oa-text-muted, #64748b);
		cursor: pointer;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			color 0.12s ease;
	}

	:global(.oa-modal-close:hover) {
		border-color: var(--oa-panel-border, #e2e8f0);
		background: color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 22%, transparent);
		color: var(--oa-text, #0f172a);
	}

	:global(.oa-modal-close:focus-visible) {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--oa-focus-ring, #2563eb) 35%, transparent);
	}
</style>
