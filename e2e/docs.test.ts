import { expect, test } from '@playwright/test';
import { readdirSync } from 'node:fs';

const slugs = readdirSync('src/lib/docs/pages')
	.filter((f) => f.endsWith('.md'))
	.map((f) => f.slice(0, -3));
const paths = slugs.map((slug) => (slug === 'index' ? '/docs' : `/docs/${slug}`));

// Keep the suite hermetic: external requests (e.g. Google Fonts) can hang behind proxies and
// block the page `load` event.
test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => route.abort());
});

test('docs overview lists every page in the sidebar', async ({ page }) => {
	await page.setViewportSize({ width: 1400, height: 900 });
	await page.goto('/docs');
	await expect(page.locator('h1')).toContainText('documentation');
	const links = page.locator('aside[aria-label="Documentation"] a');
	await expect(links).toHaveCount(slugs.length);
});

for (const path of paths) {
	test(`${path} renders with its diagrams`, async ({ page }) => {
		const response = await page.goto(path);
		expect(response?.status()).toBe(200);
		await expect(page.locator('article.docs-content h1')).toBeVisible();
		await expect(page).toHaveTitle(/· Docs \| EDA Resource Browser$/);

		const diagrams = page.locator('pre.mermaid');
		const count = await diagrams.count();
		for (let i = 0; i < count; i++) {
			const diagram = diagrams.nth(i);
			await expect(diagram.locator('svg')).toBeVisible({ timeout: 15_000 });
			await expect(diagram).not.toContainText('Syntax error');
		}
	});
}

test('diagrams re-render when the theme changes', async ({ page }) => {
	await page.goto('/docs/validate-yaml');
	const first = page.locator('pre.mermaid').first();
	await expect(first.locator('svg')).toBeVisible({ timeout: 15_000 });
	const before = await first.innerHTML();
	await page.getByRole('button', { name: 'Toggle dark mode' }).first().click();
	await expect(first.locator('svg')).toBeVisible({ timeout: 15_000 });
	await expect.poll(() => first.innerHTML()).not.toBe(before);
});
