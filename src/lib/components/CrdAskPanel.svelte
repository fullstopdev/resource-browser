<script lang="ts">
	import { askAI } from '$lib/ai/askAI';
	import { explainCRD, explainField, generateExample } from '$lib/ai/aiClient';
	import type { RagSource } from '$lib/ai/rag/chunkTypes';
	import { parseReleaseFromQuestion } from '$lib/globalAsk';
	import SimpleMarkdown from '$lib/components/SimpleMarkdown.svelte';

	export let kind = '';
	export let group = '';
	export let name = '';
	export let version = '';
	/** Default release for KV chip actions on CRD detail pages only. */
	export let kvRelease = '';
	/** When true, show CRD-specific starter chips (explain, example, required fields). */
	export let hasCrdContext = false;
	/** Hide duplicate header when embedded in GlobalAskPanel. */
	export let embedded = false;
	export let deprecated = false;
	export let spec: unknown = null;
	export let status: unknown = null;

	const CACHED_STARTERS = new Set(['What is this CRD for?', 'Example YAML?']);

	type StarterCategory = {
		id: 'explore' | 'examples' | 'compare';
		label: string;
		prompts: string[];
	};

	const crdStarterCategories: StarterCategory[] = [
		{
			id: 'explore',
			label: 'Explore',
			prompts: ['What is this CRD for?', 'Required fields?', 'Related resources?']
		},
		{
			id: 'examples',
			label: 'Examples',
			prompts: ['Example YAML?']
		}
	];

	const genericStarterCategories: StarterCategory[] = [
		{
			id: 'explore',
			label: 'Explore',
			prompts: ['What CRDs are available for workflows?', 'Explain Topology resource']
		},
		{
			id: 'examples',
			label: 'Examples',
			prompts: ['Example YAML for a Fabric']
		},
		{
			id: 'compare',
			label: 'Compare',
			prompts: ['What changed between 26.4.1 and 26.4.2?']
		}
	];

	$: activeCategories = hasCrdContext ? crdStarterCategories : genericStarterCategories;

	let question = '';
	let answer: string | null = null;
	let sources: RagSource[] = [];
	let error: string | null = null;
	let loading = false;
	let sourcesOpen = false;
	let hasAsked = false;
	let answerCached = false;

	$: resourceLabel = hasCrdContext && kind
		? `${kind} (${group}/${version || 'latest'})`
		: hasCrdContext && name
			? name
			: 'EDA CRDs and documentation';

	$: isQuotaError =
		!!error &&
		(/daily limit|quota|neuron|temporarily unavailable/i.test(error) ||
			error.includes('503'));

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
		answerCached = false;

		let result: { answer?: string; sources?: RagSource[]; error?: string; cached?: boolean };

		const questionRelease = parseReleaseFromQuestion(trimmed);

		if (hasCrdContext && kvRelease && kind && group && CACHED_STARTERS.has(trimmed)) {
			const actionResult =
				trimmed === 'What is this CRD for?'
					? await explainCRD(kvRelease, kind, group)
					: await generateExample(kvRelease, kind, group);
			result = actionResult.error
				? { error: actionResult.error }
				: { answer: actionResult.answer, cached: actionResult.cached };
		} else if (hasCrdContext && kvRelease && kind && group && trimmed === 'Required fields?') {
			const actionResult = await explainField(kvRelease, kind, 'spec', group);
			result = actionResult.error
				? { error: actionResult.error }
				: {
						answer: `**Required fields for ${kind}:**\n\n${actionResult.answer}`,
						cached: actionResult.cached
					};
		} else if (questionRelease) {
			result = await askAI({
				question: trimmed,
				release: questionRelease,
				version: version || undefined
			});
		} else {
			result = await askAI({ question: trimmed });
		}

		loading = false;

		if (result.error) {
			error = result.error;
		} else {
			answer = result.answer ?? null;
			sources = result.sources ?? [];
			answerCached = !!result.cached;
		}
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

<div class="ask-ai" class:ask-ai--embedded={embedded}>
	{#if !embedded}
		<header class="ask-ai__standalone-header">
			<div class="ask-ai__standalone-icon" aria-hidden="true">
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.75"
						d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
					/>
				</svg>
			</div>
			<div class="ask-ai__standalone-copy">
				<h2 class="ask-ai__standalone-title">Ask AI</h2>
				<p class="ask-ai__standalone-subtitle">
					Grounded answers about <strong>{resourceLabel}</strong> from CRD schemas, Nokia EDA docs,
					and Vectorize RAG.
				</p>
			</div>
		</header>
	{/if}

	<section class="ask-ai__prompts" aria-label="Suggested questions">
		<h3 class="ask-ai__section-label">Starter prompts</h3>
		<div class="ask-ai__categories">
			{#each activeCategories as category (category.id)}
				<div class="ask-ai__category">
					<div class="ask-ai__category-head">
						<span class="ask-ai__category-icon ask-ai__category-icon--{category.id}" aria-hidden="true">
							{#if category.id === 'explore'}
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
									/>
								</svg>
							{:else if category.id === 'examples'}
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
									/>
								</svg>
							{:else}
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
									/>
								</svg>
							{/if}
						</span>
						<span class="ask-ai__category-label">{category.label}</span>
					</div>
					<div class="ask-ai__chip-grid" role="group" aria-label="{category.label} prompts">
						{#each category.prompts as starter (starter)}
							<button
								type="button"
								class="ask-ai__chip"
								on:click={() => submit(starter)}
								disabled={loading}
							>
								<span class="ask-ai__chip-text">{starter}</span>
								{#if hasCrdContext && CACHED_STARTERS.has(starter)}
									<span class="ask-ai__chip-badge" title="Cached KV response when available">KV</span>
								{/if}
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</section>

	<section class="ask-ai__composer" aria-label="Question input">
		<label for="crd-ask-question" class="ask-ai__section-label">Your question</label>
		<div class="ask-ai__input-wrap">
			<textarea
				id="crd-ask-question"
				bind:value={question}
				on:keydown={handleKeydown}
				rows="3"
				placeholder="Ask about CRD fields, relationships, validation rules, or example manifests…"
				class="ask-ai__textarea"
				disabled={loading}
			></textarea>
			<button
				type="button"
				class="ask-ai__send"
				on:click={() => submit()}
				disabled={loading || !question.trim()}
				aria-label={loading ? 'Generating answer' : 'Send question'}
			>
				{#if loading}
					<span class="ask-ai__send-spinner" aria-hidden="true"></span>
					<span class="ask-ai__send-label">Thinking…</span>
				{:else}
					<svg class="ask-ai__send-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
					</svg>
					<span class="ask-ai__send-label">Ask</span>
				{/if}
			</button>
		</div>
	</section>

	<div class="ask-ai__results" aria-live="polite">
		{#if !hasAsked && !loading && !error}
			<div class="ask-ai__empty">
				<div class="ask-ai__empty-icon" aria-hidden="true">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
						/>
					</svg>
				</div>
				<p class="ask-ai__empty-title">Ready when you are</p>
				<p class="ask-ai__empty-hint">
					{#if hasCrdContext}
						Pick a starter prompt above or describe what you need to know about this CRD.
					{:else}
						Explore CRD schemas, EDA concepts, validation rules, or release differences. Mention a
						release version in your question to scope results.
					{/if}
				</p>
			</div>
		{/if}

		{#if loading}
			<div class="ask-ai__skeleton" aria-busy="true" aria-label="Generating answer">
				<div class="ask-ai__skeleton-head">
					<div class="ask-ai__skeleton-line ask-ai__skeleton-line--short"></div>
				</div>
				<div class="ask-ai__skeleton-body">
					<div class="ask-ai__skeleton-line"></div>
					<div class="ask-ai__skeleton-line ask-ai__skeleton-line--wide"></div>
					<div class="ask-ai__skeleton-line ask-ai__skeleton-line--medium"></div>
					<div class="ask-ai__skeleton-line ask-ai__skeleton-line--code"></div>
					<div class="ask-ai__skeleton-line"></div>
				</div>
			</div>
		{/if}

		{#if error}
			<div
				class="ask-ai__error"
				class:ask-ai__error--quota={isQuotaError}
				role="alert"
			>
				<div class="ask-ai__error-icon" aria-hidden="true">
					{#if isQuotaError}
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
					{:else}
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
							/>
						</svg>
					{/if}
				</div>
				<div class="ask-ai__error-copy">
					<p class="ask-ai__error-title">
						{isQuotaError ? 'AI quota reached' : 'Could not get an answer'}
					</p>
					<p class="ask-ai__error-message">{error}</p>
					{#if isQuotaError}
						<p class="ask-ai__error-hint">KV-cached starter prompts may still work on CRD pages.</p>
					{/if}
				</div>
			</div>
		{/if}

		{#if answer && !loading}
			<article class="ask-ai__answer">
				<div class="ask-ai__answer-head">
					<h3 class="ask-ai__answer-title">Answer</h3>
					{#if answerCached}
						<span class="ask-ai__cached-badge" title="Served from KV cache">
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
							</svg>
							Cached
						</span>
					{/if}
				</div>
				<div class="ask-ai__answer-body">
					<SimpleMarkdown source={answer} className="crd-ask-answer" />
				</div>

				{#if sources.length > 0}
					<div class="ask-ai__sources">
						<button
							type="button"
							class="ask-ai__sources-toggle"
							on:click={() => (sourcesOpen = !sourcesOpen)}
							aria-expanded={sourcesOpen}
						>
							<span class="ask-ai__sources-toggle-label">
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
									/>
								</svg>
								Sources
								<span class="ask-ai__sources-count">{sources.length}</span>
							</span>
							<svg
								class="ask-ai__sources-chevron"
								class:ask-ai__sources-chevron--open={sourcesOpen}
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
							</svg>
						</button>
						{#if sourcesOpen}
							<ul class="ask-ai__sources-list">
								{#each sources as source, i (i)}
									<li class="ask-ai__source-card">
										<p class="ask-ai__source-label">{source.label}</p>
										<dl class="ask-ai__source-meta">
											<div class="ask-ai__source-field">
												<dt>Type</dt>
												<dd>{source.source === 'eda-docs' ? 'EDA docs' : 'CRD schema'}</dd>
											</div>
											{#if source.release}
												<div class="ask-ai__source-field">
													<dt>Release</dt>
													<dd>{source.release}</dd>
												</div>
											{/if}
											{#if source.kind}
												<div class="ask-ai__source-field">
													<dt>Kind</dt>
													<dd>{source.kind}</dd>
												</div>
											{/if}
											{#if source.section}
												<div class="ask-ai__source-field">
													<dt>Section</dt>
													<dd>{source.section}</dd>
												</div>
											{/if}
											{#if source.path}
												<div class="ask-ai__source-field ask-ai__source-field--full">
													<dt>Path</dt>
													<dd>
														{#if source.source === 'eda-docs'}
															<a
																href={docsUrl(source.path)}
																target="_blank"
																rel="noopener noreferrer"
																class="ask-ai__source-link"
															>
																{source.path}
															</a>
														{:else}
															<code>{source.path}</code>
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
</div>
