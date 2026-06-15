import { describe, expect, it } from 'vitest';
import { parseFixResponse } from './parseFixResponse';

describe('parseFixResponse', () => {
	it('extracts explanation and fixed YAML when fixable', () => {
		const text = `FIXABLE: yes
EXPLANATION: Changed spec.os to lowercase enum value.
FIXED_YAML:
\`\`\`yaml
apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: demo
spec:
  os: srl
\`\`\``;

		const result = parseFixResponse(text);
		expect(result.fixable).toBe(true);
		expect(result.explanation).toContain('spec.os');
		expect(result.fixedYaml).toContain('kind: Fabric');
		expect(result.fixedYaml).toContain('os: srl');
	});

	it('returns not fixable when FIXABLE: no', () => {
		const text = `FIXABLE: no
EXPLANATION: Cannot infer a valid value without operator context.`;

		const result = parseFixResponse(text);
		expect(result.fixable).toBe(false);
		expect(result.explanation).toContain('Cannot infer');
		expect(result.fixedYaml).toBeUndefined();
	});

	it('returns not fixable when YAML fence is missing', () => {
		const text = `FIXABLE: yes
EXPLANATION: Missing document.`;

		const result = parseFixResponse(text);
		expect(result.fixable).toBe(false);
	});
});
