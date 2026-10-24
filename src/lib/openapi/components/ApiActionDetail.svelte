<script lang="ts">
	import { copyToClipboard } from '$lib/copyToClipboard';
	import OpenApiMethodBadge from '$lib/openapi/components/OpenApiMethodBadge.svelte';
	import OpenApiSchemaTree from '$lib/openapi/components/OpenApiSchemaTree.svelte';
	import { curlForAction, type ApiAction, type ApiSection } from '$lib/openapi/apiReference';
	import {
		actionDescription,
		requestBodyExample,
		responseExample,
		sentence,
		type CodeExample
	} from '$lib/openapi/apiExamples';
	import type { OpenApiParameter } from '$lib/openapi/pathBrowser';

	interface Props {
		action: ApiAction;
		section: ApiSection;
		spec: Record<string, unknown>;
		darkMode?: boolean;
		crdHref?: string;
	}

	let { action, section, spec, darkMode = false, crdHref }: Props = $props();

	const op = $derived(action.operation);
	const description = $derived(actionDescription(action, section));
	const pathParams = $derived(op.parameters.filter((p) => p.in === 'path'));
	const queryParams = $derived(op.parameters.filter((p) => p.in === 'query'));
	const headerParams = $derived(op.parameters.filter((p) => p.in === 'header'));
	const isManifestBody = $derived(
		(section.type === 'resource' && (action.key === 'create' || action.key === 'replace')) ||
			(section.type === 'workflow' && action.key === 'run')
	);

	const blocks = $derived.by((): CodeExample[] => {
		const out: CodeExample[] = [{ label: 'Request', text: curlForAction(action, section) }];
		const body = requestBodyExample(section, action, spec);
		if (body) out.push(body);
		const response = responseExample(action, spec);
		if (response?.text) out.push(response);
		return out;
	});

	let copied = $state('');
	async function copy(block: CodeExample) {
		if (!(await copyToClipboard(block.text))) return;
		copied = block.label;
		setTimeout(() => (copied = ''), 1500);
	}

	/** Descriptions EDA leaves empty for the two parameters every resource path has. */
	function paramDescription(p: OpenApiParameter): string {
		if (p.description) return sentence(p.description);
		if (p.in === 'path' && p.name === 'namespace')
			return 'Namespace of the resource, for example eda.';
		if (p.in === 'path' && p.name === 'name') return `Name of the ${section.title}.`;
		return '';
	}

	function enumValues(p: OpenApiParameter): unknown[] {
		const values = (p.schema as { enum?: unknown[] } | undefined)?.enum;
		return Array.isArray(values) ? values : [];
	}

	function defaultValue(p: OpenApiParameter): string {
		const d = (p.schema as { default?: unknown } | undefined)?.default;
		return d === undefined ? '' : String(d);
	}

	function statusClass(status: string): string {
		return /^2/.test(status) ? 'ok' : /^[45]/.test(status) ? 'err' : 'other';
	}

	function pathParts(path: string): Array<{ text: string; param: boolean }> {
		return path
			.split(/(\{[^}]+\}|\/)/)
			.filter(Boolean)
			.map((text) => ({ text, param: text.startsWith('{') }));
	}
</script>

{#snippet paramList(title: string, params: OpenApiParameter[])}
	<section class="block">
		<h3>{title}</h3>
		<ul class="params">
			{#each params as p (p.in + p.name)}
				<li>
					<div class="param-head">
						<code class="param-name">{p.name}</code>
						<span class="param-type">{p.type || 'string'}</span>
						{#if p.required}<span class="param-req">required</span>{/if}
						{#if defaultValue(p)}<span class="param-default">default {defaultValue(p)}</span>{/if}
					</div>
					{#if paramDescription(p)}<p>{paramDescription(p)}</p>{/if}
					{#if enumValues(p).length}
						<p class="param-enum">
							One of {#each enumValues(p) as v, i (String(v))}{i ? ', ' : ''}<code>{String(v)}</code
								>{/each}
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/snippet}

<article class="detail" aria-labelledby="api-action-title">
	<header class="head">
		<h2 id="api-action-title">{action.title}</h2>
		<p class="endpoint">
			<OpenApiMethodBadge method={op.method} />
			<code
				>{#each pathParts(op.path) as part}{#if part.param}<em>{part.text}</em
						>{:else if part.text === '/'}/<wbr />{:else}{part.text}{/if}{/each}</code
			>
		</p>
	</header>

	<div class="cols">
		<div class="intro">
			<p class="lede">{description}</p>
			<p class="auth">
				{#if op.security.isPublic}
					<span class="auth-tag auth-tag--public">Public</span> No token needed
				{:else}
					<span class="auth-tag">Bearer token</span> Send <code>Authorization: Bearer $TOKEN</code>
				{/if}
				{#if op.deprecated}<span class="auth-tag auth-tag--deprecated">Deprecated</span>{/if}
			</p>
		</div>
		<div class="docs">
			{#if pathParams.length}{@render paramList('Path parameters', pathParams)}{/if}
			{#if queryParams.length}{@render paramList('Query parameters', queryParams)}{/if}
			{#if headerParams.length}{@render paramList('Headers', headerParams)}{/if}

			{#if op.requestBody}
				<section class="block">
					<h3>Request body</h3>
					<p class="body-line">
						<span class="param-type"
							>{op.requestBody.contentTypes.join(', ') || 'application/json'}</span
						>
						{#if op.requestBody.required}<span class="param-req">required</span>{/if}
					</p>
					{#if isManifestBody}
						<p>
							The {section.title} as JSON: <code>apiVersion</code>, <code>kind</code>,
							<code>metadata</code> and <code>spec</code>.
							{#if crdHref}Every field is documented in the <a href={crdHref}>CRD schema</a>.{/if}
						</p>
					{:else}
						{#if op.requestBody.description}<p>{sentence(op.requestBody.description)}</p>{/if}
						{#if op.requestBody.content[0]?.schema}
							<details class="fields">
								<summary>Body fields</summary>
								<OpenApiSchemaTree
									{spec}
									schema={op.requestBody.content[0].schema}
									schemaRef={op.requestBody.content[0].schemaRef}
									title={op.requestBody.content[0].schemaRef ?? 'Body'}
									{darkMode}
								/>
							</details>
						{/if}
					{/if}
				</section>
			{/if}

			<section class="block">
				<h3>Responses</h3>
				<ul class="responses">
					{#each op.responses as r (r.status)}
						<li>
							<span class="status status--{statusClass(r.status)}">{r.status}</span>
							<span>{r.description ? sentence(r.description) : ''}</span>
						</li>
					{/each}
				</ul>
			</section>
		</div>

		<div class="rail" aria-label="Examples">
			{#each blocks as block (block.label)}
				<section class="code">
					<header>
						<span class="code-label">{block.label}</span>
						{#if block.file}<span class="code-file">{block.file}</span>{/if}
						<button
							type="button"
							onclick={() => copy(block)}
							aria-label="Copy {block.label.toLowerCase()}"
						>
							{copied === block.label ? 'Copied' : 'Copy'}
						</button>
					</header>
					<!-- Scrollable code must be reachable by keyboard (WCAG 2.1.1). -->
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<pre
						tabindex="0"
						class:tall={block.label.startsWith('Response')}
						aria-label="{block.label} example"><code
							>{#each block.text.split(/(?<=\/)/) as chunk, i (i)}{chunk}<wbr />{/each}</code
						></pre>
				</section>
			{/each}
		</div>
	</div>
</article>

<style>
	.detail {
		container-type: inline-size;
		min-width: 0;
		font-family: var(--rb-font);
		color: var(--rb-ink);
	}

	.head {
		display: grid;
		gap: 0.5rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--rb-line);
	}

	.head h2 {
		margin: 0;
		font: 700 1.25rem/1.25 var(--rb-font-display);
		letter-spacing: -0.01em;
	}

	.endpoint {
		display: flex;
		align-items: flex-start;
		gap: 0.625rem;
		margin: 0;
	}

	.endpoint code {
		font: 500 0.85rem/1.55 var(--rb-font-mono);
		color: var(--rb-ink);
		overflow-wrap: anywhere;
	}

	.endpoint em {
		font-style: normal;
		color: var(--rb-code);
	}

	/* Narrow: description, then the code, then the reference. Wide: reference beside the code
	   (Stripe-style), the code rail sticky. */
	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas: 'intro' 'rail' 'docs';
		gap: 1.25rem;
		padding-top: 1rem;
	}

	.intro {
		grid-area: intro;
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}

	.docs {
		grid-area: docs;
	}

	.rail {
		grid-area: rail;
	}

	@container (min-width: 50rem) {
		.cols {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
			grid-template-areas: 'intro rail' 'docs rail';
			grid-template-rows: auto 1fr;
			column-gap: 1.75rem;
		}

		.rail {
			position: sticky;
			top: 4.75rem;
			align-self: start;
		}
	}

	.docs {
		min-width: 0;
		display: grid;
		gap: 1.25rem;
		align-content: start;
	}

	.lede {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.6;
		color: var(--rb-ink-2);
	}

	.auth {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem 0.5rem;
		margin: 0;
		font-size: 0.85rem;
		color: var(--rb-ink-3);
	}

	.auth code,
	.block code {
		font: 0.8em var(--rb-font-mono);
		color: var(--rb-ink);
	}

	.auth-tag {
		padding: 0.125rem 0.4375rem;
		border-radius: 0.25rem;
		background: var(--oa-method-put-bg);
		color: var(--oa-method-put);
		font: 600 0.7rem var(--rb-font-mono);
	}

	.auth-tag--public {
		background: var(--rb-ok-soft);
		color: var(--rb-ok);
	}

	.auth-tag--deprecated {
		background: var(--rb-raised);
		color: var(--rb-removed);
	}

	.block h3 {
		margin: 0 0 0.375rem;
		padding-bottom: 0.375rem;
		border-bottom: 1px solid var(--rb-line);
		font: 700 0.7rem var(--rb-font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--rb-ink-3);
	}

	.block p {
		margin: 0.25rem 0 0;
		font-size: 0.86rem;
		line-height: 1.55;
		color: var(--rb-ink-2);
	}

	.block a {
		color: var(--rb-signal);
		font-weight: 600;
	}

	.params,
	.responses {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.params li {
		padding: 0.625rem 0;
		border-bottom: 1px solid var(--rb-line);
	}

	.params li:last-child {
		border-bottom: 0;
	}

	.param-head,
	.body-line {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.375rem 0.625rem;
	}

	.param-name {
		font: 600 0.84rem var(--rb-font-mono) !important;
		color: var(--rb-ink) !important;
	}

	.param-type {
		font: 0.75rem var(--rb-font-mono);
		color: var(--rb-code);
	}

	.param-req {
		font: 600 0.66rem var(--rb-font-mono);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--rb-removed);
	}

	.param-default {
		font: 0.72rem var(--rb-font-mono);
		color: var(--rb-ink-3);
	}

	.param-enum {
		font-size: 0.8rem !important;
		color: var(--rb-ink-3) !important;
	}

	.fields {
		margin-top: 0.5rem;
	}

	.fields summary {
		cursor: pointer;
		font-weight: 600;
		font-size: 0.85rem;
		color: var(--rb-signal);
	}

	.responses li {
		display: flex;
		align-items: baseline;
		gap: 0.625rem;
		padding: 0.4375rem 0;
		border-bottom: 1px solid var(--rb-line);
		font-size: 0.86rem;
		color: var(--rb-ink-2);
	}

	.responses li:last-child {
		border-bottom: 0;
	}

	.status {
		flex-shrink: 0;
		min-width: 4rem;
		font: 600 0.78rem var(--rb-font-mono);
	}

	.status--ok {
		color: var(--rb-ok);
	}
	.status--err {
		color: var(--rb-removed);
	}
	.status--other {
		color: var(--rb-ink-3);
	}

	/* Code rail: always dark, like a terminal. */
	.rail {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
		align-content: start;
	}

	.code {
		overflow: hidden;
		border-radius: 0.625rem;
		background: #0e1626;
		border: 1px solid #1f2b42;
	}

	.code header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.5rem 0.375rem 0.875rem;
		border-bottom: 1px solid #1f2b42;
		background: #121c30;
	}

	.code-label {
		font: 600 0.72rem var(--rb-font);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #aab8d0;
	}

	.code-file {
		font: 0.72rem var(--rb-font-mono);
		color: #7f8ea8;
	}

	.code button {
		margin-left: auto;
		height: 1.625rem;
		padding: 0 0.5625rem;
		border: 1px solid #2c3a55;
		border-radius: 0.375rem;
		background: transparent;
		color: #d7e2f4;
		font: 600 0.72rem var(--rb-font);
		cursor: pointer;
	}

	.code button:hover {
		background: #1b2740;
	}

	.code button:focus-visible,
	.code pre:focus-visible {
		outline: 2px solid #8fb4ff;
		outline-offset: -2px;
	}

	.code pre {
		margin: 0;
		padding: 0.75rem 0.875rem;
		max-height: 26rem;
		overflow: auto;
		color: #d7e2f4;
		font: 0.76rem/1.65 var(--rb-font-mono);
		/* Wrap at spaces and after "/" (see <wbr>), never mid-word. */
		white-space: pre-wrap;
		overflow-wrap: normal;
		scrollbar-width: thin;
		scrollbar-color: #2c3a55 transparent;
	}

	.code pre.tall {
		max-height: 20rem;
	}
</style>
