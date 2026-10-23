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

async function openWithDraft(page: Page, yaml: string) {
	await page.addInitScript(
		([key, value]) =>
			localStorage.setItem(key, JSON.stringify({ yaml: value, savedAt: 1_700_000_000_000 })),
		[DRAFT_KEY, yaml]
	);
	await page.goto('/validate-yaml');
	await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 30_000 });
}

/** Monaco renders spaces as U+00A0; normalize so plain substrings match. */
const editorText = async (page: Page) =>
	(await page.locator('.monaco-editor .view-lines').innerText()).replace(/\u00a0/g, ' ');

test('restores the autosaved draft and can start fresh', async ({ page }) => {
	await openWithDraft(page, BAD_TOPONODE);
	await expect(page.locator('.validate-yaml-draft-banner')).toContainText('Restored your draft');
	await expect.poll(() => editorText(page)).toContain('operatingSystem');

	await page.getByRole('button', { name: 'Start fresh' }).click();
	await expect(page.locator('.validate-yaml-draft-banner')).toHaveCount(0);
	await expect.poll(() => editorText(page)).toContain('lab-topology');
});

test('reports the enum error and explains the field from the schema', async ({ page }) => {
	await openWithDraft(page, BAD_TOPONODE);
	const issue = page.locator('.validate-yaml-issue-msg', { hasText: 'operatingSystem' }).first();
	await expect(issue).toContainText("value 'SRL' is invalid", { timeout: 20_000 });

	await page.getByRole('button', { name: 'Explain' }).first().click();
	const explain = page.locator('.validate-yaml-explain');
	await expect(explain).toContainText('Allowed values');
	await expect(explain).toContainText('srl');
});

test('inserts a minimal manifest for a kind from its schema', async ({ page }) => {
	await openWithDraft(page, BAD_TOPONODE);
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

test('opens a YAML file from disk', async ({ page }) => {
	await openWithDraft(page, BAD_TOPONODE);
	await page.locator('input[type="file"]').setInputFiles({
		name: 'node.yaml',
		mimeType: 'application/yaml',
		buffer: Buffer.from(BAD_TOPONODE.replace('leaf-01', 'leaf-from-file'))
	});
	await expect.poll(() => editorText(page)).toContain('leaf-from-file');
});

test('share link round-trips the YAML', async ({ page, context, baseURL }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
	await openWithDraft(page, BAD_TOPONODE.replace('leaf-01', 'leaf-shared'));
	await page.getByRole('button', { name: 'Copy share link' }).click();
	const link = await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toContain('bundle=')
		.then(() => page.evaluate(() => navigator.clipboard.readText()));

	await page.evaluate((key) => localStorage.removeItem(key), DRAFT_KEY);
	await page.goto(link);
	await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 30_000 });
	await expect.poll(() => editorText(page)).toContain('leaf-shared');
});

test('Info filter and F8 navigation are available', async ({ page }) => {
	await openWithDraft(page, BAD_TOPONODE);
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
	await openWithDraft(page, BAD_TOPONODE);
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
