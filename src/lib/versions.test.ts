import { describe, expect, it } from 'vitest';
import { getLatestVersion, hasActiveApiVersion, pickLatestApiVersion } from './versions';

describe('pickLatestApiVersion', () => {
	it('prefers latest non-deprecated version', () => {
		expect(
			pickLatestApiVersion([
				{ name: 'v1alpha1', deprecated: true, appVersion: '' },
				{ name: 'v2', deprecated: false, appVersion: '' }
			])
		).toBe('v2');
	});

	it('returns empty when all versions are deprecated', () => {
		expect(
			pickLatestApiVersion([{ name: 'v1alpha1', deprecated: true, appVersion: '' }])
		).toBe('');
	});

	it('hasActiveApiVersion reflects non-deprecated presence', () => {
		expect(
			hasActiveApiVersion([{ name: 'v1alpha1', deprecated: true, appVersion: '' }])
		).toBe(false);
		expect(
			hasActiveApiVersion([
				{ name: 'v1alpha1', deprecated: true, appVersion: '' },
				{ name: 'v1', deprecated: false, appVersion: '' }
			])
		).toBe(true);
	});

	it('getLatestVersion delegates to pickLatestApiVersion', () => {
		expect(
			getLatestVersion({
				versions: [
					{ name: 'v1beta1', deprecated: false, appVersion: '' },
					{ name: 'v1', deprecated: false, appVersion: '' }
				]
			})
		).toBe('v1');
	});
});
