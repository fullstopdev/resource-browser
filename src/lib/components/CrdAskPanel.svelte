<script lang="ts">
	import { askAI } from '$lib/ai/askAI';
	import { buildCrdContext } from '$lib/ai/buildCrdContext';

	export let kind = '';
	export let group = '';
	export let name = '';
	export let version = '';
	/** EDA release name (e.g. "26.4.2"), not display label. */
	export let release = '';
	export let deprecated = false;
	export let spec: unknown = null;
	export let status: unknown = null;

	let question = '';
	let answer: string | null = null;
	let sources: string[] = [];
	let error: string | null = null;
	let loading = false;

	async function submit() {
		const trimmed = question.trim();
		if (!trimmed || loading) return;

		loading = true;
		error = null;
		answer = null;
		sources = [];

		const result =
			release && kind && group
				? await askAI({
						question: trimmed,
						release,
						kind,
						group,
						version: version || undefined
					})
				: await askAI({
						question: trimmed,
						context: buildCrdContext({
							kind,
							group,
							name,
							version,
							release,
							deprecated,
							spec,
							status
						})
					});

		loading = false;

		if (result.error) {
			error = result.error;
		} else {
			answer = result.answer ?? null;
			sources = result.sources ?? [];
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void submit();
		}
	}
</script>

<div class="space-y-4">
	<div class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/50">
		<p class="text-sm text-slate-700 dark:text-slate-300">
			Ask about <span class="font-semibold text-slate-900 dark:text-white">{kind}</span>
			<span class="font-mono text-xs text-slate-500 dark:text-slate-400"> ({group}/{version})</span>
		</p>
		<p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
			Answers are grounded in CRD schema text (server-built context + Vectorize RAG when available).
			Powered by Cloudflare Workers AI.
		</p>
	</div>

	<div class="space-y-2">
		<label for="crd-ask-question" class="block text-xs font-semibold text-slate-600 dark:text-slate-400">
			Your question
		</label>
		<div class="flex flex-col gap-2 sm:flex-row sm:items-stretch">
			<textarea
				id="crd-ask-question"
				bind:value={question}
				on:keydown={handleKeydown}
				rows="2"
				placeholder="e.g. What fields are required in spec? How does status reflect readiness?"
				class="min-h-11 flex-1 resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
				disabled={loading}
			></textarea>
			<button
				type="button"
				on:click={submit}
				disabled={loading || !question.trim()}
				class="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
			>
				{#if loading}
					<span
						class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
						aria-hidden="true"
					></span>
					Thinking…
				{:else}
					Ask
				{/if}
			</button>
		</div>
	</div>

	{#if error}
		<div
			class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200"
			role="alert"
		>
			{error}
		</div>
	{/if}

	{#if answer}
		<div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-blue-900/40 dark:bg-[#0f2a48]/88">
			<div class="border-b border-slate-100 px-4 py-2 dark:border-slate-700">
				<h3 class="text-sm font-semibold text-slate-900 dark:text-white">Answer</h3>
			</div>
			<div class="px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-slate-700 dark:text-slate-200">
				{answer}
			</div>
			{#if sources.length > 0}
				<div class="border-t border-slate-100 px-4 py-2 dark:border-slate-700">
					<p class="text-xs font-semibold text-slate-500 dark:text-slate-400">Sources</p>
					<ul class="mt-1 list-inside list-disc text-xs text-slate-600 dark:text-slate-300">
						{#each sources as source}
							<li>{source}</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}
</div>
