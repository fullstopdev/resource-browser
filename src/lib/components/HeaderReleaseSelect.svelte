<script lang="ts">
	export type HeaderReleaseOption = {
		name: string;
		label: string;
		default?: boolean;
	};

	let {
		id = 'header-release',
		label = 'Release',
		value = '',
		releases = [],
		onChange = (_name: string) => {},
		ariaLabel = 'Select EDA release',
		latestSuffix = ' (latest)',
		includeEmpty = false,
		emptyLabel = 'Select release…',
		compact = false
	}: {
		id?: string;
		label?: string;
		value?: string;
		releases?: HeaderReleaseOption[];
		onChange?: (name: string) => void;
		ariaLabel?: string;
		latestSuffix?: string;
		includeEmpty?: boolean;
		emptyLabel?: string;
		/** Narrower width for dual source/target header layouts */
		compact?: boolean;
	} = $props();
</script>

<div class="header-release-field" class:header-release-field--compact={compact}>
	<label for={id} class="header-release-field__label">{label}</label>
	<select
		{id}
		class="header-release-field__select"
		{value}
		onchange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}
		aria-label={ariaLabel}
	>
		{#if includeEmpty}
			<option value="">{emptyLabel}</option>
		{/if}
		{#each releases as release (release.name)}
			<option value={release.name}>
				{release.label}{release.default ? latestSuffix : ''}
			</option>
		{/each}
	</select>
</div>
