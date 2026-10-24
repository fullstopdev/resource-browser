import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { buildFixInput } from '../fixInput';
import { validateBundle } from '$lib/validate-bundle';
import { latestReleaseName } from '$lib/latestRelease';
import { FIX_EVAL_CASES } from './fixCases';
import { CURATED_FIX_EVAL_CASES } from './fixCasesCurated';

describe('AI fix eval cases', () => {
	it('have unique ids', () => {
		const ids = FIX_EVAL_CASES.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it.each(FIX_EVAL_CASES.map((c) => [c.id, c]))('%s is actually broken', (_, c) => {
		if (c.issueKind === 'syntax') {
			expect(() => yaml.load(c.yaml)).toThrow();
			return;
		}
		const doc = yaml.load(c.yaml) as Record<string, unknown>;
		expect(c.check(doc), 'the check must flag the broken document').not.toBeNull();
	});

	it('includes a long document that the server sends as an excerpt', () => {
		const long = FIX_EVAL_CASES.find((c) => c.id === 'enum-long-interface-excerpt')!;
		expect(buildFixInput(long.yaml, long.fieldPath).mode).toBe('excerpt');
	});
});

/** The eval runs on the latest release (scripts/eval-fix.ts); the cases must still be broken there. */
const RELEASE = latestReleaseName();

describe('curated AI fix eval cases', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('bring the set to about 60 cases', () => {
		expect(FIX_EVAL_CASES.length).toBeGreaterThanOrEqual(55);
	});

	it.each(CURATED_FIX_EVAL_CASES.map((c) => [c.id, c]))(
		'%s: the validator reports the issue on the latest release',
		async (_, c) => {
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
			const manifest = JSON.parse(
				await readFile(`static/resources/${RELEASE}/manifest.json`, 'utf8')
			);
			const result = await validateBundle({
				yamlInput: c.yaml,
				releaseFolder: `resources/${RELEASE}`,
				releaseLabel: `EDA ${RELEASE}`,
				manifest
			});
			const reported = result.issues.filter((i) => i.severity !== 'info');
			expect(
				reported.some((i) => i.fieldPath === c.fieldPath),
				`the validator reports something else:\n${reported.map((i) => `${i.fieldPath} :: ${i.message}`).join('\n')}`
			).toBe(true);
		}
	);
});
