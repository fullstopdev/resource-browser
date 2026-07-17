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
	.openapi-method-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 3.25rem;
		padding: 0.2rem 0.5rem;
		border-radius: 0.375rem;
		font-family: 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		border: 1px solid transparent;
	}

	.openapi-method-badge--compact {
		min-width: 2.75rem;
		padding: 0.1rem 0.35rem;
		font-size: 0.625rem;
	}

	.openapi-method-badge--get {
		background: rgba(37, 99, 235, 0.12);
		border-color: rgba(37, 99, 235, 0.35);
		color: #2563eb;
	}

	:global(.dark) .openapi-method-badge--get {
		background: rgba(96, 165, 250, 0.15);
		border-color: rgba(96, 165, 250, 0.4);
		color: #93c5fd;
	}

	.openapi-method-badge--post {
		background: rgba(22, 163, 74, 0.12);
		border-color: rgba(22, 163, 74, 0.35);
		color: #16a34a;
	}

	:global(.dark) .openapi-method-badge--post {
		background: rgba(74, 222, 128, 0.14);
		border-color: rgba(74, 222, 128, 0.35);
		color: #86efac;
	}

	.openapi-method-badge--put,
	.openapi-method-badge--patch {
		background: rgba(217, 119, 6, 0.12);
		border-color: rgba(217, 119, 6, 0.35);
		color: #d97706;
	}

	:global(.dark) .openapi-method-badge--put,
	:global(.dark) .openapi-method-badge--patch {
		background: rgba(251, 191, 36, 0.14);
		border-color: rgba(251, 191, 36, 0.35);
		color: #fcd34d;
	}

	.openapi-method-badge--delete {
		background: rgba(220, 38, 38, 0.12);
		border-color: rgba(220, 38, 38, 0.35);
		color: #dc2626;
	}

	:global(.dark) .openapi-method-badge--delete {
		background: rgba(248, 113, 113, 0.14);
		border-color: rgba(248, 113, 113, 0.35);
		color: #fca5a5;
	}

	.openapi-method-badge--other {
		background: #f1f5f9;
		border-color: #cbd5e1;
		color: #475569;
	}

	:global(.dark) .openapi-method-badge--other {
		background: rgba(30, 41, 59, 0.85);
		border-color: rgba(71, 85, 105, 0.7);
		color: #cbd5e1;
	}
</style>
