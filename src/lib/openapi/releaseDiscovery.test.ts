import { describe, expect, it } from 'vitest';
import {
	discoverOpenApiReleaseFolders,
	isOpenApiReleaseFolder
} from './releaseDiscovery';

describe('isOpenApiReleaseFolder', () => {
	it('accepts semver release folders', () => {
		expect(isOpenApiReleaseFolder('25.8.3')).toBe(true);
		expect(isOpenApiReleaseFolder('26.4.3')).toBe(true);
	});

	it('rejects non-release folder names', () => {
		expect(isOpenApiReleaseFolder('.gitkeep')).toBe(false);
		expect(isOpenApiReleaseFolder('latest')).toBe(false);
		expect(isOpenApiReleaseFolder('25.8')).toBe(false);
	});
});

describe('discoverOpenApiReleaseFolders', () => {
	it('filters and sorts semver folders newest first', () => {
		expect(
			discoverOpenApiReleaseFolders(['26.4.3', '25.8.3', '25.12.3', 'tmp', '.git'])
		).toEqual(['26.4.3', '25.12.3', '25.8.3']);
	});
});
