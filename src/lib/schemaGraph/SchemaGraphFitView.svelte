<script lang="ts">
	import { tick } from 'svelte';
	import { useSvelteFlow } from '@xyflow/svelte';

	let {
		layoutKey,
		flowWidth = 0,
		flowHeight = 0
	}: {
		layoutKey: string;
		flowWidth?: number;
		flowHeight?: number;
	} = $props();

	const { fitView } = useSvelteFlow();

	$effect(() => {
		layoutKey;
		flowWidth;
		flowHeight;
		if (flowWidth <= 0 || flowHeight <= 0) return;
		void tick().then(() => {
			requestAnimationFrame(() => {
				try {
					fitView({ padding: 0.14, minZoom: 0.28, maxZoom: 1.05, duration: 160 });
				} catch {
					// Flow may not be mounted yet during first paint.
				}
			});
		});
	});
</script>
