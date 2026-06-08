<script lang="ts">
	type Size = 'sm' | 'md';

	let { size = 'md' as Size }: { size?: Size } = $props();
</script>

<svg
	class="eda-ai-brand-icon eda-ai-brand-icon--{size}"
	viewBox="0 0 24 24"
	fill="none"
	aria-hidden="true"
>
	<!-- Subtle sparkle accent -->
	<path
		d="M18.75 4.5l.35 1.05.7.35-.7.35-.35 1.05-.35-1.05-.7-.35.7-.35.35-1.05z"
		fill="currentColor"
		opacity="0.55"
	/>
	<path
		d="M6.5 17.25V8.75h1.35l2.45 5.85h.08l2.45-5.85H14.2v8.5h-1.25v-6.1h-.06l-2.55 6.1h-.95l-2.55-6.1h-.06v6.1H6.5z"
		fill="currentColor"
	/>
	<path d="M16.25 8.5h1.1v8.75h-1.1V8.5z" fill="currentColor" />
	<circle cx="16.8" cy="6.85" r="0.85" fill="currentColor" />
</svg>
