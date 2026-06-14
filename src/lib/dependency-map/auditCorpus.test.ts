import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStaticYaml } from '$lib/yaml/safeYaml';
import { describe, expect, it } from 'vitest';
import { auditManifestResources } from './auditCorpus';
import type { CrdResource } from '$lib/structure';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = JSON.parse(
	readFileSync(join(root, 'static/resources/26.4.2/manifest.json'), 'utf8')
) as CrdResource[];

function loadOpenApi(resourceName: string, apiVersion: string): unknown {
	const yaml = readFileSync(
		join(root, 'static/resources/26.4.2', resourceName, `${apiVersion}.yaml`),
		'utf8'
	);
	return (loadStaticYaml(yaml) as { schema?: { openAPIV3Schema?: unknown } }).schema?.openAPIV3Schema ?? null;
}

describe('auditCorpus coverage', () => {
	const { summary } = auditManifestResources('26.4.2', manifest, loadOpenApi);

	it('reports reference fields in the 26.4.2 corpus', () => {
		expect(summary.totalReferenceFields).toBeGreaterThan(350);
	});

	it('matches at least 90% of actionable reference descriptions', () => {
		expect(summary.matchRate).toBeGreaterThanOrEqual(0.9);
	});

	it('skips external and meta descriptions without inflating unmatched', () => {
		expect(summary.skipped).toBeGreaterThan(10);
		expect(summary.unmatched).toBeLessThan(20);
	});

	it('matches at least 90% of actionable *Ref field stems', () => {
		expect(summary.refFieldStems.rate).toBeGreaterThanOrEqual(0.9);
	});

	it('has zero unmatched reference descriptions after meta-interface and monitor resolution', () => {
		expect(summary.unmatched).toBe(0);
	});

	it('matches at least 90% of interfaceKind meta-interface fields', () => {
		expect(summary.metaInterface.rate).toBeGreaterThanOrEqual(0.9);
	});

	it('matches at least 85% of guarded selector intent fields', () => {
		expect(summary.selectorIntent.rate).toBeGreaterThanOrEqual(0.85);
	});
});
