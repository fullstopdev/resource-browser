function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Lightweight markdown → HTML for Ask AI answers (headings, lists, code, links). */
export function renderSimpleMarkdown(text: string): string {
	if (!text.trim()) return '';

	const placeholders: string[] = [];
	const stash = (html: string) => {
		let resolved = html;
		for (let i = 0; i < placeholders.length; i++) {
			resolved = resolved.replaceAll(`@@MD${i}@@`, placeholders[i]);
		}
		const key = `@@MD${placeholders.length}@@`;
		placeholders.push(resolved);
		return key;
	};

	let s = escapeHtml(text);

	s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
		const label = lang ? `<span class="md-code-lang">${lang}</span>` : '';
		return stash(
			`<div class="md-code-wrap">${label}<pre class="md-code-block"><code>${code.trim()}</code></pre></div>`
		);
	});
	s = s.replace(/`([^`\n]+)`/g, (_, code) =>
		stash(`<code class="md-inline-code">${code}</code>`)
	);
	s = s.replace(/\*\*([^*]+)\*\*/g, '<strong class="md-strong">$1</strong>');
	s = s.replace(/\*([^*]+)\*/g, '<em class="md-em">$1</em>');
	s = s.replace(
		/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
		'<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>'
	);
	s = s.replace(/^#### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
	s = s.replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>');
	s = s.replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>');
	s = s.replace(/^(?:-|\*) (.+)$/gm, '<li class="md-li">$1</li>');
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
