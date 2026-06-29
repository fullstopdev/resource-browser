import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadStaticYaml } from '$lib/yaml/safeYaml';
import type { SchemaSections } from '$lib/yaml-validation/schemaCache';
import type { ManifestEntry } from '$lib/yaml-validation/types';
import { fixAllBundle } from './fixAllBundle';

const bridgeDomainManifest: ManifestEntry[] = [
	{
		name: 'bridgedomains.services.eda.nokia.com',
		kind: 'BridgeDomain',
		group: 'services.eda.nokia.com',
		versions: [{ name: 'v1', deprecated: true }, { name: 'v2' }]
	}
];

function loadBridgeDomainV2Spec(): unknown {
	const schemaPath = resolve(
		process.cwd(),
		'static/resources/26.4.2/bridgedomains.services.eda.nokia.com/v2.yaml'
	);
	const text = readFileSync(schemaPath, 'utf8');
	const parsed = loadStaticYaml(text) as {
		schema?: { openAPIV3Schema?: { properties?: { spec?: unknown } } };
	};
	return parsed.schema?.openAPIV3Schema?.properties?.spec;
}

vi.mock('$lib/yaml-validation/schemaCache', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/yaml-validation/schemaCache')>();
	const specSchema = loadBridgeDomainV2Spec();
	const mockSections: SchemaSections = {
		spec: specSchema,
		isSpecRequired: true
	};
	return {
		...actual,
		fetchSchemas: vi.fn(async (paths: string[]) => {
			const map = new Map<string, SchemaSections>();
			for (const path of paths) {
				map.set(path, mockSections);
			}
			return map;
		})
	};
});

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

describe('fixAllBundle BridgeDomain v1 migration', () => {
	it('applies structural migration via schema value fixes with zero AI calls', async () => {
		const aiFix = vi.fn();
		const result = await fixAllBundle(BRIDGE_DOMAIN_V1_YAML, [], {
			releaseFolder: 'resources/26.4.2',
			manifest: bridgeDomainManifest,
			includeAi: true,
			aiFix
		});

		expect(result.ok).toBe(true);
		expect(result.aiFixCount).toBe(0);
		expect(aiFix).not.toHaveBeenCalled();
		expect(result.yaml).toContain('encapOptions:');
		expect(result.yaml).toContain('tunnelIndexPool: tunnel-index-pool');
		expect(result.yaml).toMatch(/macLearning:[\s\S]*enabled: true/);
		expect(result.yaml).not.toMatch(/^  tunnelIndexPool:/m);
		expect(result.yaml).not.toMatch(/^  vni:/m);
		expect(result.yaml).not.toContain('macAging:');
	});

	it('applies relocateField suggested fixes when structural pass is unavailable', async () => {
		const issues = [
			{
				id: 'rel-tunnel',
				severity: 'warning' as const,
				category: 'schema' as const,
				message: 'relocate tunnelIndexPool',
				docIndex: 1,
				fieldPath: 'spec.tunnelIndexPool',
				suggestedFix: {
					action: 'relocateField' as const,
					field: 'spec.tunnelIndexPool',
					value: 'spec.encapOptions.vxlan.tunnelIndexPool'
				}
			},
			{
				id: 'rel-vni',
				severity: 'warning' as const,
				category: 'schema' as const,
				message: 'relocate vni',
				docIndex: 1,
				fieldPath: 'spec.vni',
				suggestedFix: {
					action: 'relocateField' as const,
					field: 'spec.vni',
					value: 'spec.encapOptions.vxlan.vni'
				}
			},
			{
				id: 'rel-vni-pool',
				severity: 'warning' as const,
				category: 'schema' as const,
				message: 'relocate vniPool',
				docIndex: 1,
				fieldPath: 'spec.vniPool',
				suggestedFix: {
					action: 'relocateField' as const,
					field: 'spec.vniPool',
					value: 'spec.encapOptions.vxlan.vniPool'
				}
			}
		];

		const aiFix = vi.fn();
		const result = await fixAllBundle(BRIDGE_DOMAIN_V1_YAML, issues, {
			releaseFolder: 'resources/26.4.2',
			manifest: [],
			includeAi: true,
			aiFix
		});

		expect(result.ok).toBe(true);
		expect(result.aiFixCount).toBe(0);
		expect(aiFix).not.toHaveBeenCalled();
		expect(result.suggestedFixCount).toBe(3);
		expect(result.yaml).toContain('encapOptions:');
	});
});
