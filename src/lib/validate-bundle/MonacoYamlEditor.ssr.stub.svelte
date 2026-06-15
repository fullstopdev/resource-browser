<script lang="ts">
	let {
		value = '',
		highlightLine = null,
		validating = false
	}: {
		value?: string;
		highlightLine?: number | null;
		validating?: boolean;
	} = $props();

	export async function focusLine(_line: number) {}
</script>

<div
	class="monaco-yaml-editor monaco-yaml-editor--ssr-placeholder"
	aria-hidden="true"
	data-value-length={value.length}
	data-highlight-line={highlightLine ?? ''}
	data-validating={validating}
></div>
