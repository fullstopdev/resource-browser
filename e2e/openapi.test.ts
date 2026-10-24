import { expect, test, type Page } from '@playwright/test';

// Hermetic: no external requests (fonts can hang behind proxies).
test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => route.abort());
});

const CORE = '/openapi?release=26.8.2&spec=core';

async function openCore(page: Page, suffix = '') {
	await page.goto(`${CORE}${suffix}`);
	await expect(page.getByRole('heading', { level: 1 })).toContainText('API Server', {
		timeout: 15_000
	});
	await expect(page.locator('.oa-op').first()).toBeVisible({ timeout: 15_000 });
}

test.describe('API Explorer', () => {
	test('defaults to the latest release and the core API', async ({ page }) => {
		await page.goto('/openapi');
		await expect(page).toHaveURL(/release=26\.8\.2/);
		await expect(page).toHaveURL(/spec=core/);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('API Server', {
			timeout: 15_000
		});
		await expect(
			page.getByRole('button', { name: /^26\.8\.2 Latest, EDA release$/ })
		).toBeVisible();
	});

	test('lists endpoints by tag, expanded, with method badges', async ({ page }) => {
		await openCore(page);
		const query = page.locator('[data-tag="coreQuery"]');
		await expect(query.locator('.oa-op')).toHaveCount(7);
		await expect(query).toContainText('/core/query/v1/eql');
		await expect(page.locator('.oa-tags a', { hasText: 'Core Query' })).toBeVisible();
	});

	test('filter and method toggles narrow the list', async ({ page }) => {
		await openCore(page);
		await page.locator('#openapi-path-search').fill('queryGetEqlQueryAutoComplete');
		await expect(page.locator('.oa-list__count')).toHaveText(/^1 of \d+ endpoints$/);
		await expect(page.locator('.oa-op')).toContainText('/core/query/v1/eql/autocomplete');
		await page.locator('#openapi-path-search').fill('');
		await page.getByRole('button', { name: /^GET \d+/ }).click();
		await expect(page.locator('.oa-op .openapi-method-badge--get')).toHaveCount(0);
		await page.getByRole('button', { name: 'Clear filters' }).first().click();
		await expect(page.locator('.oa-list__count')).toHaveText(/^\d+ endpoints$/);
	});

	test('"/" focuses the endpoint filter instead of the CRD jump', async ({ page }) => {
		await openCore(page);
		await page.locator('h1').click();
		await page.keyboard.press('/');
		await expect(page.locator('#openapi-path-search')).toBeFocused();
		await expect(page.getByRole('dialog', { name: 'Jump to a CRD' })).toHaveCount(0);
	});

	test('keyboard opens an endpoint in the side panel and Escape returns focus', async ({
		page
	}) => {
		await openCore(page);
		await page.locator('.oa-op').first().focus();
		await page.keyboard.press('ArrowDown');
		const second = page.locator('.oa-op').nth(1);
		await expect(second).toBeFocused();
		await page.keyboard.press('Enter');
		const detail = page.locator('#oa-detail');
		await expect(detail).toBeVisible();
		await expect(page).toHaveURL(/#\w/);
		await page.keyboard.press('Escape');
		await expect(detail).toHaveCount(0);
		await expect(second).toBeFocused();
	});

	test('deep link opens the endpoint with examples and copy actions', async ({ page }) => {
		await openCore(page, '#queryGetEqlQuery');
		const detail = page.locator('#oa-detail');
		await expect(detail.getByRole('heading', { level: 2 })).toContainText('/core/query/v1/eql');
		await expect(detail).toContainText('queryGetEqlQuery');
		await expect(detail.getByRole('button', { name: 'Copy curl' })).toBeVisible();
		await expect(detail.getByRole('tab', { name: 'JSON' })).toBeVisible({ timeout: 15_000 });
		// QueryResponse has no OpenAPI example — a synthesized payload still appears.
		await expect(detail.locator('.oa-repr__pre')).toContainText('"data"', { timeout: 5_000 });
	});

	test('the API picker switches to an app API', async ({ page }) => {
		await openCore(page);
		await page.locator('.oa-side .openapi-apps-dropdown__trigger').click();
		await page.locator('#openapi-apps-dropdown-filter').fill('AAA');
		await page.getByRole('option', { name: /AAA/ }).first().click();
		await expect(page).toHaveURL(/spec=aaa\.eda\.nokia\.com/);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('AAA', { timeout: 15_000 });
	});

	test('schema graph tab shows the API map', async ({ page }) => {
		await openCore(page);
		await page.getByRole('tab', { name: 'Schema graph' }).click();
		await expect(page).toHaveURL(/tab=schemaGraph/);
		await expect(page.locator('.oa-schema-graph')).toBeVisible({ timeout: 15_000 });
		await expect(page.getByLabel('Schema graph view mode')).toHaveValue('api-map');
		await expect(page.locator('.oa-schema-graph__flow')).toBeVisible({ timeout: 15_000 });
	});

	test('legacy schemas tab opens the schema graph', async ({ page }) => {
		await page.goto(`${CORE}&tab=schemas&schema=AccessQuery`);
		await expect(page).toHaveURL(/tab=schemaGraph/);
		await expect(page.getByRole('tab', { name: 'Schema graph' })).toHaveAttribute(
			'aria-selected',
			'true'
		);
	});

	test('header release switcher changes the OpenAPI release', async ({ page }) => {
		await openCore(page);
		await page.getByRole('button', { name: /EDA release$/ }).click();
		await page.getByRole('link', { name: /^26\.4\.3/ }).click();
		await expect(page).toHaveURL(/release=26\.4\.3/);
		await expect(page.locator('.oa-chip', { hasText: 'EDA 26.4.3' })).toBeVisible({
			timeout: 15_000
		});
	});

	test('phone: filters and tags open from a button', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await openCore(page);
		await expect(page.locator('.oa-side')).toBeHidden();
		await page.getByRole('button', { name: 'Filters and tags' }).click();
		await expect(page.locator('#openapi-path-search')).toBeVisible();
	});

	test('legacy /api-browser redirects to /openapi', async ({ page }) => {
		await page.goto('/api-browser?release=26.8.2&spec=core');
		await expect(page).toHaveURL(/\/openapi\?release=26\.8\.2&spec=core/);
	});
});

test.describe('Compare APIs', () => {
	test('waits for Compare when the URL has no releases', async ({ page }) => {
		await page.goto('/openapi-comparison');
		await expect(page.getByRole('heading', { level: 1, name: 'Compare APIs' })).toBeVisible();
		await expect(page.getByText('Pick two releases and press Compare')).toBeVisible();
	});

	test('shows summary tiles and changed APIs', async ({ page }) => {
		await page.goto('/openapi-comparison?sr=26.4.3&tr=26.8.1');
		const tiles = page.locator('.cmp-tile');
		await expect(tiles).toHaveCount(6, { timeout: 30_000 });
		await expect(tiles.filter({ hasText: 'APIs added' })).toContainText(/\d+/);
		await expect(page.locator('.comparison-crd-card').first()).toBeVisible();
		const toggle = page.getByRole('button', { name: /^Show changes in / }).first();
		await toggle.press('Enter');
		await expect(page.getByRole('button', { name: /^Hide changes in / }).first()).toBeVisible();
	});

	test('explains when two releases have no API changes', async ({ page }) => {
		await page.goto('/openapi-comparison?sr=26.8.1&tr=26.8.2');
		await expect(page.getByText('No API changes between 26.8.1 and 26.8.2')).toBeVisible({
			timeout: 30_000
		});
		await page.getByRole('button', { name: /Show the \d+ unchanged APIs/ }).click();
		await expect(page.locator('.comparison-crd-card').first()).toBeVisible();
	});
});
