import { expect, test } from '@playwright/test';

// Hermetic: no external requests (fonts can hang behind proxies) and no real AI calls.
test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => route.abort());
	await page.route('**/api/ai', (route) =>
		route.fulfill({ status: 503, json: { error: 'AI disabled in tests' } })
	);
});

test('homepage shows search, releases by major and grouped tools', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toContainText(
		'Every Nokia EDA resource schema'
	);
	await expect(page.locator('.rb-eyebrow')).toContainText(/\d{3} CRDs/);
	// Four releases per major version, newest on the left.
	const v26 = page.getByRole('list', { name: 'EDA 26 releases, newest first' }).getByRole('button');
	await expect(v26).toHaveCount(4);
	await expect(v26.first()).toContainText('26.8.2');
	await expect(v26.nth(1)).toContainText('26.8.1');
	const v25 = page.getByRole('list', { name: 'EDA 25 releases, newest first' }).getByRole('button');
	await expect(v25).toHaveCount(4);
	await expect(v25.first()).toContainText('25.12.3');
	await expect(page.locator('.rb-panel-note')).toContainText(/new, .* changed, .* removed/);
	await expect(page.locator('.rb-tool')).toHaveCount(8);
	await expect(page.getByRole('heading', { name: 'Check and compare' })).toBeVisible();
});

test('older releases of each major are in its More menu', async ({ page }) => {
	await page.goto('/');
	const more = page.getByRole('button', { name: /More EDA 25 releases/ });
	await more.click();
	const menu = page.locator('#rb-more-25');
	await expect(menu).toContainText('25.4.2');
	await expect(menu).not.toContainText('25.12.3');
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	await expect(more).toBeFocused();
	await page.getByRole('button', { name: /More EDA 26 releases/ }).click();
	await page
		.locator('#rb-more-26')
		.getByRole('button', { name: /^26\.4\.1/ })
		.click();
	await expect(page).toHaveURL(/release=26\.4\.1/);
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

test('catalog groups CRDs by API group and searches them all', async ({ page }) => {
	await page.goto('/?release=26.8.2');
	const side = page.getByRole('complementary', { name: 'API groups' });
	await expect(side.getByRole('button', { name: /^protocols\s*\d+$/ })).toBeVisible({
		timeout: 15_000
	});
	await side.getByRole('button', { name: /^protocols\s*\d+$/ }).click();
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Protocols');
	await expect(page.getByRole('button', { name: 'BGPPeer', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'AccountingPolicy', exact: true })).toHaveCount(0);
	// The search covers every group, not only the selected one.
	await page.getByRole('searchbox', { name: 'Search all CRDs' }).fill('accountingpolicy');
	await expect(page.getByRole('button', { name: 'AccountingPolicy', exact: true })).toBeVisible();
	await expect(page.locator('.status')).toContainText('searching all API groups');
	await page.getByRole('button', { name: 'AccountingPolicy', exact: true }).click();
	await expect(page).toHaveURL(/crd=AccountingPolicy/);
});

test('catalog shows CRDs listed without versions or a group', async ({ page }) => {
	await page.goto('/?release=25.12.1');
	const side = page.getByRole('complementary', { name: 'API groups' });
	await side.getByRole('button', { name: /^other\s*\d+$/ }).click({ timeout: 15_000 });
	await expect(page.getByRole('heading', { level: 1 })).toContainText('No API group');
	await expect(page.getByRole('button', { name: 'Resource', exact: true })).toBeVisible();
	await expect(page.locator('.none')).toContainText('no versions');
});
