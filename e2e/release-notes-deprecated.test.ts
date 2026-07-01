import { expect, test } from '@playwright/test';

async function openDeprecatedSection(page: import('@playwright/test').Page) {
	await page.goto('/release-changes?v=26.4.1');
	await expect(page.locator('.comparison-release-pill--target')).toContainText('26.4.1');
	const deprecated = page.locator('#section-deprecated');
	await deprecated.locator('summary').click();
	await expect(deprecated.locator('tbody tr').first()).toBeVisible();
}

test('deprecated section lists kinds with readable contrast in light and dark', async ({ page }) => {
	await openDeprecatedSection(page);
	const rows = page.locator('#section-deprecated tbody tr');
	await expect(rows.first()).toBeVisible();

	for (const mode of ['light', 'dark'] as const) {
		if (mode === 'dark') {
			await page.evaluate(() => document.documentElement.classList.add('dark'));
		} else {
			await page.evaluate(() => document.documentElement.classList.remove('dark'));
		}

		const failures = await rows.evaluateAll((elements, modeLabel) => {
			const toRgb = (color: string): [number, number, number] | null => {
				const canvas = document.createElement('canvas');
				canvas.width = canvas.height = 1;
				const ctx = canvas.getContext('2d');
				if (!ctx) return null;
				ctx.fillStyle = '#ffffff';
				ctx.fillRect(0, 0, 1, 1);
				ctx.fillStyle = color;
				ctx.fillRect(0, 0, 1, 1);
				const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
				return a > 0 ? [r, g, b] : null;
			};

			const luminance = ([r, g, b]: [number, number, number]) => {
				const channel = (c: number) => {
					const s = c / 255;
					return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
				};
				return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
			};

			const contrast = (fg: string, bg: string) => {
				const fgRgb = toRgb(fg);
				const bgRgb = toRgb(bg);
				if (!fgRgb || !bgRgb) return null;
				const l1 = luminance(fgRgb);
				const l2 = luminance(bgRgb);
				const lighter = Math.max(l1, l2);
				const darker = Math.min(l1, l2);
				return (lighter + 0.05) / (darker + 0.05);
			};

			const opaqueBg = (el: Element): string => {
				let node: Element | null = el;
				while (node) {
					const bg = getComputedStyle(node).backgroundColor;
					if (toRgb(bg)) return bg;
					node = node.parentElement;
				}
				return 'rgb(255, 255, 255)';
			};

			const issues: string[] = [];
			for (const el of elements) {
				const bg = opaqueBg(el);
				const nodes = [
					el.querySelector('button'),
					el.querySelector('td:nth-child(2)'),
					el.querySelector('td:nth-child(3)'),
					el.querySelector('.release-notes-version-badge')
				];

				for (const node of nodes) {
					if (!node) {
						issues.push(`${modeLabel}: missing text node`);
						continue;
					}
					const text = node.textContent?.trim() ?? '';
					const style = getComputedStyle(node);
					if (!text) issues.push(`${modeLabel}: empty text`);
					if (Number(style.opacity) <= 0) issues.push(`${modeLabel}: opacity 0 on "${text.slice(0, 20)}"`);
					if (/rgba?\(0,\s*0,\s*0,\s*0\)/.test(style.webkitTextFillColor)) {
						issues.push(`${modeLabel}: transparent webkit fill on "${text.slice(0, 20)}"`);
					}
					const ratio = contrast(style.color, bg);
					if (ratio == null || ratio <= 3) {
						issues.push(`${modeLabel}: low contrast (${ratio ?? 'n/a'}) on "${text.slice(0, 20)}"`);
					}
				}
			}
			return issues;
		}, mode);

		expect(failures, failures.join('\n')).toEqual([]);
	}
});

test('redirects legacy /release-notes to /release-changes', async ({ page }) => {
	const response = await page.goto('/release-notes?v=26.4.3');
	expect(response?.status()).toBeLessThan(400);
	await expect(page).toHaveURL(/\/release-changes\?v=26\.4\.3/);
});

test('release changes page loads timeline and summary', async ({ page }) => {
	await page.goto('/release-changes');
	await expect(page.locator('.release-notes-timeline-btn').first()).toBeVisible();
	await expect(page.locator('.comparison-summary-card').first()).toBeVisible();
	await expect(page.locator('.comparison-release-pill--target')).toContainText('26.4.3');
});
