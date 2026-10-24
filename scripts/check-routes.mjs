/**
 * Fails when a Cloudflare `_routes.json` exclude would also match a page route, which makes
 * Cloudflare serve that page as a (missing) static file: a 404. Run after the Cloudflare build.
 *
 *   node scripts/check-routes.mjs [.svelte-kit/cloudflare/_routes.json]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const routesFile = process.argv[2] ?? '.svelte-kit/cloudflare/_routes.json';
if (!existsSync(routesFile)) {
	console.log(`check-routes: no ${routesFile} (not a Cloudflare build), skipped`);
	process.exit(0);
}
const { exclude = [] } = JSON.parse(readFileSync(routesFile, 'utf8'));

/** Top-level page routes: folders in src/routes that aren't groups, params or API routes. */
const pages = readdirSync('src/routes', { withFileTypes: true })
	.filter((e) => e.isDirectory() && !/^[([]/.test(e.name) && e.name !== 'api')
	.map((e) => `/${e.name}`);

/** Cloudflare semantics: `*` matches anything, including nothing, so `/a/*` matches `/a`. */
const toRegExp = (pattern) =>
	new RegExp(
		'^' +
			pattern
				.split('*')
				.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
				.join('.*')
				.replace(/\/\.\*$/, '(/.*)?') +
			'$'
	);

const conflicts = [];
for (const pattern of exclude) {
	const re = toRegExp(pattern);
	for (const page of pages) if (re.test(page)) conflicts.push(`${pattern} hides the ${page} page`);
}
if (conflicts.length) {
	console.error(`_routes.json excludes hide pages:\n  ${conflicts.join('\n  ')}`);
	process.exit(1);
}
console.log(`check-routes: ${exclude.length} excludes, ${pages.length} pages, no conflicts`);
