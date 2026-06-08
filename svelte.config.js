import vercelAdapter from '@sveltejs/adapter-vercel';
import cloudflareAdapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const target = process.env.ADAPTER || '';
const adapter =
	target === 'vercel'
		? vercelAdapter()
		: cloudflareAdapter({
			fallback: 'plaintext',
			routes: {
				include: ['/*'],
				exclude: ['/_app/*', '/fonts/*', '/images/*', '/releases/*']
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
		adapter
	}
};

export default config;
