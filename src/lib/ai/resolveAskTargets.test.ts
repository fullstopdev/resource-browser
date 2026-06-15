import { describe, expect, it } from 'vitest';
import {
	extractKindFromRequiredFieldsQuestion,
	MAX_ASK_TARGETS,
	questionAsksExampleYaml,
	questionAsksRequiredFields,
	resolveAskTargets,
	resolveAskTargetsWithMeta
} from './resolveAskTargets';
import type { ManifestEntry } from '$lib/yaml-validation/types';

const fabricManifest: ManifestEntry[] = [
	{
		name: 'fabrics.fabrics.eda.nokia.com',
		group: 'fabrics.eda.nokia.com',
		kind: 'Fabric',
		versions: [{ name: 'v1' }]
	},
	{
		name: 'fabricstates.fabrics.eda.nokia.com',
		group: 'fabrics.eda.nokia.com',
		kind: 'FabricState',
		versions: [{ name: 'v1' }]
	},
	{
		name: 'fabrictopologies.fabrics.eda.nokia.com',
		group: 'fabrics.eda.nokia.com',
		kind: 'FabricTopology',
		versions: [{ name: 'v1' }]
	},
	{
		name: 'isls.fabrics.eda.nokia.com',
		group: 'fabrics.eda.nokia.com',
		kind: 'ISL',
		versions: [{ name: 'v1' }]
	},
	{
		name: 'backends.aifabrics.eda.nokia.com',
		group: 'aifabrics.eda.nokia.com',
		kind: 'Backend',
		versions: [{ name: 'v1' }]
	}
];

const policyManifest: ManifestEntry[] = [
	{
		name: 'policys.routingpolicies.eda.nokia.com',
		group: 'routingpolicies.eda.nokia.com',
		kind: 'Policy',
		versions: [{ name: 'v1' }]
	},
	{
		name: 'policyattachments.qos.eda.nokia.com',
		group: 'qos.eda.nokia.com',
		kind: 'PolicyAttachment',
		versions: [{ name: 'v1' }]
	}
];

const realisticPolicyManifest: ManifestEntry[] = [
	{
		name: 'alarmpolicies.core.eda.nokia.com',
		group: 'core.eda.nokia.com',
		kind: 'AlarmPolicy',
		versions: [{ name: 'v1' }]
	},
	{
		name: 'egresspolicys.qos.eda.nokia.com',
		group: 'qos.eda.nokia.com',
		kind: 'EgressPolicy',
		versions: [{ name: 'v1' }]
	},
	{
		name: 'policys.routingpolicies.eda.nokia.com',
		group: 'routingpolicies.eda.nokia.com',
		kind: 'Policy',
		versions: [{ name: 'v1' }]
	},
	{
		name: 'policyattachments.qos.eda.nokia.com',
		group: 'qos.eda.nokia.com',
		kind: 'PolicyAttachment',
		versions: [{ name: 'v1' }]
	}
];

const bgpManifest: ManifestEntry[] = [
	{
		name: 'bgppeers.protocols.eda.nokia.com',
		group: 'protocols.eda.nokia.com',
		kind: 'BGPPeer',
		versions: [{ name: 'v1' }]
	},
	{
		name: 'bgpgroups.protocols.eda.nokia.com',
		group: 'protocols.eda.nokia.com',
		kind: 'BGPGroup',
		versions: [{ name: 'v1' }]
	}
];

describe('resolveAskTargets', () => {
	it('returns pinned target when kind and group provided', () => {
		const targets = resolveAskTargets({
			question: 'What is this CRD for?',
			release: '26.4.2',
			pinned: { kind: 'Policy', group: 'routingpolicies.eda.nokia.com' },
			manifest: policyManifest
		});
		expect(targets).toHaveLength(1);
		expect(targets[0].kind).toBe('Policy');
		expect(targets[0].group).toBe('routingpolicies.eda.nokia.com');
		expect(targets[0].source).toBe('pinned');
		expect(targets[0].version).toBe('v1');
	});

	it('includes latest non-deprecated apiVersion on resolved targets', () => {
		const targets = resolveAskTargets({
			question: 'Required fields for Interface in 26.4.2?',
			release: '26.4.2',
			manifest: [
				{
					name: 'interfaces.eda.nokia.com',
					kind: 'Interface',
					group: 'interfaces.eda.nokia.com',
					versions: [
						{ name: 'v1alpha1', deprecated: true },
						{ name: 'v2', deprecated: false }
					]
				}
			]
		});
		expect(targets[0]?.kind).toBe('Interface');
		expect(targets[0]?.version).toBe('v2');
	});

	it('excludes fully deprecated CRDs from resolution', () => {
		const { targets } = resolveAskTargetsWithMeta({
			question: 'What is OldKind?',
			release: '26.4.2',
			manifest: [
				{
					name: 'old.example.com',
					kind: 'OldKind',
					group: 'example.com',
					versions: [{ name: 'v1alpha1', deprecated: true }]
				},
				{
					name: 'policys.routingpolicies.eda.nokia.com',
					kind: 'Policy',
					group: 'routingpolicies.eda.nokia.com',
					versions: [{ name: 'v1', deprecated: false }]
				}
			]
		});
		expect(targets.every((t) => t.kind !== 'OldKind')).toBe(true);
	});

	it('resolves fabric topic to fabric apiGroup CRDs excluding states', () => {
		const targets = resolveAskTargets({
			question: 'What fabric CRDs exist and what are they for in 26.4.2?',
			release: '26.4.2',
			manifest: fabricManifest
		});
		const kinds = targets.map((t) => t.kind);
		expect(kinds).toContain('Fabric');
		expect(kinds).toContain('FabricTopology');
		expect(kinds).toContain('ISL');
		expect(kinds).not.toContain('FabricState');
		expect(targets.length).toBeLessThanOrEqual(MAX_ASK_TARGETS);
	});

	it('includes state CRDs when question mentions state', () => {
		const targets = resolveAskTargets({
			question: 'Explain FabricState status fields',
			release: '26.4.2',
			manifest: fabricManifest
		});
		expect(targets.some((t) => t.kind === 'FabricState')).toBe(true);
	});

	it('resolves BGP peers from topic question', () => {
		const targets = resolveAskTargets({
			question: 'What BGP peers CRDs are available?',
			release: '26.4.2',
			manifest: bgpManifest
		});
		expect(targets.some((t) => t.kind === 'BGPPeer')).toBe(true);
	});

	it('resolves Policy kind and prefers routingpolicies when group mentioned', () => {
		const targets = resolveAskTargets({
			question: 'What is the Policy CRD in routingpolicies.eda.nokia.com?',
			release: '26.4.2',
			manifest: policyManifest
		});
		expect(targets).toHaveLength(1);
		expect(targets[0].kind).toBe('Policy');
		expect(targets[0].group).toBe('routingpolicies.eda.nokia.com');
	});

	it('resolves starter question to exact Policy CRD only (not AlarmPolicy/EgressPolicy)', () => {
		const targets = resolveAskTargets({
			question: 'What is the Policy CRD in 26.4.2?',
			release: '26.4.2',
			manifest: realisticPolicyManifest
		});
		expect(targets).toHaveLength(1);
		expect(targets[0].kind).toBe('Policy');
		expect(targets[0].group).toBe('routingpolicies.eda.nokia.com');
		expect(targets.map((t) => t.kind)).not.toContain('AlarmPolicy');
		expect(targets.map((t) => t.kind)).not.toContain('EgressPolicy');
	});

	it('returns multiple policy-related CRDs for broad Policy resources question', () => {
		const targets = resolveAskTargets({
			question: 'Tell me about Policy resources',
			release: '26.4.2',
			manifest: realisticPolicyManifest
		});
		expect(targets.length).toBeGreaterThanOrEqual(2);
		expect(targets.every((t) => t.kind.toLowerCase().includes('policy'))).toBe(true);
	});

	it('resolves required fields question to Interface only', () => {
		const interfaceManifest: ManifestEntry[] = [
			{
				name: 'interfaces.interfaces.eda.nokia.com',
				group: 'interfaces.eda.nokia.com',
				kind: 'Interface',
				versions: [{ name: 'v1' }]
			},
			{
				name: 'interfacestates.interfaces.eda.nokia.com',
				group: 'interfaces.eda.nokia.com',
				kind: 'InterfaceState',
				versions: [{ name: 'v1' }]
			}
		];
		const targets = resolveAskTargets({
			question: 'Required fields for Interface in 26.4.2?',
			release: '26.4.2',
			manifest: interfaceManifest
		});
		expect(targets).toHaveLength(1);
		expect(targets[0].kind).toBe('Interface');
		expect(targets[0].group).toBe('interfaces.eda.nokia.com');
	});

	it('detects required fields intent from question text', () => {
		expect(questionAsksRequiredFields('Required fields for Interface in 26.4.2?')).toBe(
			true
		);
		expect(extractKindFromRequiredFieldsQuestion('Required fields for Interface in 26.4.2?')).toBe(
			'Interface'
		);
	});

	it('detects example YAML intent from question text', () => {
		expect(questionAsksExampleYaml('Example YAML for a Fabric in 26.4.2?')).toBe(true);
		expect(questionAsksExampleYaml('Show me a yaml manifest for Policy')).toBe(true);
		expect(questionAsksExampleYaml('What is Fabric?')).toBe(false);
	});
});
