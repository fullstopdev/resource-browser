let adapter;
const target = process.env.ADAPTER || '';
if (target === 'vercel') {
	adapter = require('@sveltejs/adapter-vercel').default();
} else {
	adapter = require('@sveltejs/adapter-cloudflare').default({
		fallback: 'plaintext',
		routes: {
			include: ['/*'],
			exclude: ['/_app/*', '/fonts/*', '/images/*', '/releases/*']
		}
	});
}
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter
  }
};

export default config;
