import { describe, expect, it } from 'vitest';
import type { CrdResource } from '$lib/structure';
import { activeApiVersion, filterActiveManifest, isActiveCrd } from './activeCrds';

const activeResource: CrdResource = {
	name: 'interfaces.eda.nokia.com',
	kind: 'Interface',
	group: 'interfaces.eda.nokia.com',
	versions: [
		{ name: 'v1alpha1', deprecated: true, appVersion: '' },
		{ name: 'v2', deprecated: false, appVersion: '' }
	]
};

const deprecatedOnly: CrdResource = {
	name: 'old.example.com',
	kind: 'OldKind',
	group: 'example.com',
	versions: [{ name: 'v1alpha1', deprecated: true, appVersion: '' }]
};

describe('activeCrds', () => {
	it('detects active vs fully deprecated CRDs', () => {
		expect(isActiveCrd(activeResource)).toBe(true);
		expect(isActiveCrd(deprecatedOnly)).toBe(false);
	});

	it('returns latest non-deprecated apiVersion', () => {
		expect(activeApiVersion(activeResource)).toBe('v2');
		expect(activeApiVersion(deprecatedOnly)).toBe('');
	});

	it('filters manifest to active CRDs only', () => {
		expect(filterActiveManifest([activeResource, deprecatedOnly])).toEqual([activeResource]);
	});
});
