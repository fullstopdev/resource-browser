<script lang="ts">
	import { askAI, type ResolvedTargetSummary } from '$lib/ai/askAI';
	import type { RagSource } from '$lib/ai/rag/chunkTypes';
	import { resourceBrowserUrl } from '$lib/ai/rag/resourceLinks';
	import { parseReleaseFromQuestion } from '$lib/globalAsk';
	import SimpleMarkdown from '$lib/components/SimpleMarkdown.svelte';
	import { page } from '$app/stores';

	/** Default release when the question does not mention one (from URL ?release=). */
	export let release = '';
	/** Hide duplicate header when embedded in GlobalAskPanel. */
	export let embedded = false;
	/** Prefill the question input when the panel opens. */
	export let initialQuestion = '';

	const starterQuestions = [
		'What is the Policy CRD in 26.4.2?',
		'Required fields for Interface in 26.4.2?',
		'Explain Topology resource for release 26.4.2',
		'Example YAML for a Fabric in 26.4.2?'
	];

	$: releaseLabel = release ? `EDA ${release}` : '';

	let question = initialQuestion;

	let answer: string | null = null;
	let sources: RagSource[] = [];
	let error: string | null = null;
	let loading = false;
	let sourcesOpen = false;
	let hasAsked = false;
	let answerKvContext = false;
	let answerGrounded = false;
	let answerRelease = '';
	let answerTargetsResolved: ResolvedTargetSummary[] = [];

	$: scopeChipLabel = (() => {
		if (!answerTargetsResolved.length) return '';
		const releasePart = answerRelease ? ` · EDA ${answerRelease}` : '';
		if (answerTargetsResolved.length === 1) {
			const t = answerTargetsResolved[0];
			return `Answering about ${t.kind} (${t.group})${releasePart}`;
		}
		const topic =
			answerTargetsResolved.length <= 3
				? answerTargetsResolved.map((t) => t.kind).join(', ')
				: `${answerTargetsResolved.length} CRDs`;
		return `Answering about ${topic}${releasePart}`;
	})();

	async function submit(preset?: string) {
		const trimmed = (preset ?? question).trim();
		if (!trimmed || loading) return;

		if (preset) question = preset;
		loading = true;
		error = null;
		answer = null;
		sources = [];
		sourcesOpen = false;
		hasAsked = true;
		answerKvContext = false;
		answerGrounded = false;
		answerRelease = '';
		answerTargetsResolved = [];

		const questionRelease = parseReleaseFromQuestion(trimmed);
		const scopedRelease = questionRelease || release || undefined;

		const result = await askAI({
			question: trimmed,
			release: scopedRelease
		});

		loading = false;

		if (result.error) {
			error = result.error;
		} else {
			answer = result.answer ?? null;
			sources = result.sources ?? [];
			answerKvContext = !!result.kvCached;
			answerGrounded = !!result.grounded;
			answerRelease = result.release ?? scopedRelease ?? '';
			answerTargetsResolved = result.targetsResolved ?? [];
		}
	}

	function browserLink(source: RagSource): string | null {
		return resourceBrowserUrl($page.url.origin, source);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			void submit();
		}
	}

	function docsUrl(path: string): string {
		return `https://docs.eda.dev${path}`;
	}
</script>

<div class="flex flex-col gap-4">
	{#if scopeChipLabel && hasAsked}
		<p
			class="crd-ask-scope-chip rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-950 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100"
		>
			<span class="font-semibold">Scope:</span>
			{scopeChipLabel}
			{#if answerTargetsResolved.some((t) => t.kvHit)}
				<span class="ml-1 text-xs text-violet-800/70 dark:text-violet-200/70">· KV summaries loaded</span>
			{/if}
		</p>
	{/if}
	{#if !embedded}
		<!-- Header -->
		<header
			class="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50/90 to-slate-50 px-4 py-4 dark:border-blue-900/50 dark:from-[#0f2a48]/90 dark:to-slate-900/50"
		>
			<div class="flex items-start gap-3">
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm dark:bg-blue-500"
					aria-hidden="true"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
						/>
					</svg>
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-2">
						<h2 class="text-base font-semibold text-slate-900 dark:text-white">Ask AI</h2>
						<span
							class="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
						>
							Workers AI
						</span>
						{#if releaseLabel}
							<span
								class="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
								title="Default release when not mentioned in your question"
							>
								{releaseLabel}
							</span>
						{/if}
					</div>
					<p class="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
						Get grounded answers about EDA CRDs and documentation from warmed KV summaries, schemas, Nokia EDA docs, and Vectorize RAG.
					</p>
				</div>
			</div>
		</header>
	{/if}

	<!-- Starter chips -->
	<div>
		<p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
			Quick prompts
		</p>
		<div class="flex flex-wrap gap-2" role="group" aria-label="Suggested questions">
			{#each starterQuestions as starter}
				<button
					type="button"
					on:click={() => submit(starter)}
					disabled={loading}
					class="inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
				>
					{starter}
				</button>
			{/each}
		</div>
	</div>

	<!-- Input -->
	<div class="space-y-2">
		<label for="crd-ask-question" class="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
			Your question
		</label>
		<div class="flex flex-col gap-2 sm:flex-row sm:items-end">
			<textarea
				id="crd-ask-question"
				bind:value={question}
				on:keydown={handleKeydown}
				rows="3"
				placeholder="Ask about fields, relationships, validation, or example manifests…"
				class="min-h-[5.5rem] flex-1 resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
				disabled={loading}
			></textarea>
			<button
				type="button"
				on:click={() => submit()}
				disabled={loading || !question.trim()}
				class="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto dark:bg-blue-500 dark:hover:bg-blue-600"
			>
				{#if loading}
					<span
						class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
						aria-hidden="true"
					></span>
					Thinking…
				{:else}
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
					</svg>
					Ask
				{/if}
			</button>
		</div>
		<p class="text-xs text-slate-400 dark:text-slate-500">
			<span class="hidden sm:inline">Press </span><kbd class="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] dark:border-slate-600 dark:bg-slate-800">Ctrl</kbd>+<kbd class="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] dark:border-slate-600 dark:bg-slate-800">Enter</kbd> to send
		</p>
	</div>

	<!-- Empty state -->
	{#if !hasAsked && !loading && !error}
		<div
			class="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-900/30"
		>
			<svg
				class="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
				aria-hidden="true"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="1.5"
					d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
				/>
			</svg>
			<p class="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">Ask your first question</p>
			<p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
				Try a suggested prompt above or ask about EDA concepts, CRD fields, validation, or example manifests.
			</p>
		</div>
	{/if}

	<!-- Loading skeleton -->
	{#if loading}
		<div
			class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-blue-900/40 dark:bg-[#0f2a48]/88"
			aria-busy="true"
			aria-label="Generating answer"
		>
			<div class="border-b border-slate-100 px-4 py-3 dark:border-slate-700">
				<div class="h-4 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div>
			</div>
			<div class="space-y-3 px-4 py-4">
				<div class="h-3 w-full animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div>
				<div class="h-3 w-11/12 animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div>
				<div class="h-3 w-4/5 animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div>
				<div class="h-3 w-full animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div>
			</div>
		</div>
	{/if}

	<!-- Error -->
	{#if error}
		<div
			class="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200"
			role="alert"
		>
			<svg class="mt-0.5 h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
				/>
			</svg>
			<div>
				<p class="font-medium">Could not get an answer</p>
				<p class="mt-0.5 text-amber-800/90 dark:text-amber-200/90">{error}</p>
			</div>
		</div>
	{/if}

	<!-- Answer -->
	{#if answer && !loading}
		<article
			class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-blue-900/40 dark:bg-[#0f2a48]/88"
		>
			<div class="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-slate-700">
				<h3 class="text-sm font-semibold text-slate-900 dark:text-white">Answer</h3>
				<div class="flex flex-wrap items-center gap-1.5">
					<span
						class="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300"
						title="Answer generated by Workers AI from KV and schema context"
					>
						LLM
					</span>
					{#if answerKvContext}
						<span
							class="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-900 dark:bg-teal-900/40 dark:text-teal-200"
							title="KV warmed summary included in context"
						>
							KV context
						</span>
					{/if}
					{#if answerGrounded}
						<span
							class="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800 dark:bg-sky-900/40 dark:text-sky-300"
							title="Answer grounded in retrieved schema/docs context"
						>
							Grounded
						</span>
					{/if}
					{#if answerRelease}
						<span
							class="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:bg-violet-900/40 dark:text-violet-300"
						>
							{answerRelease}
						</span>
					{/if}
				</div>
			</div>
			<div class="px-4 py-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
				<SimpleMarkdown source={answer} className="crd-ask-answer" />
			</div>

			{#if sources.length > 0}
				<div class="border-t border-slate-100 dark:border-slate-700">
					<button
						type="button"
						on:click={() => (sourcesOpen = !sourcesOpen)}
						class="flex min-h-11 w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 transition-colors hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/50"
						aria-expanded={sourcesOpen}
					>
						<span>Sources ({sources.length})</span>
						<svg
							class="h-4 w-4 shrink-0 transition-transform {sourcesOpen ? 'rotate-180' : ''}"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
						</svg>
					</button>
					{#if sourcesOpen}
						<ul class="space-y-2 border-t border-slate-100 px-4 py-3 dark:border-slate-700">
							{#each sources as source}
								<li
									class="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900/40"
								>
									<p class="font-medium text-slate-800 dark:text-slate-200">{source.label}</p>
									<dl class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-slate-500 dark:text-slate-400">
										<div class="flex gap-1">
											<dt class="font-medium">Type</dt>
											<dd>{source.source === 'eda-docs' ? 'EDA docs' : 'CRD schema'}</dd>
										</div>
										{#if source.release}
											<div class="flex gap-1">
												<dt class="font-medium">Release</dt>
												<dd>{source.release}</dd>
											</div>
										{/if}
										{#if source.kind}
											<div class="flex gap-1">
												<dt class="font-medium">Kind</dt>
												<dd>{source.kind}</dd>
											</div>
										{/if}
										{#if source.section}
											<div class="flex gap-1">
												<dt class="font-medium">Section</dt>
												<dd>{source.section}</dd>
											</div>
										{/if}
										{#if source.path}
											<div class="flex w-full gap-1">
												<dt class="shrink-0 font-medium">Path</dt>
												<dd class="truncate font-mono">
													{#if source.source === 'eda-docs'}
														<a
															href={docsUrl(source.path)}
															target="_blank"
															rel="noopener noreferrer"
															class="text-blue-600 hover:underline dark:text-blue-400"
														>
															{source.path}
														</a>
													{:else if browserLink(source)}
														<a
															href={browserLink(source)}
															class="text-blue-600 hover:underline dark:text-blue-400"
														>
															Open in resource browser
														</a>
													{:else}
														{source.path}
													{/if}
												</dd>
											</div>
										{/if}
									</dl>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
		</article>
	{/if}
</div>
