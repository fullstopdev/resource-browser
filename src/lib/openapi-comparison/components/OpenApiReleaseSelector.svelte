<script lang="ts">
	import type { OpenApiRelease } from '$lib/openapi/types';

	let {
		role,
		releaseName = $bindable(''),
		release = null,
		releases = [],
		swapping = false,
		onReleaseChange = () => {}
	}: {
		role: 'source' | 'target';
		releaseName?: string;
		release?: OpenApiRelease | null;
		releases?: OpenApiRelease[];
		swapping?: boolean;
		onReleaseChange?: () => void;
	} = $props();

	const idPrefix = $derived(role === 'source' ? 'oa-source' : 'oa-target');
	const badgeClass = $derived(
		role === 'source'
			? 'comparison-release-badge comparison-release-badge--source'
			: 'comparison-release-badge comparison-release-badge--target'
	);
	const label = $derived(role === 'source' ? 'Source' : 'Target');
</script>

<div
	class="comparison-release-card"
	class:comparison-release-card--swapping={swapping}
	data-role={role}
>
	<div class="comparison-release-card__header">
		<span class={badgeClass}>{label}</span>
		{#if release}
			<span class="comparison-release-card__label">{release.label}</span>
		{/if}
		<span class="comparison-release-card__hint">
			{role === 'source' ? 'Baseline release' : 'Compared against source'}
		</span>
	</div>

	<div class="comparison-release-card__fields">
		<div class="comparison-release-card__field">
			<label for="{idPrefix}-release" class="comparison-release-card__field-label">Release</label>
			<select
				id="{idPrefix}-release"
				bind:value={releaseName}
				onchange={onReleaseChange}
				class="spec-search-select w-full"
			>
				<option value="">Select release…</option>
				{#each releases as r (r.name)}
					<option value={r.name}>{r.label}{r.default ? ' (latest)' : ''}</option>
				{/each}
			</select>
		</div>
	</div>
</div>
