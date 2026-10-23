import { expect, test, type Page } from '@playwright/test';

const DRAFT_KEY = 'validate-yaml:draft:v1';

const BAD_TOPONODE = `apiVersion: core.eda.nokia.com/v1
kind: TopoNode
metadata:
  name: leaf-01
  namespace: eda
spec:
  platform: 7220 IXR-D3L
  version: "24.10.1"
  nodeProfile: default-node-profile
  operatingSystem: SRL
`;

// Hermetic: no external requests (fonts can hang behind proxies) and no real AI calls.
test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => route.abort());
	await page.route('**/api/ai', (route) =>
		route.fulfill({ status: 503, json: { error: 'AI disabled in tests' } })
	);
});

/** Open the page and paste `yaml` into the editor (Monaco keeps pasted text exactly). */
async function openWithYaml(page: Page, yaml: string) {
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.goto('/validate-yaml');
	await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 30_000 });
	await page.evaluate((text) => navigator.clipboard.writeText(text), yaml);
	await page.locator('.monaco-editor .view-lines').click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.press('ControlOrMeta+v');
}

const editorText = async (page: Page) =>
	(await page.locator('.monaco-editor .view-lines').innerText()).replace(/\u00a0/g, ' ');

test('does not keep the YAML in the browser between visits', async ({ page }) => {
	// A draft saved by the old autosave feature must be deleted, not restored.
	await page.addInitScript(
		([key]) => localStorage.setItem(key, JSON.stringify({ yaml: 'kind: OldSecret', savedAt: 1 })),
		[DRAFT_KEY]
	);
	await openWithYaml(page, BAD_TOPONODE.replace('leaf-01', 'leaf-private'));
	await expect.poll(() => editorText(page)).toContain('leaf-private');
	expect(await page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY)).toBeNull();

	await page.goto('/docs');
	await page.goto('/validate-yaml');
	await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 30_000 });
	await expect.poll(() => editorText(page)).toContain('lab-topology');
	expect(await editorText(page)).not.toContain('leaf-private');
	expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('leaf-private');
});

test('reports the enum error and explains the field from the schema', async ({ page }) => {
	await openWithYaml(page, BAD_TOPONODE);
	const issue = page.locator('.validate-yaml-issue-msg', { hasText: 'operatingSystem' }).first();
	await expect(issue).toContainText("value 'SRL' is invalid", { timeout: 20_000 });

	await page.getByRole('button', { name: 'Explain' }).first().click();
	const explain = page.locator('.validate-yaml-explain');
	await expect(explain).toContainText('Allowed values');
	await expect(explain).toContainText('srl');
});

test('inserts a minimal manifest for a kind from its schema', async ({ page }) => {
	await openWithYaml(page, BAD_TOPONODE);
	const picker = page.locator('.validate-yaml-insert__select');
	await expect(
		picker.locator('option', { hasText: 'Interface (interfaces.eda.nokia.com)' })
	).toHaveCount(1, {
		timeout: 20_000
	});
	await picker.selectOption({ label: 'Interface (interfaces.eda.nokia.com)' });
	await expect.poll(() => editorText(page)).toContain('kind: Interface');
	await expect.poll(() => editorText(page)).toContain('my-interface');
});

test('share link round-trips the YAML', async ({ page, context, baseURL }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
	await openWithYaml(page, BAD_TOPONODE.replace('leaf-01', 'leaf-shared'));
	await page.getByRole('button', { name: 'Copy share link' }).click();
	const link = await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toContain('bundle=')
		.then(() => page.evaluate(() => navigator.clipboard.readText()));

	await page.goto(link);
	await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 30_000 });
	await expect.poll(() => editorText(page)).toContain('leaf-shared');
});

test('Info filter and F8 navigation are available', async ({ page }) => {
	await openWithYaml(page, BAD_TOPONODE);
	await expect(page.locator('.validate-yaml-issue-msg').first()).toBeVisible({ timeout: 20_000 });
	await expect(page.getByRole('tab', { name: 'Info' })).toBeVisible();

	await page.locator('.monaco-editor .view-lines').click();
	await page.keyboard.press('F8');
	await expect(
		page
			.locator('.monaco-editor .current-line, .monaco-editor .view-overlays .current-line')
			.first()
	).toBeVisible();
});

test('an applied fix can be undone with Ctrl+Z', async ({ page }) => {
	await openWithYaml(page, BAD_TOPONODE);
	const issueRow = page.locator('li', {
		has: page.locator('.validate-yaml-issue-msg', { hasText: 'operatingSystem' })
	});
	await issueRow
		.getByRole('button', { name: 'Fix', exact: true })
		.first()
		.click({ timeout: 20_000 });
	await expect.poll(() => editorText(page)).toContain('operatingSystem: srl');

	await page.locator('.monaco-editor .view-lines').click();
	await page.keyboard.press('ControlOrMeta+z');
	await expect.poll(() => editorText(page)).toContain('operatingSystem: SRL');
});
