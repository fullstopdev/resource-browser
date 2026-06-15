import { describe, expect, it } from 'vitest';
import { isExternalValueUpdate } from './monacoValueSync';

describe('isExternalValueUpdate', () => {
	it('returns false when bound value matches the last editor emission', () => {
		expect(isExternalValueUpdate('apiVersion: v1\n', 'apiVersion: v1\n')).toBe(false);
	});

	it('returns true when the parent pushes new YAML (fix, example, AI apply)', () => {
		expect(isExternalValueUpdate('kind: Fixed\n', 'kind: Broken\n')).toBe(true);
	});

	it('returns true on initial external load before the editor has emitted', () => {
		expect(isExternalValueUpdate('kind: New\n', '')).toBe(true);
	});
});
