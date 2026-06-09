/**
 * Crawl docs.eda.dev and embed Nokia EDA documentation into Cloudflare Vectorize.
 *
 * Prerequisites:
 *   1. Create index once:
 *      wrangler vectorize create eda-docs-v1 --dimensions=768 --metric=cosine \
 *        --metadata-index=source --metadata-index=release --metadata-index=section
 *   2. export CLOUDFLARE_API_TOKEN=...  (Workers AI + Vectorize permissions)
 *   3. export CLOUDFLARE_ACCOUNT_ID=...  (or rely on wrangler whoami)
 *
 * Usage:
 *   npm run embed:eda-docs
 *   npm run embed:eda-docs -- --release 26.4
 *   npm run embed:eda-docs -- --dry-run --max-pages 20
 *   npm run embed:eda-docs -- --force   # re-embed all chunks (ignore manifest)
 */
import { chunkDocText } from '../src/lib/ai/rag/chunkDocs';
import type { DocsChunk } from '../src/lib/ai/rag/chunkTypes';
import { embedAndUpsert } from './lib/vectorizeEmbed';
import { isWorkersAINeuronLimitError } from '../src/lib/ai/workersAIQuota';

const INDEX_NAME = 'eda-docs-v1';
const DOCS_ORIGIN = 'https://docs.eda.dev';
const USER_AGENT = 'eda-resource-browser/1.0 (embed-script; +https://eda-resource-browser.pages.dev)';
const FETCH_DELAY_MS = 400;
const DEFAULT_RELEASE = '26.4';

const SKIP_PATH_RE =
	/\/(search|assets|javascripts|stylesheets|fonts|images|_static|genindex|sitemap)\b|\.(png|jpe?g|gif|svg|css|js|woff2?|pdf|zip)$/i;

type CrawledPage = {
	path: string;
	title: string;
	section: string;
	text: string;
};

function parseArgs(): { release: string; dryRun: boolean; maxPages: number; force: boolean } {
	const args = process.argv.slice(2);
	let release = DEFAULT_RELEASE;
	let dryRun = false;
	let maxPages = 500;
	let force = false;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--release' && args[i + 1]) release = args[++i];
		if (args[i] === '--dry-run') dryRun = true;
		if (args[i] === '--max-pages' && args[i + 1]) maxPages = Number(args[++i]) || maxPages;
		if (args[i] === '--force') force = true;
	}
	return { release, dryRun, maxPages, force };
}

function normalizePath(pathname: string): string {
	let path = pathname;
	if (!path.startsWith('/')) path = `/${path}`;
	if (!path.endsWith('/')) path = `${path}/`;
	return path.replace(/\/{2,}/g, '/');
}

function releasePrefix(release: string): string {
	return normalizePath(`/${release}`);
}

function sectionFromPath(path: string, release: string): string {
	const prefix = releasePrefix(release);
	const rest = path.slice(prefix.length).replace(/^\/+|\/+$/g, '');
	return rest.split('/')[0] || 'overview';
}

function stripTags(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/\s+/g, ' ')
		.trim();
}

function decodeEntities(text: string): string {
	return text
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function htmlToMarkdownish(html: string): { title: string; text: string } {
	const titleMatch =
		html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	const title = titleMatch ? decodeEntities(stripTags(titleMatch[1])) : 'Untitled';

	const contentMatch =
		html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ??
		html.match(/class="[^"]*md-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ??
		html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);

	const raw = contentMatch?.[1] ?? html;
	const blocks: string[] = [];

	const headingRe = /<h([2-4])[^>]*>([\s\S]*?)<\/h\1>/gi;
	const paraRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
	const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
	const preRe = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;

	let m: RegExpExecArray | null;
	while ((m = headingRe.exec(raw))) {
		const level = Number(m[1]);
		const hashes = '#'.repeat(Math.min(level + 1, 4));
		blocks.push(`${hashes} ${decodeEntities(stripTags(m[2]))}`);
	}
	while ((m = paraRe.exec(raw))) {
		const line = decodeEntities(stripTags(m[1]));
		if (line.length > 40) blocks.push(line);
	}
	while ((m = liRe.exec(raw))) {
		const line = decodeEntities(stripTags(m[1]));
		if (line) blocks.push(`- ${line}`);
	}
	while ((m = preRe.exec(raw))) {
		const code = decodeEntities(stripTags(m[1]));
		if (code) blocks.push(`\`\`\`\n${code}\n\`\`\``);
	}

	const text = blocks.join('\n\n').trim();
	return { title, text: text || decodeEntities(stripTags(raw)).slice(0, 12_000) };
}

function pathFromLocation(release: string, location: string): string {
	const clean = location.split('#')[0].replace(/^\/+/, '');
	return normalizePath(`/${release}/${clean}`);
}

function extractLinks(html: string, basePath: string, release: string): string[] {
	const prefix = releasePrefix(release);
	const links = new Set<string>();
	const re = /href=["']([^"'#?]+)["']/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html))) {
		try {
			const href = m[1];
			if (href.startsWith('mailto:') || href.startsWith('javascript:')) continue;
			const url = new URL(href, `${DOCS_ORIGIN}${basePath}`);
			if (url.origin !== DOCS_ORIGIN) continue;
			let path = normalizePath(url.pathname);
			if (!path.startsWith(prefix)) {
				// MkDocs uses release-relative hrefs (e.g. "apps/") on docs.eda.dev.
				const relative = new URL(href, `${DOCS_ORIGIN}${prefix}`);
				if (relative.origin === DOCS_ORIGIN) {
					path = normalizePath(relative.pathname);
				}
			}
			if (!path.startsWith(prefix)) continue;
			if (SKIP_PATH_RE.test(path)) continue;
			links.add(path);
		} catch {
			/* ignore bad URLs */
		}
	}
	return [...links];
}

type SearchIndexDoc = { location: string; title: string; text: string };

async function loadPagesFromSearchIndex(release: string, maxPages: number): Promise<CrawledPage[]> {
	const url = `${DOCS_ORIGIN}/${release}/search/search_index.json`;
	const resp = await fetch(url, {
		headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
	});
	if (!resp.ok) {
		throw new Error(`Search index unavailable (${resp.status}) at ${url}`);
	}

	const data = (await resp.json()) as { docs?: SearchIndexDoc[] };
	const byPath = new Map<string, CrawledPage>();

	for (const doc of data.docs ?? []) {
		const location = doc.location?.trim() ?? '';
		if (!location) continue;

		const path = pathFromLocation(release, location);
		if (SKIP_PATH_RE.test(path)) continue;

		const text = decodeEntities(stripTags(doc.text ?? '')).trim();
		if (text.length < 80) continue;

		const existing = byPath.get(path);
		if (!existing || text.length > existing.text.length) {
			byPath.set(path, {
				path,
				title: doc.title?.trim() || 'Untitled',
				section: sectionFromPath(path, release),
				text
			});
		}
	}

	const pages = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
	if (maxPages > 0 && pages.length > maxPages) {
		return pages.slice(0, maxPages);
	}
	return pages;
}

async function fetchPage(path: string): Promise<string> {
	const url = `${DOCS_ORIGIN}${path}`;
	const resp = await fetch(url, {
		headers: {
			'User-Agent': USER_AGENT,
			Accept: 'text/html,application/xhtml+xml'
		}
	});
	if (!resp.ok) {
		throw new Error(`HTTP ${resp.status} for ${url}`);
	}
	return resp.text();
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** BFS HTML crawl fallback when search index is incomplete. */
async function crawlDocsHtml(release: string, maxPages: number): Promise<CrawledPage[]> {
	const prefix = releasePrefix(release);
	const seeds = [prefix, `${prefix}user-guide/`, `${prefix}apps/`];
	const queue = [...new Set(seeds.map(normalizePath))];
	const visited = new Set<string>();
	const pages: CrawledPage[] = [];

	while (queue.length > 0 && pages.length < maxPages) {
		const path = queue.shift()!;
		if (visited.has(path)) continue;
		visited.add(path);

		try {
			const html = await fetchPage(path);
			const { title, text } = htmlToMarkdownish(html);
			if (text.length > 80) {
				pages.push({
					path,
					title,
					section: sectionFromPath(path, release),
					text
				});
			}

			for (const link of extractLinks(html, path, release)) {
				if (!visited.has(link) && !queue.includes(link)) {
					queue.push(link);
				}
			}
		} catch (err) {
			console.warn(`  Skip ${path}:`, err instanceof Error ? err.message : err);
		}

		await sleep(FETCH_DELAY_MS);
		if (pages.length % 25 === 0 && pages.length > 0) {
			console.log(`  Crawled ${pages.length} pages (queue ${queue.length})`);
		}
	}

	return pages;
}

async function loadDocsPages(release: string, maxPages: number): Promise<CrawledPage[]> {
	try {
		const fromIndex = await loadPagesFromSearchIndex(release, maxPages);
		console.log(`  Loaded ${fromIndex.length} pages from search_index.json`);
		if (fromIndex.length > 0) return fromIndex;
	} catch (err) {
		console.warn(
			'  Search index failed, falling back to HTML crawl:',
			err instanceof Error ? err.message : err
		);
	}
	return crawlDocsHtml(release, maxPages);
}

function pagesToChunks(pages: CrawledPage[], release: string): DocsChunk[] {
	const all: DocsChunk[] = [];
	for (const page of pages) {
		const chunks = chunkDocText(page.text, {
			source: 'eda-docs',
			release,
			path: page.path,
			title: page.title,
			section: page.section
		});
		all.push(...chunks);
	}
	return all;
}

async function main(): Promise<void> {
	const { release, dryRun, maxPages, force } = parseArgs();
	console.log(`Loading ${DOCS_ORIGIN}/${release}/ (max ${maxPages} pages)...`);
	const pages = await loadDocsPages(release, maxPages);
	console.log(`Fetched ${pages.length} content pages`);

	const chunks = pagesToChunks(pages, release);
	console.log(`Total chunks: ${chunks.length}`);

	if (dryRun) {
		console.log('Dry run — sample pages:', pages.slice(0, 5).map((p) => p.path));
		console.log('Dry run — sample chunk ids:', chunks.slice(0, 5).map((c) => c.id));
		return;
	}

	if (!chunks.length) {
		console.log('No chunks to embed.');
		return;
	}

	console.log(`Embedding into ${INDEX_NAME}...`);
	const records = chunks.map((c) => ({
		id: c.id,
		text: c.text,
		metadata: {
			source: c.metadata.source,
			release: c.metadata.release,
			section: c.metadata.section,
			path: c.metadata.path,
			title: c.metadata.title,
			chunkType: c.metadata.chunkType
		}
	}));

	const { upserted, skipped, indexed, total } = await embedAndUpsert(INDEX_NAME, records, {
		force,
		onProgress: (indexedNow, totalChunks, upsertedThisRun) => {
			console.log(`  Progress ${indexedNow}/${totalChunks} (${upsertedThisRun} new this run)`);
		}
	});

	console.log(
		`Done — ${indexed}/${total} indexed in ${INDEX_NAME}` +
			(upserted > 0 ? ` (+${upserted} new this run)` : '') +
			(skipped > 0 ? `, ${skipped} skipped` : '')
	);
}

main().catch((error) => {
	if (isWorkersAINeuronLimitError(error)) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(2);
	}
	console.error(error);
	process.exit(1);
});
