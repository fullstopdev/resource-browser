<script lang="ts">
	import { httpMethodLabel, httpMethodStyle } from '$lib/openapi/methodStyles';

	interface Props {
		method: string;
		compact?: boolean;
	}

	let { method, compact = false }: Props = $props();

	const style = $derived(httpMethodStyle(method));
	const label = $derived(httpMethodLabel(method));
</script>

<span
	class="openapi-method-badge"
	class:openapi-method-badge--compact={compact}
	class:openapi-method-badge--get={style === 'get'}
	class:openapi-method-badge--post={style === 'post'}
	class:openapi-method-badge--put={style === 'put'}
	class:openapi-method-badge--patch={style === 'patch'}
	class:openapi-method-badge--delete={style === 'delete'}
	class:openapi-method-badge--other={style === 'other'}>{label}</span
>

<style>
	/* Fixed width, mono, tinted: the same badge in the list, the detail panel and the diff. */
	.openapi-method-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 3.5rem;
		padding: 0.3rem 0.4rem;
		border-radius: 0.3125rem;
		font-family: var(--rb-font-mono, 'Fira Code', ui-monospace, monospace);
		font-size: 0.6875rem;
		font-weight: 700;
		line-height: 1;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--rb-ink-2, #3c4860);
		background: var(--rb-raised, #f0f3f8);
	}

	.openapi-method-badge--compact {
		min-width: 3.25rem;
		font-size: 0.65rem;
	}

	.openapi-method-badge--get {
		color: var(--oa-method-get, #1d5fd6);
		background: var(--oa-method-get-bg, #e6eefc);
	}
	.openapi-method-badge--post {
		color: var(--oa-method-post, #0d7a4f);
		background: var(--oa-method-post-bg, #e3f5ec);
	}
	.openapi-method-badge--put {
		color: var(--oa-method-put, #946200);
		background: var(--oa-method-put-bg, #fdf3dc);
	}
	.openapi-method-badge--patch {
		color: var(--oa-method-patch, #6b3fb8);
		background: var(--oa-method-patch-bg, #efe8fb);
	}
	.openapi-method-badge--delete {
		color: var(--oa-method-delete, #b42318);
		background: var(--oa-method-delete-bg, #fde7e5);
	}
</style>
