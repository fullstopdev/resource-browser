import { describe, expect, it } from 'vitest';
import { validateBundle } from './index';
import { validateBundleOffThread } from './validateOffThread';

const options = {
	yamlInput: 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: a\n',
	releaseFolder: 'resources/26.8.2',
	releaseLabel: '26.8.2',
	manifest: []
};

describe('validateBundleOffThread', () => {
	it('falls back to main-thread validation where Worker is unavailable', async () => {
		expect(typeof Worker).toBe('undefined');
		const [off, direct] = await Promise.all([
			validateBundleOffThread(options),
			validateBundle(options)
		]);
		expect(off.issues).toEqual(direct.issues);
		expect(off.summary).toEqual(direct.summary);
		expect(off.resources.length).toBe(direct.resources.length);
	});
});
