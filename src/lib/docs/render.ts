import { Marked, type Tokens } from 'marked';
import { docsHref } from './registry';

export type DocsTocEntry = { id: string; text: string; depth: 2 | 3 };

export type RenderedDocs = { html: string; toc: DocsTocEntry[] };

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function slugify(text: string): string {
	return (
		text
			.toLowerCase()
			.replace(/<[^>]+>/g, '')
			.replace(/&[a-z#0-9]+;/g, '')
			.replace(/[^a-z0-9\s-]/g, '')
			.trim()
			.replace(/\s+/g, '-') || 'section'
	);
}

/** `catalog.md`, `./catalog.md#x` → `/docs/catalog#x`; everything else is left alone. */
function rewriteDocsLink(href: string): string {
	const m = /^(?:\.\/)?([a-z0-9-]+)\.md(#.*)?$/.exec(href);
	return m ? `${docsHref(m[1])}${m[2] ?? ''}` : href;
}

const CALLOUT = /<blockquote>\s*<p>\[!(NOTE|TIP|WARNING)\]\s*/g;

/**
 * Render a docs page. Content is repo-authored, so the HTML is trusted; Mermaid sources are
 * still escaped and kept in `data-src` so the client can re-render them on theme changes.
 */
export function renderDocs(markdown: string): RenderedDocs {
	const toc: DocsTocEntry[] = [];
	const usedIds = new Map<string, number>();

	const marked = new Marked({ gfm: true });
	marked.use({
		renderer: {
			code({ text, lang }: Tokens.Code) {
				if (lang === 'mermaid') {
					const src = escapeHtml(text);
					return `<pre class="mermaid" data-src="${src}">${src}</pre>\n`;
				}
				const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
				return `<pre class="docs-code"><code${cls}>${escapeHtml(text)}</code></pre>\n`;
			},
			heading({ tokens, depth }: Tokens.Heading) {
				const inner = this.parser.parseInline(tokens);
				const base = slugify(inner);
				const seen = usedIds.get(base) ?? 0;
				usedIds.set(base, seen + 1);
				const id = seen ? `${base}-${seen}` : base;
				if (depth === 2 || depth === 3) {
					toc.push({ id, text: inner.replace(/<[^>]+>/g, ''), depth });
				}
				return `<h${depth} id="${id}"><a class="docs-anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${inner}</h${depth}>\n`;
			},
			link({ href, title, tokens }: Tokens.Link) {
				const target = rewriteDocsLink(href);
				const external = /^https?:\/\//.test(target);
				const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
				const rel = external ? ' target="_blank" rel="noopener noreferrer"' : '';
				return `<a href="${escapeHtml(target)}"${titleAttr}${rel}>${this.parser.parseInline(tokens)}</a>`;
			}
		}
	});

	const html = (marked.parse(markdown, { async: false }) as string)
		.replace(
			CALLOUT,
			(_, kind: string) =>
				`<blockquote class="docs-callout docs-callout-${kind.toLowerCase()}"><p><strong class="docs-callout-label">${kind[0]}${kind.slice(1).toLowerCase()}</strong> `
		)
		.replace(/<table>/g, '<div class="docs-table-wrap"><table>')
		.replace(/<\/table>/g, '</table></div>');

	return { html, toc };
}
