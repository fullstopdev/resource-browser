import { describe, expect, it } from 'vitest';
import { loadUserYaml } from '$lib/yaml/safeYaml';
import { applySchemaStructuralFixes } from './schemaStructuralFixes';

const MAC_LEARNING_OBJECT_SPEC = {
	type: 'object',
	properties: {
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
						tunnelIndexPool: { type: 'string' }
					}
				}
			}
		}
	}
};

describe('applySchemaStructuralFixes', () => {
	it('wraps boolean macLearning and merges macAging', () => {
		const data = loadUserYaml(`apiVersion: example/v1
kind: Test
metadata:
  name: t
spec:
  macLearning: true
  macAging: 300`) as Record<string, unknown>;

		const { data: fixed, fixes } = applySchemaStructuralFixes(data, {
			spec: MAC_LEARNING_OBJECT_SPEC,
			isSpecRequired: true
		});

		expect(fixes.map((f) => f.kind)).toContain('wrapObject');
		expect(fixes.map((f) => f.kind)).toContain('removeField');
		expect((fixed.spec as Record<string, unknown>).macLearning).toEqual({
			enabled: true,
			agingTimeSeconds: 300
		});
	});
});
