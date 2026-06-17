import { describe, expect, it } from 'vitest';
import { countLeadingTrimmedLines, parseDocuments } from './parseDocuments';

describe('parseDocuments', () => {
	it('maps document startLine to the original input when leading blank lines are trimmed', () => {
		const yaml = `\n\napiVersion: v1
kind: ConfigMap
metadata:
  name: test
`;
		expect(countLeadingTrimmedLines(yaml)).toBe(2);
		const result = parseDocuments(yaml);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.docs[0]?.startLine).toBe(2);
	});

	it('reports indentation errors with line numbers', () => {
		const yaml = `apiVersion: v1
kind: Config
metadata:
 name: test
  namespace: eda
`;
		const result = parseDocuments(yaml);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toMatch(/YAML parsing error/i);
		expect(result.message).toMatch(/line/i);
		expect(result.line).toBeGreaterThan(0);
	});
});
