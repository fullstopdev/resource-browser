<script lang="ts">
	import { tick } from 'svelte';
	import { useSvelteFlow } from '@xyflow/svelte';

	let { layoutKey, flowHeight = 0 }: { layoutKey: string; flowHeight?: number } = $props();

	const { fitView } = useSvelteFlow();

	$effect(() => {
		layoutKey;
		flowHeight;
		if (flowHeight <= 0) return;
		void tick().then(() => {
			requestAnimationFrame(() => {
				try {
					fitView({ padding: 0.16, minZoom: 0.32, maxZoom: 1.05, duration: 180 });
				} catch {
					// Flow may not be mounted yet during first paint.
				}
			});
		});
	});
</script>
