import vercelAdapter from '@sveltejs/adapter-vercel';
import cloudflareAdapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { readdirSync } from 'node:fs';

/**
 * Static entries under a folder that also names a page (`/openapi`, `/release-notes`), listed one by
 * one: Cloudflare's `/openapi/*` would also match the `/openapi` page and serve a 404 for it.
 */
function staticEntries(folder) {
	return readdirSync(`static/${folder}`, { withFileTypes: true }).map((entry) =>
		entry.isDirectory() ? `/${folder}/${entry.name}/*` : `/${folder}/${entry.name}`
	);
}

const target = process.env.ADAPTER || '';
const adapter =
	target === 'vercel'
		? vercelAdapter()
		: cloudflareAdapter({
			fallback: 'plaintext',
			routes: {
				include: ['/*'],
				exclude: [
					'/_app/*',
					'/fonts/*',
					'/images/*',
					'/docs/images/*',
					'/releases/*',
					'/resources/*',
					...staticEntries('openapi'),
					...staticEntries('release-notes'),
					'/robots.txt',
					'/sitemap.xml'
				]
			},
			// Workers AI is remote-only; disable during vite build/prerender so CI/local builds
			// succeed without `wrangler login`. Use `npm run dev:ai` to test AI locally.
			platformProxy: {
				remoteBindings: false
			}
		});

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter,
		// Prerendered pages (docs, sitemap) build absolute canonical URLs from this origin;
		// keep the default in sync with scripts/generate-sitemap.mjs.
		prerender: {
			origin: (
				process.env.PUBLIC_SITE_URL ||
				process.env.SITE_URL ||
				'https://eda-resource-browser.pages.dev'
			).replace(/\/$/, '')
		}
	}
};

export default config;
