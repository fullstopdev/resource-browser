import { describe, expect, it, vi } from 'vitest';
import { buildAskContext, perTargetKvCharLimit, shouldSkipRag } from './buildAskContext';
import type { ResolvedAskTarget } from './resolveAskTargets';
import { resolveAskTargets } from './resolveAskTargets';
import type { AiSchemaPayload } from './loadAiSchema';
import { SINGLE_TARGET_KV_CHAR_LIMIT } from './tokenBudget';
import type { ManifestEntry } from '$lib/yaml-validation/types';

vi.mock('./loadAiSchema', () => ({
	loadAiSchema: vi.fn()
}));

import { loadAiSchema } from './loadAiSchema';

const interfaceTarget: ResolvedAskTarget = {
	release: '26.4.2',
	kind: 'Interface',
	group: 'interfaces.eda.nokia.com',
	name: 'interfaces.interfaces.eda.nokia.com',
	score: 100,
	source: 'kind'
};

const interfaceSchema: AiSchemaPayload = {
	apiVersion: 'interfaces.eda.nokia.com/v1',
	kind: 'Interface',
	group: 'interfaces.eda.nokia.com',
	release: '26.4.2',
	deprecated: false,
	resourceName: 'interfaces.interfaces.eda.nokia.com',
	version: 'v1',
	specRequired: ['members', 'enabled'],
	statusRequired: [],
	specSchema: {
		properties: {
			members: { type: 'array', description: 'Member references.' },
			enabled: { type: 'boolean', description: 'Admin state.' }
		},
		required: ['members', 'enabled']
	},
	statusSchema: null
};

const fabricTarget: ResolvedAskTarget = {
	release: '26.4.2',
	kind: 'Fabric',
	group: 'fabrics.eda.nokia.com',
	name: 'fabrics.fabrics.eda.nokia.com',
	score: 100,
	source: 'kind'
};

function mockKv(store: Record<string, string>): KVNamespace {
	return {
		get: vi.fn(async (key: string) => store[key] ?? null),
		put: vi.fn(),
		delete: vi.fn(),
		list: vi.fn(),
		getWithMetadata: vi.fn()
	} as unknown as KVNamespace;
}

describe('buildAskContext', () => {
	it('uses full single-target KV budget', () => {
		expect(perTargetKvCharLimit(1)).toBe(SINGLE_TARGET_KV_CHAR_LIMIT);
		expect(perTargetKvCharLimit(1)).toBeGreaterThan(20_000);
	});

	it('loads full-context KV for single-target questions without truncation', async () => {
		const longExplain = 'E'.repeat(8_000);
		const longSchema = 'S'.repeat(10_000);
		const kv = mockKv({
			'ai:v1:26.4.2:Interface:interfaces.eda.nokia.com:none:none:full-context': JSON.stringify({
				answer: `${longSchema}\n\n${longExplain}`,
				release: '26.4.2',
				kind: 'Interface',
				action: 'full-context'
			})
		});

		const result = await buildAskContext({
			question: 'What is Interface in 26.4.2?',
			targets: [interfaceTarget],
			kv,
			originFetch: fetch,
			ai: {} as Ai,
			skipRag: true
		});

		expect(result.kvHits[0]?.kvFullContext).toContain('SSSS');
		expect(result.contextText).toContain('Full CRD context');
		expect(result.contextText).toContain('EEEE');
		expect(result.contextText).not.toContain('…[truncated]');
	});

	it('assembles schema-summary + explain when full-context is missing', async () => {
		const kv = mockKv({
			'ai:v1:26.4.2:Interface:interfaces.eda.nokia.com:none:none:schema-summary': JSON.stringify({
				answer: '## Schema summary\nRequired: members, enabled',
				release: '26.4.2',
				kind: 'Interface',
				action: 'schema-summary'
			}),
			'ai:v1:26.4.2:Interface:interfaces.eda.nokia.com:none:none:explain': JSON.stringify({
				answer: 'Interface represents a logical or physical port.',
				release: '26.4.2',
				kind: 'Interface',
				action: 'explain'
			})
		});

		const result = await buildAskContext({
			question: 'What is Interface?',
			targets: [interfaceTarget],
			kv,
			originFetch: fetch,
			ai: {} as Ai,
			skipRag: true
		});

		expect(result.contextText).toContain('Full CRD context');
		expect(result.contextText).toContain('Schema summary');
		expect(result.contextText).toContain('logical or physical port');
	});

	it('loads example KV action for example YAML questions', async () => {
		const kv = mockKv({
			'ai:v1:26.4.2:Fabric:fabrics.eda.nokia.com:none:none:explain': JSON.stringify({
				answer: 'Fabric connects leaf and spine nodes.',
				release: '26.4.2',
				kind: 'Fabric',
				action: 'explain'
			}),
			'ai:v1:26.4.2:Fabric:fabrics.eda.nokia.com:none:none:example': JSON.stringify({
				answer: '```yaml\napiVersion: fabrics.eda.nokia.com/v1\nkind: Fabric\nmetadata:\n  name: demo\nspec:\n  name: leaf-spine\n```',
				release: '26.4.2',
				kind: 'Fabric',
				action: 'example',
				examples: ['apiVersion: fabrics.eda.nokia.com/v1\nkind: Fabric\nmetadata:\n  name: demo\nspec:\n  name: leaf-spine']
			})
		});

		const result = await buildAskContext({
			question: 'Example YAML for a Fabric in 26.4.2?',
			targets: [fabricTarget],
			kv,
			originFetch: fetch,
			ai: {} as Ai,
			skipRag: true
		});

		expect(result.kvHits[0]?.kvExample).toContain('kind: Fabric');
		expect(result.contextText).toContain('Cached example YAML');
		expect(result.contextText).toContain('kind: Fabric');
	});

	it('loads KV explain and schema context for required-fields questions', async () => {
		vi.mocked(loadAiSchema).mockResolvedValue(interfaceSchema);

		const kv = mockKv({
			'ai:v1:26.4.2:Interface:interfaces.eda.nokia.com:none:none:explain': JSON.stringify({
				answer:
					'Interface represents a logical or physical port. Required spec fields include members and enabled.',
				release: '26.4.2',
				kind: 'Interface',
				action: 'explain'
			})
		});

		const result = await buildAskContext({
			question: 'Required fields for Interface in 26.4.2?',
			targets: [interfaceTarget],
			kv,
			originFetch: fetch,
			ai: {} as Ai,
			skipRag: true
		});

		expect(result.kvHits[0]?.kvAnswer).toContain('members');
		expect(result.schemas).toHaveLength(1);
		expect(result.contextText).toContain('Cached CRD summary');
		expect(result.contextText).toContain('Required spec fields');
		expect(result.contextText).toContain('`members`');
		expect(result.contextText).toContain('`enabled`');
	});

	it('does not truncate question-resolved single-target KV through assembleContext tier', async () => {
		const longBody = 'X'.repeat(26_000);
		const kv = mockKv({
			'ai:v1:26.4.2:Interface:interfaces.eda.nokia.com:none:none:full-context': JSON.stringify({
				answer: longBody,
				release: '26.4.2',
				kind: 'Interface',
				action: 'full-context'
			})
		});

		const result = await buildAskContext({
			question: 'Required fields for Interface in 26.4.2?',
			targets: [interfaceTarget],
			kv,
			originFetch: fetch,
			ai: {} as Ai,
			skipRag: true
		});

		expect(result.contextText).toContain('XXXX');
		expect(result.contextText).not.toContain('…[truncated]');
	});

	it('skips RAG for question-resolved single target with schema KV', () => {
		expect(
			shouldSkipRag({
				question: 'Required fields for Interface in 26.4.2?',
				targets: [interfaceTarget],
				kvHits: [
					{
						target: interfaceTarget,
						kvSchemaSummary: '## Schema summary\nRequired: members, enabled',
						hasCompleteKvContext: true
					}
				],
				hasSchema: true,
				singleFocused: true
			})
		).toBe(true);
	});

	it('global ask flow resolves Interface and loads full KV without pinned request body', async () => {
		const interfaceManifest: ManifestEntry[] = [
			{
				name: 'interfaces.interfaces.eda.nokia.com',
				group: 'interfaces.eda.nokia.com',
				kind: 'Interface',
				versions: [{ name: 'v1' }]
			}
		];
		const question = 'Required fields for Interface in 26.4.2?';
		const targets = resolveAskTargets({
			question,
			release: '26.4.2',
			manifest: interfaceManifest
		});
		expect(targets).toHaveLength(1);
		expect(targets[0].source).toBe('kind');

		const kv = mockKv({
			'ai:v1:26.4.2:Interface:interfaces.eda.nokia.com:none:none:full-context': JSON.stringify({
				answer: '## Schema summary\nRequired: members, enabled\n\nInterface represents a port.',
				release: '26.4.2',
				kind: 'Interface',
				action: 'full-context'
			})
		});

		const result = await buildAskContext({
			question,
			targets,
			kv,
			originFetch: fetch,
			ai: {} as Ai,
			skipRag: true
		});

		expect(result.kvHits[0]?.kvFullContext).toContain('members');
		expect(result.contextText).toContain('Full CRD context');
		expect(result.contextText).toContain('members');
	});
});
