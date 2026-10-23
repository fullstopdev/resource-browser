import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import curated from './curatedExamples.json';
import { validateBundle } from './index';

const RELEASE_FOLDER = `resources/${curated.release}`;

describe('curated Insert example manifests', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('has a small set of unique, sourced examples', () => {
		expect(curated.examples.length).toBeGreaterThan(5);
		expect(curated.examples.length).toBeLessThanOrEqual(30);
		expect(new Set(curated.examples.map((e) => e.label)).size).toBe(curated.examples.length);
		for (const example of curated.examples) {
			expect(example.source).toMatch(/^https:\/\/docs\.eda\.dev\//);
			expect(example.yaml).toContain(`kind: ${example.kind}`);
		}
	});

	it.each(curated.examples.map((e) => [e.label, e]))(
		'%s validates without errors on its release',
		async (_, example) => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async (input: RequestInfo | URL) => {
					try {
						return new Response(await readFile(`static${String(input)}`, 'utf8'));
					} catch {
						return new Response(null, { status: 404 });
					}
				})
			);
			const manifest = JSON.parse(await readFile(`static/${RELEASE_FOLDER}/manifest.json`, 'utf8'));
			const result = await validateBundle({
				yamlInput: example.yaml,
				releaseFolder: RELEASE_FOLDER,
				releaseLabel: `EDA ${curated.release}`,
				manifest
			});
			expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
		}
	);
});
