import { describe, expect, it } from 'vitest';
import { GOLDEN_ASK_QUESTIONS } from './goldenQuestions';
import {
	extractExplicitKindFromQuestion,
	questionAsksRequiredFields,
	resolveAskTargets,
	resolveAskTargetsWithMeta
} from '$lib/ai/resolveAskTargets';
import type { ManifestEntry } from '$lib/yaml-validation/types';

const manifest: ManifestEntry[] = [
	{
		name: 'policys.routingpolicies.eda.nokia.com',
		kind: 'Policy',
		group: 'routingpolicies.eda.nokia.com',
		versions: [{ name: 'v1alpha1' }]
	},
	{
		name: 'interfaces.interfaces.eda.nokia.com',
		kind: 'Interface',
		group: 'interfaces.eda.nokia.com',
		versions: [{ name: 'v1alpha1' }]
	},
	{
		name: 'fabrics.fabrics.eda.nokia.com',
		kind: 'Fabric',
		group: 'fabrics.eda.nokia.com',
		versions: [{ name: 'v1alpha1' }]
	},
	{
		name: 'topologys.topologies.eda.nokia.com',
		kind: 'Topology',
		group: 'topologies.eda.nokia.com',
		versions: [{ name: 'v1alpha1' }]
	}
];

const confidenceRank = { high: 2, medium: 1, low: 0 } as const;

describe('golden Ask AI questions', () => {
	for (const item of GOLDEN_ASK_QUESTIONS) {
		it(item.label, () => {
			const { targets, confidence } = resolveAskTargetsWithMeta({
				question: item.question,
				release: '26.4.2',
				manifest
			});

			if (item.expectedKind) {
				expect(targets.some((t) => t.kind === item.expectedKind)).toBe(true);
			}
			if (item.maxTargets) {
				expect(targets.length).toBeLessThanOrEqual(item.maxTargets);
			}
			if (item.minConfidence) {
				expect(confidenceRank[confidence]).toBeGreaterThanOrEqual(
					confidenceRank[item.minConfidence]
				);
			}
		});
	}

	it('Policy CRD question resolves exactly Policy not other *Policy kinds', () => {
		const targets = resolveAskTargets({
			question: 'What is the Policy CRD in 26.4.2?',
			release: '26.4.2',
			manifest
		});
		expect(targets).toHaveLength(1);
		expect(targets[0].kind).toBe('Policy');
	});

	it('required fields question detects Interface kind', () => {
		expect(questionAsksRequiredFields('Required fields for Interface in 26.4.2?')).toBe(true);
		expect(extractExplicitKindFromQuestion('What is the Policy CRD in 26.4.2?')).toBe('Policy');
	});
});
