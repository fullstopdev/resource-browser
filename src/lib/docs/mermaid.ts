import type { ThemeMode } from '$lib/theme';

type MermaidApi = typeof import('mermaid').default;

const DIAGRAM_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

let mermaidPromise: Promise<MermaidApi> | null = null;
let renderGeneration = 0;

function loadMermaid(): Promise<MermaidApi> {
	// Lazy chunk: only docs pages with diagrams pay for Mermaid.
	mermaidPromise ??= import('mermaid').then((m) => m.default);
	return mermaidPromise;
}

/**
 * Render every `<pre class="mermaid" data-src>` inside `root`. The source is restored from
 * `data-src` first so diagrams can be re-rendered when the theme changes.
 */
export async function renderMermaidIn(root: HTMLElement, mode: ThemeMode): Promise<void> {
	const nodes = Array.from(root.querySelectorAll<HTMLElement>('pre.mermaid[data-src]'));
	if (nodes.length === 0) return;

	const generation = ++renderGeneration;
	const mermaid = await loadMermaid();
	if (generation !== renderGeneration) return;

	for (const node of nodes) {
		node.textContent = node.dataset.src ?? '';
		node.removeAttribute('data-processed');
	}

	mermaid.initialize({
		startOnLoad: false,
		securityLevel: 'strict',
		theme: mode === 'dark' ? 'dark' : 'default',
		// A concrete stack (not `inherit`) so Mermaid measures labels with the font it draws.
		fontFamily: DIAGRAM_FONT
	});

	try {
		await mermaid.run({ nodes });
	} catch (err) {
		console.warn('Mermaid render failed', err);
	}
}
