import { test, expect } from '@playwright/test';

test.describe('OpenAPI', () => {
	test('loads catalog and shows release selector', async ({ page }) => {
		await page.goto('/openapi');
		await expect(page.getByRole('heading', { name: 'Explorer' })).toBeVisible();
		await expect(page.getByLabel('Select API Server release')).toBeVisible();
		await expect(page.locator('#openapi-release')).toHaveValue('26.4.3');
		await expect(page).toHaveURL(/release=26\.4\.3/);
		await expect(page).toHaveURL(/spec=core/);
		await expect(page.locator('.openapi-viewer-panel__title')).toContainText('API Server', {
			timeout: 15000
		});
	});

	test('defaults to core API server spec with EQL paths', async ({ page }) => {
		await page.goto('/openapi?release=26.4.3');
		await expect(page).toHaveURL(/spec=core/);
		await expect(page.locator('.openapi-viewer-panel__title')).toContainText('API Server', {
			timeout: 15000
		});
		await expect(page.locator('.openapi-path-browser')).toBeVisible({ timeout: 15000 });
		await expect(page.getByText('/core/query/v1/eql').first()).toBeVisible({ timeout: 15000 });
	});

	test('loads spec when app selected', async ({ page }) => {
		await page.goto('/openapi?release=26.4.3&spec=core');
		await expect(page.locator('.openapi-viewer-panel__title')).toContainText('API Server');
		await expect(page.getByRole('tab', { name: 'Paths' })).toBeVisible();
		await expect(page.locator('.openapi-path-browser')).toBeVisible({ timeout: 15000 });

		const filterInput = page.getByLabel('Search paths');
		await filterInput.fill('queryGetEqlQuery');
		await page.waitForTimeout(300);
		await expect(page.getByText('/core/query/v1/eql').first()).toBeVisible({ timeout: 15000 });
		const visibleCount = await page.locator('.openapi-path-browser__item').count();
		expect(visibleCount).toBeGreaterThan(0);
		expect(visibleCount).toBeLessThan(20);

		await filterInput.fill('');
		await page.waitForTimeout(300);
		const itemCount = await page.locator('.openapi-path-browser__item').count();
		expect(itemCount).toBeGreaterThanOrEqual(110);
	});

	test('core application spec excludes API server query paths', async ({ page }) => {
		await page.goto('/openapi?release=26.4.3&spec=core.eda.nokia.com/v1');
		await expect(page.locator('.openapi-viewer-panel__title')).toContainText('Core Application');
		await expect(page.locator('.openapi-path-browser')).toBeVisible({ timeout: 15000 });
		await expect(page.getByText('/core/query/v1/eql')).toHaveCount(0);
	});

	test('legacy schemas tab redirects away from removed Schemas browser', async ({ page }) => {
		await page.goto('/openapi?release=26.4.3&spec=core&tab=schemas&schema=AccessQuery');
		await expect(page).toHaveURL(/tab=schemaGraph/);
		await expect(page.getByRole('tab', { name: 'Schema Graph' })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await expect(page.getByRole('tab', { name: 'Paths' })).toBeVisible();
		await expect(page.getByRole('tab', { name: /Schemas/ })).toHaveCount(0);
		await expect(page.locator('.oa-schema-graph')).toBeVisible({ timeout: 15000 });
	});

	test('schema graph tab shows API map by default', async ({ page }) => {
		await page.goto('/openapi?release=26.4.3&spec=core&tab=schemaGraph');
		await expect(page.getByRole('tab', { name: 'Schema Graph' })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await expect(page.locator('.oa-schema-graph')).toBeVisible({ timeout: 15000 });
		await expect(page.getByLabel('Schema graph view mode')).toHaveValue('api-map');
		await expect(page.getByLabel('Filter API map by tag')).toBeVisible({ timeout: 15000 });
		await expect(page.locator('.oa-schema-graph__flow')).toBeVisible({ timeout: 15000 });
	});

	test('schema graph can switch to Schema dependencies view', async ({ page }) => {
		await page.goto('/openapi?release=26.4.3&spec=core&tab=schemaGraph');
		await expect(page.locator('.oa-schema-graph')).toBeVisible({ timeout: 15000 });
		const viewMode = page.getByLabel('Schema graph view mode');
		await expect(viewMode).toHaveValue('api-map');
		await viewMode.selectOption('schema-deps');
		await expect(viewMode).toHaveValue('schema-deps');
		await expect(page.getByLabel('Root schema for dependency graph')).toBeVisible({
			timeout: 15000
		});
		await expect(page.locator('.oa-schema-graph__flow')).toBeVisible();
		await expect(page.locator('.svelte-flow__node').first()).toBeVisible({ timeout: 15000 });
		// Must stay on schema-deps (regression: load $effect used to snap back to api-map)
		await page.waitForTimeout(400);
		await expect(viewMode).toHaveValue('schema-deps');
	});

	test('loads spec for app APIs with version segment', async ({ page }) => {
		await page.goto('/openapi?release=26.4.3&spec=aaa.eda.nokia.com/v1');
		await expect(page.locator('.openapi-viewer-panel__title')).toContainText('AAA Application');
		await expect(page.locator('.openapi-path-browser')).toBeVisible({ timeout: 15000 });
		await expect(page.locator('.openapi-path-group__title').first()).toBeVisible();
	});

	test('deep link opens operation with rest.wiki-style representations', async ({ page }) => {
		await page.goto('/api-browser/26.4.3/core#queryGetEqlQuery');
		await expect(page).toHaveURL(/\/openapi\?release=26\.4\.3&spec=core#queryGetEqlQuery/);
		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15000 });
		await expect(page.locator('.oa-modal-path')).toContainText('/core/query/v1/eql', {
			timeout: 15000
		});
		await expect(page.locator('.oa-op-modal-header__id')).toContainText('queryGetEqlQuery');

		const dialog = page.getByRole('dialog');
		await expect(dialog.getByRole('tab', { name: 'JSON' })).toBeVisible({ timeout: 15000 });
		await expect(dialog.getByRole('tab', { name: 'YAML' })).toBeVisible();
		await expect(dialog.getByRole('tab', { name: 'Example' }).first()).toBeVisible();
		await expect(dialog.getByRole('tab', { name: 'Schema' }).first()).toBeVisible();

		// QueryResponse has no OpenAPI example — synthesized payload must still appear.
		await expect(dialog.locator('.oa-repr__pre')).toContainText('"data"', { timeout: 5000 });
		await dialog.getByRole('tab', { name: 'YAML' }).click();
		await expect(dialog.locator('.oa-repr__pre')).toContainText('data:');
		await dialog.getByRole('tab', { name: 'Schema' }).first().click();
		await expect(dialog.locator('.openapi-schema-tree').first()).toBeVisible({ timeout: 5000 });
	});

	test('comparison page loads without auto-running diff', async ({ page }) => {
		await page.goto('/openapi-comparison');
		await expect(page.getByRole('heading', { name: 'Comparison', exact: true })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'No report yet' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Comparison results' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Compare releases' })).toBeEnabled();
	});

	test('comparison page loads and validates release selection', async ({ page }) => {
		await page.goto('/openapi-comparison?sr=26.4.3&tr=26.4.3');
		await expect(page.getByRole('heading', { name: 'Comparison', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Compare releases' })).toBeDisabled();
		await expect(page.getByText('Source and target must differ')).toBeVisible();
	});

	test('comparison deep link auto-runs for distinct releases', async ({ page }) => {
		await page.goto('/openapi-comparison?sr=25.12.3&tr=26.4.3');
		await expect(page.getByRole('heading', { name: 'Comparison results' })).toBeVisible({
			timeout: 30000
		});
		await expect(page.getByText('Added', { exact: true }).first()).toBeVisible();
	});

	test('Explorer browse intro omits Compare releases CTA', async ({ page }) => {
		await page.goto('/openapi');
		await expect(
			page.getByText('Choose a release and app, then browse paths and the schema graph.')
		).toBeVisible();
		await expect(page.getByRole('link', { name: 'Compare releases' })).toHaveCount(0);
	});

	test('nav includes API Server flat links', async ({ page }) => {
		await page.goto('/openapi');
		const toolsNav = page.getByRole('navigation', { name: 'Application tools' });
		await expect(toolsNav.getByRole('link', { name: 'API Explorer' })).toBeVisible();
		await expect(toolsNav.getByRole('link', { name: 'API Comparison' })).toBeVisible();
	});

	test('legacy /api-browser redirects to /openapi', async ({ page }) => {
		await page.goto('/api-browser?release=26.4.3&spec=core');
		await expect(page).toHaveURL(/\/openapi\?release=26\.4\.3&spec=core/);
		await expect(page.getByRole('heading', { name: 'Explorer' })).toBeVisible();
	});
});
