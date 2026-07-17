<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';

	interface Props {
		items: T[];
		itemHeight: number;
		overscan?: number;
		class?: string;
		emptyMessage?: string;
		itemKey: (item: T, index: number) => string | number;
		children: Snippet<[{ item: T; index: number }]>;
	}

	let {
		items,
		itemHeight,
		overscan = 6,
		class: className = '',
		emptyMessage = '',
		itemKey,
		children
	}: Props = $props();

	let scrollTop = $state(0);
	let viewportHeight = $state(400);

	const totalHeight = $derived(items.length * itemHeight);
	const startIndex = $derived(Math.max(0, Math.floor(scrollTop / itemHeight) - overscan));
	const visibleCount = $derived(Math.ceil(viewportHeight / itemHeight) + overscan * 2);
	const endIndex = $derived(Math.min(items.length, startIndex + visibleCount));
	const offsetY = $derived(startIndex * itemHeight);
	const slice = $derived(items.slice(startIndex, endIndex));

	function onScroll(event: Event) {
		const el = event.currentTarget as HTMLElement;
		scrollTop = el.scrollTop;
	}

	function observeViewport(node: HTMLElement) {
		const ro = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) viewportHeight = entry.contentRect.height;
		});
		ro.observe(node);
		return {
			destroy() {
				ro.disconnect();
			}
		};
	}
</script>

<div
	class="virtual-scroll-list {className}"
	use:observeViewport
	onscroll={onScroll}
	role="presentation"
>
	{#if items.length === 0 && emptyMessage}
		<p class="virtual-scroll-list__empty">{emptyMessage}</p>
	{:else}
		<div class="virtual-scroll-list__spacer" style:height="{totalHeight}px">
			<div class="virtual-scroll-list__window" style:transform="translateY({offsetY}px)">
				{#each slice as item, localIndex (itemKey(item, startIndex + localIndex))}
					<div class="virtual-scroll-list__item" style:height="{itemHeight}px">
						{@render children({ item, index: startIndex + localIndex })}
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.virtual-scroll-list {
		overflow: auto;
		position: relative;
		min-height: 0;
	}

	.virtual-scroll-list__spacer {
		position: relative;
		width: 100%;
	}

	.virtual-scroll-list__window {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		will-change: transform;
	}

	.virtual-scroll-list__item {
		box-sizing: border-box;
		overflow: hidden;
	}

	.virtual-scroll-list__empty {
		padding: 1rem 0.5rem;
		font-size: 0.8125rem;
		color: #64748b;
		text-align: center;
	}
</style>
