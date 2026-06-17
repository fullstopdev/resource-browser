import { describe, expect, it } from 'vitest';
import { loadUserYaml } from '$lib/yaml/safeYaml';
import { applySchemaStructuralFixes } from './schemaStructuralFixes';
import {
	collectSchemaProperties,
	findNestedSchemaPropertyPath,
	findSimilarSchemaProperty
} from './schemaNavigation';
import { walkUnknownFields } from './schemaValidator';
import type { BundleIssue, BundleResource } from './types';

const BRIDGE_DOMAIN_V2_SPEC = {
	type: 'object',
	properties: {
		description: { type: 'string' },
		evi: { type: 'integer' },
		eviPool: { type: 'string' },
		macLearning: {
			type: 'object',
			properties: {
				enabled: { type: 'boolean' },
				agingTimeSeconds: { type: 'integer' }
			}
		},
		encapOptions: {
			type: 'object',
			properties: {
				vxlan: {
					type: 'object',
					properties: {
						tunnelIndexPool: { type: 'string' },
						vni: { type: 'integer' },
						vniPool: { type: 'string' }
					}
				}
			}
		},
		type: { type: 'string' }
	}
};

const BRIDGE_DOMAIN_V1_YAML = `apiVersion: services.eda.nokia.com/v1
kind: BridgeDomain
metadata:
  name: l2-bridge-domain-102
  namespace: clab-orange-tsc
spec:
  description: l2-bridge-domain-102
  evi: 102
  eviPool: evi-pool
  macAging: 300
  macLearning: true
  tunnelIndexPool: tunnel-index-pool
  type: EVPNVXLAN
  vni: 102
  vniPool: vni-pool`;

function makeBridgeDomainResource(yaml: string): BundleResource {
	return {
		id: 'bd-0',
		name: 'l2-bridge-domain-102',
		kind: 'BridgeDomain',
		group: 'services.eda.nokia.com',
		apiVersion: 'services.eda.nokia.com/v1',
		version: 'v1',
		namespace: 'clab-orange-tsc',
		docIndex: 0,
		data: loadUserYaml(yaml) as Record<string, unknown>,
		doc: { data: {}, rawText: yaml, startLine: 0, index: 0 }
	};
}

describe('BridgeDomain v1→v2 validation accuracy', () => {
	const specProps = collectSchemaProperties(BRIDGE_DOMAIN_V2_SPEC)!;

	it('does not fuzzy-match vni to evi (short-key Levenshtein blocked)', () => {
		expect(findSimilarSchemaProperty('vni', specProps)).toBeNull();
	});

	it('does not rename vni when evi sibling already has a value', () => {
		const parentData = { evi: 102, vni: 102 };
		expect(findSimilarSchemaProperty('vni', specProps, undefined, parentData)).toBeNull();
	});

	it('finds nested relocation paths for VXLAN fields', () => {
		expect(findNestedSchemaPropertyPath(BRIDGE_DOMAIN_V2_SPEC, 'tunnelIndexPool')).toBe(
			'encapOptions.vxlan.tunnelIndexPool'
		);
		expect(findNestedSchemaPropertyPath(BRIDGE_DOMAIN_V2_SPEC, 'vni')).toBe(
			'encapOptions.vxlan.vni'
		);
		expect(findNestedSchemaPropertyPath(BRIDGE_DOMAIN_V2_SPEC, 'vniPool')).toBe(
			'encapOptions.vxlan.vniPool'
		);
	});

	it('walkUnknownFields suggests relocateField for flat VXLAN keys', () => {
		const resource = makeBridgeDomainResource(BRIDGE_DOMAIN_V1_YAML);
		const issues: BundleIssue[] = [];
		walkUnknownFields(
			resource.data.spec,
			BRIDGE_DOMAIN_V2_SPEC,
			'spec',
			resource.doc,
			'/spec/',
			issues,
			resource,
			BRIDGE_DOMAIN_V2_SPEC,
			BRIDGE_DOMAIN_V2_SPEC
		);

		const tunnelIssue = issues.find((i) => i.fieldPath === 'spec.tunnelIndexPool');
		expect(tunnelIssue?.suggestedFix).toMatchObject({
			action: 'relocateField',
			field: 'spec.tunnelIndexPool',
			value: 'spec.encapOptions.vxlan.tunnelIndexPool'
		});

		const vniIssue = issues.find((i) => i.fieldPath === 'spec.vni');
		expect(vniIssue?.message).toContain('relocate');
		expect(vniIssue?.suggestedFix?.action).toBe('relocateField');
		expect(issues.some((i) => i.message.includes('Misspelled') && i.fieldPath === 'spec.vni')).toBe(
			false
		);
	});

	it('applySchemaStructuralFixes wraps macLearning and relocates VXLAN fields', () => {
		const data = loadUserYaml(BRIDGE_DOMAIN_V1_YAML) as Record<string, unknown>;
		const { data: fixed, fixes } = applySchemaStructuralFixes(data, {
			spec: BRIDGE_DOMAIN_V2_SPEC,
			isSpecRequired: true
		});

		expect(fixes.some((f) => f.kind === 'wrapObject' && f.path === 'spec.macLearning')).toBe(true);
		expect(fixes.filter((f) => f.kind === 'relocateField').length).toBeGreaterThanOrEqual(3);

		const spec = fixed.spec as Record<string, unknown>;
		expect(spec.macLearning).toMatchObject({ enabled: true, agingTimeSeconds: 300 });
		expect(spec.macAging).toBeUndefined();
		expect(spec.tunnelIndexPool).toBeUndefined();
		expect(spec.vni).toBeUndefined();

		const encap = spec.encapOptions as Record<string, unknown>;
		const vxlan = encap.vxlan as Record<string, unknown>;
		expect(vxlan.tunnelIndexPool).toBe('tunnel-index-pool');
		expect(vxlan.vni).toBe(102);
		expect(vxlan.vniPool).toBe('vni-pool');
		expect(spec.evi).toBe(102);
	});
});
