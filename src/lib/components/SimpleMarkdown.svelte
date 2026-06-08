<script lang="ts">
	export let source = '';

	function escapeHtml(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function renderMarkdown(text: string): string {
		if (!text.trim()) return '';

		const placeholders: string[] = [];
		const stash = (html: string) => {
			const key = `@@MD${placeholders.length}@@`;
			placeholders.push(html);
			return key;
		};

		let s = escapeHtml(text);

		s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) =>
			stash(`<pre class="md-code-block"><code>${code.trim()}</code></pre>`)
		);
		s = s.replace(/`([^`\n]+)`/g, (_, code) =>
			stash(`<code class="md-inline-code">${code}</code>`)
		);
		s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
		s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
		s = s.replace(
			/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
			'<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>'
		);
		s = s.replace(/^#### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
		s = s.replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>');
		s = s.replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>');
		s = s.replace(/^- (.+)$/gm, '<li class="md-li">$1</li>');
		s = s.replace(/(<li class="md-li">[\s\S]*?<\/li>\n?)+/g, (block) =>
			stash(`<ul class="md-ul">${block}</ul>`)
		);

		s = s
			.split(/\n{2,}/)
			.map((block) => {
				const trimmed = block.trim();
				if (!trimmed) return '';
				if (/^@@MD\d+@@$/.test(trimmed)) return trimmed;
				if (/^<h[234]/.test(trimmed)) return trimmed;
				return `<p class="md-p">${trimmed.replace(/\n/g, '<br />')}</p>`;
			})
			.filter(Boolean)
			.join('');

		placeholders.forEach((html, i) => {
			s = s.replaceAll(`@@MD${i}@@`, html);
		});

		return s;
	}

	$: html = renderMarkdown(source);
</script>

<div class="simple-markdown">{@html html}</div>

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
		margin: 0.2rem 0;
	}

	:global(.simple-markdown .md-inline-code) {
		border-radius: 0.25rem;
		background: rgb(241 245 249);
		padding: 0.1rem 0.35rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.85em;
	}

	:global(.simple-markdown .md-code-block) {
		overflow-x: auto;
		margin: 0.75rem 0;
		border-radius: 0.5rem;
		background: rgb(15 23 42);
		padding: 0.75rem 1rem;
		color: rgb(226 232 240);
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.8rem;
		line-height: 1.5;
	}

	:global(.dark .simple-markdown .md-inline-code) {
		background: rgb(30 41 59);
	}

	:global(.simple-markdown .md-link) {
		color: rgb(37 99 235);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	:global(.dark .simple-markdown .md-link) {
		color: rgb(96 165 250);
	}
</style>
