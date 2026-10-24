import { expect, test } from '@playwright/test';

// Hermetic: no external requests (fonts can hang behind proxies) and no real AI calls.
test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => route.abort());
	await page.route('**/api/ai', (route) =>
		route.fulfill({ status: 503, json: { error: 'AI disabled in tests' } })
	);
});

test('homepage shows real counts, the schema example and release trains', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toContainText(
		'Every Nokia EDA resource schema'
	);
	await expect(page.locator('.rb-sub')).toContainText(
		/Browse\s+\d{3}\s+CRDs\s+across\s+\d+\s+API\s+groups/
	);
	const specimen = page.getByRole('complementary', { name: /Example schema: BridgeDomain/ });
	await expect(specimen).toContainText('macLearning.');
	await expect(specimen).toContainText('integer');
	await expect(page.locator('.rb-train')).toHaveCount(2);
	await expect(page.locator('.rb-rail-note')).toContainText(
		/added \d+, changed \d+ and removed \d+ CRDs/
	);
	await expect(page.locator('.rb-tool')).toHaveCount(8);
});

test('menus open with the keyboard and close with Escape', async ({ page }) => {
	await page.goto('/');
	const nav = page.getByRole('navigation', { name: 'Main' });
	const crds = nav.getByRole('button', { name: 'CRDs' });
	await crds.focus();
	await page.keyboard.press('ArrowDown');
	await expect(crds).toHaveAttribute('aria-expanded', 'true');
	await expect(nav.getByRole('link', { name: /Catalog/ })).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(nav.getByRole('link', { name: /Spec Search/ })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(crds).toHaveAttribute('aria-expanded', 'false');
	await expect(crds).toBeFocused();
});

test('release switcher changes the release in the URL', async ({ page }) => {
	await page.goto('/spec-search');
	await page.getByRole('button', { name: /^26\.8\.2 Latest, EDA release$/ }).click();
	await page.getByRole('link', { name: /^26\.4\.3/ }).click();
	await expect(page).toHaveURL(/\/spec-search\?release=26\.4\.3/);
	await expect(page.getByRole('button', { name: /^26\.4\.3, EDA release$/ })).toBeVisible();
});

test('"/" opens Jump to a CRD and Enter opens the CRD', async ({ page }) => {
	await page.goto('/docs');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	const input = page.getByRole('combobox', { name: 'CRD kind or group' });
	// The docs page is prerendered: `/` only works once the page script has started.
	await expect(async () => {
		await page.keyboard.press('/');
		await expect(input).toBeFocused({ timeout: 1_000 });
	}).toPass({ timeout: 15_000 });
	await input.fill('BridgeDomain');
	await expect(page.locator('.rb-jump-results')).toContainText('BridgeDomain');
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/[?&]crd=BridgeDomain/i);
});

test('phone menu opens the navigation sheet', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await page.getByRole('button', { name: 'Open menu' }).click();
	const sheet = page.locator('#rb-sheet');
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole('link', { name: 'Validate YAML' })).toBeVisible();
	await sheet.getByRole('link', { name: 'Docs' }).click();
	await expect(page).toHaveURL(/\/docs/);
});
