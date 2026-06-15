<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import {
		closeGlobalAsk,
		getGlobalAskDefaults,
		globalAskContext,
		globalAskOpen,
		openGlobalAsk,
		releaseLabel,
		type GlobalAskDefaults
	} from '$lib/globalAsk';
	import CrdAskPanel from '$lib/components/CrdAskPanel.svelte';

	let defaults: GlobalAskDefaults = { release: '' };
	let panelKey = 0;
	let wasOpen = false;

	function refreshPanel() {
		const explicit = $globalAskContext;
		if (explicit) {
			globalAskContext.set(null);
		}
		defaults = getGlobalAskDefaults($page.url, explicit);
		panelKey += 1;
	}

	$: {
		if ($globalAskOpen && !wasOpen) {
			refreshPanel();
		}
		wasOpen = $globalAskOpen;
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
					openGlobalAsk();
				}
			}
			if (event.key === 'Escape' && $globalAskOpen) {
				closeGlobalAsk();
			}
		}

		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});

	$: releaseHint = defaults.release ? releaseLabel(defaults.release) : '';
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

			{#if releaseHint}
				<p class="global-ask-panel__context-banner">
					<span class="global-ask-panel__context-summary">Default release: {releaseHint}</span>
					<span class="global-ask-panel__context-hint">
						Include a release in your question to override (e.g. 26.4.2).
					</span>
				</p>
			{/if}

			<div class="global-ask-panel__body">
				{#key panelKey}
					<CrdAskPanel
						release={defaults.release}
						embedded={true}
						initialQuestion={defaults.prefillQuestion ?? ''}
					/>
				{/key}
			</div>
		</div>
	</div>
{/if}
