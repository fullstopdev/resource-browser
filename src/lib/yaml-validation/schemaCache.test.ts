import { describe, expect, it } from 'vitest';
import {
	assertSafeFolderPath,
	assertSafePathSegment,
	releaseAssetPath,
	schemaPath
} from './schemaCache';

describe('assertSafePathSegment', () => {
	it('accepts safe release resource and version segments', () => {
		expect(assertSafePathSegment('26.4.2', 'releaseFolder')).toBe('26.4.2');
		expect(assertSafePathSegment('configlets.config.eda.nokia.com', 'resourceName')).toBe(
			'configlets.config.eda.nokia.com'
		);
		expect(assertSafePathSegment('v1alpha1', 'version')).toBe('v1alpha1');
	});

	it('rejects traversal and slash injection', () => {
		expect(() => assertSafePathSegment('..', 'releaseFolder')).toThrow(/Invalid/);
		expect(() => assertSafePathSegment('foo/bar', 'resourceName')).toThrow(/Unsafe|Invalid/);
		expect(() => assertSafePathSegment('../etc', 'version')).toThrow(/Unsafe|Invalid/);
	});

	it('accepts multi-segment release folders', () => {
		expect(assertSafeFolderPath('resources/26.4.2')).toBe('resources/26.4.2');
	});

	it('builds schema paths only from validated segments', () => {
		expect(schemaPath('resources/26.4.2', 'configlets.config.eda.nokia.com', 'v1alpha1')).toBe(
			'/resources/26.4.2/configlets.config.eda.nokia.com/v1alpha1.yaml'
		);
		expect(() => schemaPath('resources/../etc', 'x', 'v1')).toThrow();
	});

	it('builds release asset paths without duplicating the resources prefix', () => {
		expect(releaseAssetPath('resources/26.4.2', 'dependency-graph.json')).toBe(
			'/resources/26.4.2/dependency-graph.json'
		);
		expect(releaseAssetPath('resources/26.4.2', 'manifest.json')).toBe(
			'/resources/26.4.2/manifest.json'
		);
	});
});
