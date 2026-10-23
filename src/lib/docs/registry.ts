/** In-app documentation pages, authored as markdown under `./pages/<slug>.md`. */

export type DocsSection = 'Guide' | 'Developer';

export type DocsPage = {
	slug: string;
	title: string;
	description: string;
	section: DocsSection;
	order: number;
	/** Markdown body without the frontmatter block. */
	body: string;
};

export const DOCS_SECTIONS: DocsSection[] = ['Guide', 'Developer'];

/** Slug of the overview page served at `/docs`. */
export const DOCS_INDEX_SLUG = 'index';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseDocsPage(slug: string, raw: string): DocsPage {
	const match = FRONTMATTER.exec(raw);
	if (!match) throw new Error(`docs/${slug}.md is missing its frontmatter block`);

	const meta: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const sep = line.indexOf(':');
		if (sep === -1) continue;
		meta[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
	}

	const section = meta.section as DocsSection;
	if (!DOCS_SECTIONS.includes(section)) {
		throw new Error(`docs/${slug}.md has an invalid section: ${meta.section}`);
	}
	if (!meta.title || !meta.description) {
		throw new Error(`docs/${slug}.md needs a title and a description`);
	}

	return {
		slug,
		title: meta.title,
		description: meta.description,
		section,
		order: Number(meta.order ?? 100),
		body: raw.slice(match[0].length)
	};
}

const rawPages = import.meta.glob('./pages/*.md', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

export const docsPages: DocsPage[] = Object.entries(rawPages)
	.map(([path, raw]) => parseDocsPage(path.replace(/^.*\/(.+)\.md$/, '$1'), raw))
	.sort(
		(a, b) =>
			DOCS_SECTIONS.indexOf(a.section) - DOCS_SECTIONS.indexOf(b.section) ||
			a.order - b.order ||
			a.title.localeCompare(b.title)
	);

export function getDocsPage(slug: string): DocsPage | undefined {
	return docsPages.find((page) => page.slug === slug);
}

export function docsHref(slug: string): string {
	return slug === DOCS_INDEX_SLUG ? '/docs' : `/docs/${slug}`;
}

/** Sidebar entries grouped by section, in display order. */
export function docsNav(): { section: DocsSection; pages: Pick<DocsPage, 'slug' | 'title'>[] }[] {
	return DOCS_SECTIONS.map((section) => ({
		section,
		pages: docsPages
			.filter((page) => page.section === section)
			.map(({ slug, title }) => ({ slug, title }))
	}));
}
