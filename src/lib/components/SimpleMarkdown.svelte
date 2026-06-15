<script lang="ts">
	import { renderSimpleMarkdown } from '$lib/markdown/renderSimpleMarkdown';

	export let source = '';
	/** Optional extra class on the root element (e.g. crd-ask-answer). */
	export let className = '';

	$: html = renderSimpleMarkdown(source);
</script>

<div class="simple-markdown {className}">{@html html}</div>

<style>
	:global(.simple-markdown .md-p) {
		margin: 0 0 0.75rem;
	}

	:global(.simple-markdown .md-p:last-child) {
		margin-bottom: 0;
	}

	:global(.simple-markdown .md-h2),
	:global(.simple-markdown .md-h3),
	:global(.simple-markdown .md-h4) {
		margin: 1rem 0 0.5rem;
		font-weight: 600;
		color: inherit;
	}

	:global(.simple-markdown .md-h2) {
		font-size: 1.05rem;
	}

	:global(.simple-markdown .md-h3) {
		font-size: 0.98rem;
	}

	:global(.simple-markdown .md-h4) {
		font-size: 0.92rem;
	}

	:global(.simple-markdown .md-ul) {
		margin: 0.5rem 0 0.75rem;
		padding-left: 1.25rem;
		list-style: disc;
	}

	:global(.simple-markdown .md-li) {
		margin: 0.25rem 0;
		padding-left: 0.15rem;
	}

	:global(.simple-markdown .md-li::marker) {
		color: rgb(100 116 139);
	}

	:global(.dark .simple-markdown .md-li::marker) {
		color: rgb(148 163 184);
	}

	:global(.simple-markdown .md-strong) {
		font-weight: 600;
		color: inherit;
	}

	:global(.simple-markdown .md-inline-code) {
		border-radius: 0.25rem;
		border: 1px solid rgb(226 232 240);
		background: rgb(241 245 249);
		padding: 0.1rem 0.35rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.85em;
	}

	:global(.simple-markdown .md-code-wrap) {
		position: relative;
		margin: 0.75rem 0;
	}

	:global(.simple-markdown .md-code-lang) {
		position: absolute;
		top: 0.5rem;
		right: 0.65rem;
		border-radius: 0.25rem;
		background: rgb(51 65 85 / 0.85);
		padding: 0.1rem 0.45rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.65rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: rgb(203 213 225);
	}

	:global(.simple-markdown .md-code-block) {
		overflow-x: auto;
		margin: 0;
		border-radius: 0.5rem;
		border: 1px solid rgb(30 41 59);
		background: rgb(15 23 42);
		padding: 0.85rem 1rem;
		color: rgb(226 232 240);
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.8rem;
		line-height: 1.55;
	}

	:global(.dark .simple-markdown .md-inline-code) {
		border-color: rgb(51 65 85);
		background: rgb(30 41 59);
	}

	:global(.dark .simple-markdown .md-code-block) {
		border-color: rgb(51 65 85 / 0.9);
		background: rgb(2 6 23 / 0.65);
	}

	:global(.simple-markdown .md-link) {
		color: rgb(37 99 235);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	:global(.dark .simple-markdown .md-link) {
		color: rgb(96 165 250);
	}

	:global(.simple-markdown.crd-ask-answer) {
		line-height: 1.65;
	}

	:global(.simple-markdown.crd-ask-answer > .md-p:first-child) {
		font-size: 1rem;
		color: rgb(30 41 59);
	}

	:global(.dark .simple-markdown.crd-ask-answer > .md-p:first-child) {
		color: rgb(241 245 249);
	}

	:global(.simple-markdown .md-table-wrap) {
		margin: 0.75rem 0 1rem;
		overflow-x: auto;
		border-radius: 0.5rem;
		border: 1px solid rgb(226 232 240);
	}

	:global(.dark .simple-markdown .md-table-wrap) {
		border-color: rgb(51 65 85);
	}

	:global(.simple-markdown .md-table) {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	:global(.simple-markdown .md-th),
	:global(.simple-markdown .md-td) {
		border-bottom: 1px solid rgb(226 232 240);
		padding: 0.5rem 0.75rem;
		text-align: left;
		vertical-align: top;
	}

	:global(.dark .simple-markdown .md-th),
	:global(.dark .simple-markdown .md-td) {
		border-bottom-color: rgb(51 65 85);
	}

	:global(.simple-markdown .md-th) {
		background: rgb(248 250 252);
		font-weight: 600;
		color: rgb(51 65 85);
	}

	:global(.dark .simple-markdown .md-th) {
		background: rgb(15 23 42 / 0.65);
		color: rgb(203 213 225);
	}

	:global(.simple-markdown .md-tr:last-child .md-td) {
		border-bottom: none;
	}
</style>
