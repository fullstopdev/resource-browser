<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import {
		closeGlobalAsk,
		contextSummary,
		globalAskContext,
		globalAskOpen,
		resolveGlobalAskContext,
		type ResolvedAskContext
	} from '$lib/globalAsk';
	import CrdAskPanel from '$lib/components/CrdAskPanel.svelte';

	let resolved: ResolvedAskContext | null = null;
	let resolving = false;
	let panelKey = 0;

	async function initPanel() {
		resolving = true;
		const explicit = $globalAskContext;
		if (explicit) {
			globalAskContext.set(null);
		}
		resolved = await resolveGlobalAskContext($page.url, explicit);
		panelKey += 1;
		resolving = false;
	}

	$: if ($globalAskOpen && $page.url) {
		void initPanel();
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) closeGlobalAsk();
	}

	onMount(() => {
		if (!browser) return;

		function onKeydown(event: KeyboardEvent) {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
				event.preventDefault();
				if ($globalAskOpen) {
					closeGlobalAsk();
				} else {
					import('$lib/globalAsk').then(({ openGlobalAsk }) => openGlobalAsk());
				}
			}
			if (event.key === 'Escape' && $globalAskOpen) {
				closeGlobalAsk();
			}
		}

		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});

	$: summary = resolved ? contextSummary(resolved) : '';
	$: showScopedHint = !!(resolved?.hasCrdContext || resolved?.release);
</script>

{#if $globalAskOpen}
	<div
		class="global-ask-overlay"
		role="presentation"
		onclick={handleBackdropClick}
	>
		<div
			class="global-ask-panel"
			role="dialog"
			aria-modal="true"
			aria-label="Ask AI"
		>
			<header class="global-ask-panel__header">
				<div class="global-ask-panel__header-main">
					<h2 class="global-ask-panel__title">Ask AI</h2>
					<p class="global-ask-panel__subtitle">
						Grounded answers from CRD schemas, EDA docs, and Vectorize RAG.
					</p>
				</div>
				<button
					type="button"
					class="global-ask-panel__close"
					aria-label="Close Ask AI"
					onclick={closeGlobalAsk}
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</header>

			{#if resolving}
				<p class="global-ask-panel__context-loading">Detecting context…</p>
			{:else if resolved && showScopedHint && summary}
				<p class="global-ask-panel__context-banner">
					{#if resolved.hasCrdContext}
						<span class="global-ask-panel__detected-badge">CRD context</span>
					{/if}
					<span class="global-ask-panel__context-summary">{summary}</span>
				</p>
			{/if}

			<div class="global-ask-panel__body">
				{#if resolved && !resolving}
					{#key panelKey}
						<CrdAskPanel
							kind={resolved.kind}
							group={resolved.group}
							name={resolved.name}
							version={resolved.version}
							release={resolved.release ?? resolved.kvRelease ?? ''}
							kvRelease={resolved.kvRelease}
							hasCrdContext={resolved.hasCrdContext}
							embedded={true}
						/>
					{/key}
				{/if}
			</div>
		</div>
	</div>
{/if}
