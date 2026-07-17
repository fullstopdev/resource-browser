<script lang="ts">
	import { browser } from '$app/environment';
	import { onDestroy } from 'svelte';
	import SchemaDiffPanel from './SchemaDiffPanel.svelte';
	import {
		diffChangeKindBadgeClass,
		diffChangeKindLabel,
		type DiffDetailModalPayload
	} from '../diffDetails';

	export let open = false;
	export let payload: DiffDetailModalPayload | null = null;
	export let onClose: () => void = () => {};

	const modalTitleId = 'diff-detail-modal-title';

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

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) {
			event.preventDefault();
			onClose();
		}
	}

	function setBodyScrollLock(locked: boolean) {
		if (!browser) return;
		document.documentElement.classList.toggle('no-root-scroll', locked);
		document.body.classList.toggle('no-root-scroll', locked);
	}

	$: setBodyScrollLock(open);

	onDestroy(() => {
		setBodyScrollLock(false);
	});
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open && payload}
	<div
		use:portal
		class="diff-detail-modal-portal fixed inset-0 z-[100] flex items-center justify-center p-0 md:p-4"
		role="presentation"
	>
		<button
			type="button"
			class="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
			on:click={onClose}
			aria-label="Close diff detail"
			tabindex={-1}
		></button>

		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby={modalTitleId}
			class="diff-detail-modal-panel relative flex h-[100dvh] w-full max-w-none flex-col overflow-hidden bg-white shadow-2xl md:h-auto md:max-h-[90vh] md:max-w-5xl md:rounded-xl dark:bg-slate-900"
		>
			<header
				class="sticky top-0 z-10 shrink-0 border-b border-slate-200 bg-white/95 px-3 py-3 backdrop-blur-sm sm:px-4 dark:border-slate-700 dark:bg-slate-900/95"
			>
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0 flex-1">
						<p class="diff-detail-modal-eyebrow">{payload.eyebrow ?? 'Schema diff'}</p>
						<h2
							id={modalTitleId}
							class="diff-detail-modal-title font-mono text-base font-semibold text-slate-900 sm:text-lg dark:text-white"
						>
							{payload.title}
						</h2>
						{#if payload.subtitle}
							<p class="mt-0.5 truncate font-mono text-xs text-slate-500 dark:text-slate-400">
								{payload.subtitle}
							</p>
						{/if}
						<div class="diff-detail-modal-meta mt-2 flex flex-wrap items-center gap-2">
							{#if payload.changeKind}
								<span class={diffChangeKindBadgeClass(payload.changeKind)}>
									{diffChangeKindLabel(payload.changeKind)}
								</span>
							{/if}
							<div
								class="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900/50"
							>
								<span class="comparison-release-pill comparison-release-pill--source">
									{payload.sourceLabel}
								</span>
								<svg
									class="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									aria-hidden="true"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M17 8l4 4m0 0l-4 4m4-4H3"
									/>
								</svg>
								<span class="comparison-release-pill comparison-release-pill--target">
									{payload.targetLabel}
								</span>
							</div>
						</div>
					</div>
					<button
						type="button"
						on:click={onClose}
						class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
						aria-label="Close"
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
					</button>
				</div>
			</header>

			<div class="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-4 sm:py-4">
				<section
					class="diff-detail-modal-body overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-blue-900/40 dark:bg-[#0f2a48]/88"
				>
					{#if payload.details.length > 0}
						<div class="diff-detail-modal-body__inner overflow-x-auto p-3 sm:p-4">
							<SchemaDiffPanel
								details={payload.details}
								sourceLabel={payload.sourceLabel}
								targetLabel={payload.targetLabel}
								highlightedLine={payload.focusedLine ?? null}
							/>
						</div>
					{:else}
						<p class="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
							No field-level details available.
						</p>
					{/if}
				</section>
			</div>

			{#if payload.secondaryAction}
				<footer
					class="shrink-0 border-t border-slate-200 bg-white/95 px-3 py-3 backdrop-blur-sm sm:px-4 dark:border-slate-700 dark:bg-slate-900/95"
				>
					<a
						href={payload.secondaryAction.href}
						class="diff-detail-modal-action inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-blue-600 no-underline transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-slate-600 dark:text-blue-300 dark:hover:border-blue-700 dark:hover:bg-blue-950/40"
						target="_blank"
						rel="noopener noreferrer"
					>
						{payload.secondaryAction.label}
					</a>
				</footer>
			{/if}
		</div>
	</div>
{/if}
