import { describe, expect, it } from 'vitest';
import { parseBundleResources } from './parser';
import { validateEdaRules } from './edaRules';

const CONFIGLET = `apiVersion: config.eda.nokia.com/v1
kind: Configlet
metadata:
  name: vrf-customer-a
  namespace: eda
spec:
  config: test
`;

describe('validateEdaRules', () => {
	it('returns no issues for valid manifests (EDA-specific rules only)', () => {
		const parsed = parseBundleResources(CONFIGLET);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		expect(validateEdaRules(parsed.resources)).toHaveLength(0);
	});
});

describe('validateEdaRules bundle conflicts', () => {
	it('reports a resource defined twice, on the later document', () => {
		const parsed = parseBundleResources(`${CONFIGLET}---\n${CONFIGLET}`);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const issues = validateEdaRules(parsed.resources);
		const duplicate = issues.find((i) => i.rule === 'duplicate-resource');
		expect(duplicate).toMatchObject({ severity: 'error', category: 'eda', docIndex: 2 });
		expect(duplicate?.message).toContain('Duplicate Configlet "vrf-customer-a"');
		expect(duplicate?.line).toBeGreaterThan(9);
	});

	it('warns when the duplicates use different apiVersions', () => {
		const other = CONFIGLET.replace('config.eda.nokia.com/v1', 'config.eda.nokia.com/v1alpha1');
		const parsed = parseBundleResources(`${CONFIGLET}---\n${other}`);
		if (!parsed.ok) throw new Error('parse failed');

		expect(validateEdaRules(parsed.resources).map((i) => i.rule)).toEqual([
			'duplicate-resource',
			'apiversion-mismatch'
		]);
	});
});
