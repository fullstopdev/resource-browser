import { describe, expect, it } from 'vitest';
import { trimToBudget } from './tokenBudget';

describe('trimToBudget', () => {
	it('does not truncate text within budget', () => {
		const text = 'Short answer.\n\nSecond paragraph.';
		expect(trimToBudget(text, 500)).toBe(text);
	});

	it('cuts at paragraph boundary instead of mid-sentence', () => {
		const para1 = 'A'.repeat(100);
		const para2 = 'B'.repeat(200);
		const text = `${para1}\n\n${para2}`;
		const result = trimToBudget(text, 120);
		expect(result).toContain('…[truncated]');
		expect(result).not.toContain('BBBB');
	});

	it('cuts before yaml fence when fence does not fit in budget', () => {
		const yaml = '```yaml\napiVersion: v1\nkind: Pod\n```';
		const padding = 'x'.repeat(200);
		const text = `${padding}\n\n${yaml}`;
		const result = trimToBudget(text, padding.length + 10);
		expect(result).not.toContain('kind: Pod');
		expect(result).toContain('…[truncated]');
	});
});
