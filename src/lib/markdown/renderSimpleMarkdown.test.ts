import { describe, expect, it } from 'vitest';
import { renderSimpleMarkdown } from './renderSimpleMarkdown';

describe('renderSimpleMarkdown', () => {
	it('resolves inline code inside bullet lists (no @@MD placeholders)', () => {
		const html = renderSimpleMarkdown(
			['## Required fields', '', '- `members` (object) — Member list', '- `enabled` (boolean)'].join(
				'\n'
			)
		);
		expect(html).not.toMatch(/@@MD\d+@@/);
		expect(html).toContain('md-inline-code');
		expect(html).toContain('members');
		expect(html).toContain('enabled');
	});
});
