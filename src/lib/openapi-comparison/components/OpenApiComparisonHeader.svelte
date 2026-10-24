<script lang="ts">
	let { activeStep = 1 }: { activeStep?: 1 | 2 | 3 } = $props();

	const steps = [
		{ num: 1, title: 'Pick releases', desc: 'Source baseline & target' },
		{ num: 2, title: 'Compare', desc: 'Classify APIs & diffs' },
		{ num: 3, title: 'Explore diffs', desc: 'Filter, search & expand' }
	] as const;
</script>

<section class="comparison-hero comparison-hero--compact" aria-labelledby="openapi-comparison-heading">
	<div class="comparison-hero__content">
		<p class="homepage-hero-kicker">API Server</p>
		<h1 id="openapi-comparison-heading" class="homepage-title text-slate-900 dark:text-slate-100">
			Comparison
		</h1>
		<p class="homepage-subtitle text-slate-600 dark:text-slate-400">
			Diff API Server specs between source and target releases.
		</p>
	</div>

	<ol class="comparison-workflow" aria-label="Comparison workflow">
		{#each steps as step (step.num)}
			<li
				class="comparison-workflow-step"
				class:comparison-workflow-step--active={activeStep === step.num}
				class:comparison-workflow-step--done={activeStep > step.num}
			>
				<span class="comparison-workflow-step__num" aria-hidden="true">{step.num}</span>
				<span class="comparison-workflow-step__text">
					<span class="comparison-workflow-step__title">{step.title}</span>
					<span class="comparison-workflow-step__desc">{step.desc}</span>
				</span>
			</li>
		{/each}
	</ol>
</section>
