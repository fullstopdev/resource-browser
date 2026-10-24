import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Hermetic: no external requests (fonts can hang behind proxies) and no real AI calls.
test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => route.abort());
	await page.route('**/api/ai', (route) =>
		route.fulfill({ status: 503, json: { error: 'AI disabled in tests' } })
	);
});

const PAGES: Array<[string, string, string, ('light' | 'dark')?]> = [
	['homepage', '/', 'main'],
	['homepage (dark)', '/', 'main', 'dark'],
	['catalog', '/?release=26.8.2', 'main'],
	['CRD page', '/?crd=bridgedomains.services.eda.nokia.com', 'main'],
	['Validate YAML', '/validate-yaml', '.monaco-editor'],
	['docs', '/docs', 'h1'],
	['docs (dark)', '/docs', 'h1', 'dark'],
	['API overview', '/openapi?release=26.8.2', '.tile'],
	['API category', '/openapi?release=26.8.2&category=routing', 'table'],
	['API category (dark)', '/openapi?release=26.8.2&category=services', 'table', 'dark'],
	[
		'API resource',
		'/openapi?release=26.8.2&spec=services.eda.nokia.com/v2&section=bridgedomains',
		'#api-action-panel'
	],
	[
		'API resource (dark)',
		'/openapi?release=26.8.2&spec=core#queryGetEqlQuery',
		'#api-action-panel',
		'dark'
	],
	['Compare APIs', '/openapi-comparison?sr=26.4.3&tr=26.8.1', '.cmp-tile'],
	['release notes', '/release-notes', 'h1']
];

for (const [name, path, ready, theme] of PAGES) {
	test(`${name} has no serious accessibility violations`, async ({ page }) => {
		if (theme) await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
		await page.goto(path);
		await expect(page.locator(ready).first()).toBeVisible({ timeout: 30_000 });
		await page.waitForLoadState('networkidle');
		const results = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
			// Monaco's own DOM (hidden textarea, view lines) is outside this app's control.
			.exclude('.monaco-editor')
			.analyze();
		const serious = results.violations.filter(
			(v) => v.impact === 'serious' || v.impact === 'critical'
		);
		const report = serious.map(
			(v) =>
				`${v.id} (${v.impact}): ${v.help}\n${v.nodes
					.slice(0, 4)
					.map(
						(n) =>
							`  ${n.target.join(' ')} — ${(n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 160)}`
					)
					.join('\n')}`
		);
		expect(report, report.join('\n')).toEqual([]);
	});
}
