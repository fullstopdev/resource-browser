<script lang="ts">
	import { highlightYaml, tokenClass } from '$lib/validate-bundle/yamlHighlight';

	interface Props {
		value: string;
		label?: string;
	}

	let { value, label = 'YAML output' }: Props = $props();

	const lines = $derived(value.split('\n'));
	const lineCount = $derived(Math.max(lines.length, 1));
	const tokens = $derived(highlightYaml(value));
</script>

<div class="yaml-readonly-viewer" role="region" aria-label={label}>
	<div class="yaml-readonly-viewer__body">
		<div class="yaml-gutter yaml-readonly-viewer__gutter" aria-hidden="true">
			{#each Array(lineCount) as _, i (i)}
				<div class="yaml-gutter-line">{i + 1}</div>
			{/each}
		</div>
		<pre class="yaml-highlight yaml-readonly-viewer__code"><code
				>{#each tokens as token, i (i)}<span class={tokenClass(token.type)}>{token.text}</span
				>{/each}</code></pre>
	</div>
</div>
