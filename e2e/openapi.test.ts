import { expect, test, type Page } from '@playwright/test';

// Hermetic: no external requests (fonts can hang behind proxies).
test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => route.abort());
});

const SERVICES = '/openapi?release=26.8.2&spec=services.eda.nokia.com/v2';

async function openBridgeDomain(page: Page) {
	await page.goto(`${SERVICES}&section=bridgedomains`);
	await expect(page.getByRole('heading', { level: 1, name: 'BridgeDomain' })).toBeVisible({
		timeout: 15_000
	});
}

test.describe('API reference', () => {
	test('opens on the overview with category tiles and every API', async ({ page }) => {
		await page.goto('/openapi');
		await expect(page.getByRole('heading', { level: 1 })).toContainText(/EDA REST API\s*26\.8\.2/, {
			timeout: 15_000
		});
		const tiles = page.locator('.tile');
		await expect(tiles).toHaveCount(9);
		await expect(tiles.filter({ hasText: 'Routing and protocols' })).toContainText('7 APIs');
		// Every API by name, including the API server and Core.
		const az = page.locator('.az');
		await expect(az.getByRole('link')).toHaveCount(56);
		await expect(az).toContainText('API Server');
		await expect(az).toContainText('Core');
		await expect(
			page.getByRole('button', { name: /^26\.8\.2 Latest, EDA release$/ })
		).toBeVisible();
	});

	test('the overview search opens a resource', async ({ page }) => {
		await page.goto('/openapi?release=26.8.2');
		const search = page.getByRole('combobox', { name: 'Search resources and APIs' });
		await search.fill('bgppeer');
		await expect(page.getByRole('option').first()).toContainText('BGPPeer');
		await search.press('Enter');
		await expect(page).toHaveURL(/spec=protocols\.eda\.nokia\.com%2Fv2&section=bgppeers/);
	});

	test('a category lists its resources in a table', async ({ page }) => {
		await page.goto('/openapi?release=26.8.2');
		await page.locator('.tile', { hasText: 'Routing and protocols' }).click();
		await expect(page).toHaveURL(/category=routing/);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Routing and protocols');
		const row = page.getByRole('row', { name: /^BGPPeer Namespaced/ });
		await expect(row).toContainText(
			'/apps/protocols.eda.nokia.com/v2/namespaces/{namespace}/bgppeers'
		);
		await page.getByRole('button', { name: 'Workflows' }).click();
		await expect(page.getByRole('row', { name: /^BGPPeer/ })).toHaveCount(0);
		await expect(page.getByRole('row', { name: /^Ping\s*workflow/i })).toBeVisible();
		await page.getByRole('searchbox', { name: 'Filter Routing and protocols' }).fill('zzzz');
		await page.getByRole('button', { name: 'Clear the filter' }).click();
		await expect(page.getByRole('row', { name: /^BGPPeer Namespaced/ })).toBeVisible();
		// The sidebar opens the current category only.
		const nav = page.getByRole('navigation', { name: 'API reference' });
		await expect(nav.getByRole('link', { name: /^Routing and protocols/ })).toHaveAttribute(
			'aria-current',
			'page'
		);
		await expect(nav.getByRole('link', { name: /^Protocols 23$/ })).toBeVisible();
		await expect(nav.getByRole('link', { name: /^Services 12$/ })).toHaveCount(0);
	});

	test('a resource page links back to its category', async ({ page }) => {
		await page.goto('/openapi?release=26.8.2&spec=protocols.eda.nokia.com%2Fv2&section=bgppeers');
		const crumb = page.getByRole('navigation', { name: 'Breadcrumb' });
		await expect(crumb).toContainText('Routing and protocols');
		await crumb.getByRole('link', { name: 'Routing and protocols' }).click();
		await expect(page).toHaveURL(/category=routing/);
	});

	test('search finds a resource across APIs', async ({ page }) => {
		await page.goto('/openapi?release=26.8.2');
		await page.getByRole('combobox', { name: 'Find a resource or API' }).fill('bgppeer');
		await page.getByRole('option', { name: /^BGPPeer/ }).click();
		await expect(page).toHaveURL(/spec=protocols\.eda\.nokia\.com%2Fv2&section=bgppeers/);
		await expect(page.getByRole('heading', { level: 1, name: 'BGPPeer' })).toBeVisible({
			timeout: 15_000
		});
	});

	test('a resource lists its actions in plain words with a ready curl', async ({ page }) => {
		await openBridgeDomain(page);
		const actions = page.locator('.act .act-label');
		await expect(actions).toContainText([
			'List in namespace',
			'List in all namespaces',
			'Get',
			'Revision history'
		]);
		const panel = page.locator('#api-action-panel');
		await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Create a BridgeDomain');
		await expect(panel.locator('pre[aria-label="Request example"]')).toContainText('curl -X POST');
		await expect(panel.locator('pre[aria-label="Request example"]')).toContainText(
			'/apps/services.eda.nokia.com/v2/namespaces/eda/bridgedomains'
		);
		await expect(page.getByRole('link', { name: 'CRD schema' }).first()).toHaveAttribute(
			'href',
			/BridgeDomain/
		);
	});

	test('choosing an action updates the panel and the link', async ({ page }) => {
		await openBridgeDomain(page);
		await page.getByRole('button', { name: /^GET Get$/ }).click();
		await expect(page).toHaveURL(/#readServicesEdaNokiaComV2NamespaceBridgedomains$/);
		await expect(page.locator('#api-action-panel h2')).toHaveText('Get a BridgeDomain');
		await expect(page.locator('#api-action-panel pre[aria-label="Request example"]')).toContainText(
			'/bridgedomains/my-bridge-domain'
		);
	});

	test('arrow keys move between actions', async ({ page }) => {
		await openBridgeDomain(page);
		const rows = page.locator('.act');
		await rows.first().focus();
		await page.keyboard.press('ArrowDown');
		await expect(rows.nth(1)).toBeFocused();
	});

	test('old #operationId links open the matching action', async ({ page }) => {
		await page.goto('/openapi?release=26.8.2&spec=core#queryGetEqlQuery');
		await expect(page.getByRole('heading', { level: 1, name: 'Query (EQL & NQL)' })).toBeVisible({
			timeout: 15_000
		});
		await expect(page.locator('#api-action-panel')).toContainText('/core/query/v1/eql');
		await expect(page.locator('#api-action-panel pre[aria-label="Request example"]')).toContainText(
			'query=$QUERY'
		);
	});

	test('old schema graph links still open the API', async ({ page }) => {
		await page.goto('/openapi?release=26.8.2&spec=core&tab=schemaGraph&schema=AccessQuery');
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText('Schema graph')).toHaveCount(0);
	});

	test('workflows offer Run, logs and terminate', async ({ page }) => {
		await page.goto('/openapi?release=26.8.2&spec=oam.eda.nokia.com/v1&section=pings');
		await expect(page.getByRole('heading', { level: 1, name: 'Ping' })).toBeVisible({
			timeout: 15_000
		});
		await expect(page.locator('#api-action-panel h2')).toHaveText('Run a Ping');
		await expect(page.locator('.act .act-label')).toContainText(['Logs']);
		await expect(page.locator('.act', { hasText: 'Terminate' })).toBeVisible();
	});

	test('"/" focuses the API search', async ({ page }) => {
		await openBridgeDomain(page);
		await page.locator('h1').click();
		await page.keyboard.press('/');
		await expect(page.getByRole('combobox', { name: 'Find a resource or API' })).toBeFocused();
		await expect(page.getByRole('dialog', { name: 'Jump to a CRD' })).toHaveCount(0);
	});

	test('the header release switcher keeps the resource', async ({ page }) => {
		await openBridgeDomain(page);
		await page.getByRole('button', { name: /EDA release$/ }).click();
		await page.getByRole('link', { name: /^26\.8\.1/ }).click();
		await expect(page).toHaveURL(/release=26\.8\.1.*section=bridgedomains/);
		await expect(page.getByRole('heading', { level: 1, name: 'BridgeDomain' })).toBeVisible({
			timeout: 15_000
		});
	});

	test('phone: the API list opens from a button', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await openBridgeDomain(page);
		await expect(page.locator('#api-nav')).toBeHidden();
		await page.getByRole('button', { name: 'Browse APIs and resources' }).click();
		await expect(page.getByRole('combobox', { name: 'Find a resource or API' })).toBeVisible();
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
