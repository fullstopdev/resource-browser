function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function parseTableRow(line: string): string[] {
	return line
		.trim()
		.replace(/^\|/, '')
		.replace(/\|$/, '')
		.split('|')
		.map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
	return /^\|?[\s:|-]+\|?$/.test(line.trim());
}

function renderMarkdownTable(block: string, stash: (html: string) => string): string {
	const lines = block.trim().split('\n').filter(Boolean);
	if (lines.length < 2 || !isTableSeparator(lines[1])) return block;

	const headers = parseTableRow(lines[0]);
	const rows = lines.slice(2).map(parseTableRow);
	const headHtml = headers
		.map((cell) => `<th class="md-th">${escapeHtml(cell)}</th>`)
		.join('');
	const bodyHtml = rows
		.map(
			(row) =>
				`<tr class="md-tr">${row
					.map((cell) => `<td class="md-td">${escapeHtml(cell)}</td>`)
					.join('')}</tr>`
		)
		.join('');

	return stash(
		`<div class="md-table-wrap"><table class="md-table"><thead><tr class="md-tr">${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`
	);
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

	let raw = text.replace(/(?:^\|.+\|\s*$\n?)+/gm, (block) => {
		if (!block.includes('\n')) return block;
		const rendered = renderMarkdownTable(block, stash);
		return rendered === block ? block : rendered;
	});

	let s = escapeHtml(raw);

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
	s = s.replace(
		/\[([^\]]+)\]\((\/[^)\s]+)\)/g,
		'<a href="$2" class="md-link md-link-internal">$1</a>'
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
			if (/^<div class="md-table-wrap"/.test(trimmed)) return trimmed;
			return `<p class="md-p">${trimmed.replace(/\n/g, '<br />')}</p>`;
		})
		.filter(Boolean)
		.join('');

	placeholders.forEach((html, i) => {
		s = s.replaceAll(`@@MD${i}@@`, html);
	});

	return s;
}
