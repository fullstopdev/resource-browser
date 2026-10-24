import { describe, expect, it, vi } from 'vitest';
import { buildFixInput, FULL_DOC_LINE_LIMIT, spliceFixedExcerpt } from './fixInput';
import { buildVerifiedFixCacheKey } from './kvCache';
import { parseFixResponse } from './parseFixResponse';
import { runVerifiedFix } from './runFix';
import {
	FIX_AI_MAX_OUTPUT_TOKENS,
	FIX_AI_MODEL,
	fixMaxTokensForOutput,
	modelForTier,
	resolveAiModels,
	WORKERS_AI_MODEL
} from './runWorkersAI';
import { schemaHintsForField, specSchemaAtPath, verifyFix } from './verifyFix';

const specSchema = {
	type: 'object',
	properties: {
		os: { type: 'string', enum: ['srl', 'sros'] },
		port: { type: 'integer' },
		name: { type: 'string' },
		members: {
			type: 'array',
			items: { type: 'object', properties: { iface: { type: 'string', enum: ['a', 'b'] } } }
		}
	}
};

const doc = (spec: string) =>
	`apiVersion: demo.eda.nokia.com/v1\nkind: Widget\nmetadata:\n  name: w\n  namespace: eda\nspec:\n${spec}`;

function longDoc(lines: number, badLineAt: number): string {
	const body = Array.from({ length: lines }, (_, i) =>
		i === badLineAt ? '  os: bad' : `  key${i}: value${i}`
	);
	return doc(body.join('\n'));
}

describe('buildFixInput / spliceFixedExcerpt', () => {
	it('sends short documents in full', () => {
		const input = buildFixInput(doc('  os: bad'), 'spec.os');
		expect(input.mode).toBe('full');
	});

	it('cuts long documents to an excerpt around the issue and splices the fix back', () => {
		const yaml = longDoc(FULL_DOC_LINE_LIMIT + 50, 150);
		const input = buildFixInput(yaml, 'spec.os');
		expect(input.mode).toBe('excerpt');
		if (input.mode !== 'excerpt') return;

		expect(input.excerpt).toContain('  os: bad');
		expect(input.excerpt.split('\n').length).toBeLessThan(input.totalLines);
		const fixedExcerpt = input.excerpt.replace('  os: bad', '  os: srl');
		const fixed = spliceFixedExcerpt(input, fixedExcerpt);

		expect(fixed).toBe(input.doc.replace('  os: bad', '  os: srl'));
	});

	it('falls back to the full document when the field cannot be located', () => {
		const input = buildFixInput(longDoc(FULL_DOC_LINE_LIMIT + 10, 5), 'spec.doesNotExist');
		expect(input.mode).toBe('full');
	});
});

describe('verifyFix', () => {
	const original = doc('  os: bad\n  port: 1');

	it('accepts an enum fix that uses an allowed value', () => {
		const verdict = verifyFix({
			originalDoc: original,
			fixedDoc: doc('  os: srl\n  port: 1'),
			issue: { message: 'bad enum', fieldPath: 'spec.os', issueKind: 'enum' },
			specSchema
		});
		expect(verdict).toEqual({ ok: true });
	});

	it('rejects an enum fix that is still not allowed', () => {
		const verdict = verifyFix({
			originalDoc: original,
			fixedDoc: doc('  os: linux\n  port: 1'),
			issue: { message: 'bad enum', fieldPath: 'spec.os', issueKind: 'enum' },
			specSchema
		});
		expect(verdict.ok).toBe(false);
	});

	it('rejects type fixes with the wrong type and unparseable output', () => {
		expect(
			verifyFix({
				originalDoc: doc('  port: "80"'),
				fixedDoc: doc('  port: "eighty"'),
				issue: { message: 'must be integer', fieldPath: 'spec.port', issueKind: 'type' },
				specSchema
			}).ok
		).toBe(false);
		expect(
			verifyFix({
				originalDoc: original,
				fixedDoc: 'spec: [unclosed',
				issue: { message: 'x', fieldPath: 'spec.os', issueKind: 'enum' },
				specSchema
			}).ok
		).toBe(false);
	});

	it('checks required and unknown-field issues', () => {
		const required = { message: 'spec.name is required', fieldPath: 'spec.name', issueKind: 'required' as const };
		expect(
			verifyFix({ originalDoc: doc('  port: 1'), fixedDoc: doc('  port: 1\n  name: web'), issue: required, specSchema }).ok
		).toBe(true);
		// An empty value doesn't fill a required field.
		expect(
			verifyFix({ originalDoc: doc('  port: 1'), fixedDoc: doc('  port: 1\n  name: ""'), issue: required, specSchema }).ok
		).toBe(false);
		expect(
			verifyFix({
				originalDoc: doc('  port: 1\n  bogus: 2'),
				fixedDoc: doc('  port: 1\n  bogus: 2'),
				issue: { message: 'unknown', fieldPath: 'spec.bogus', issueKind: 'unknownField' },
				specSchema
			}).ok
		).toBe(false);
	});

	it('rejects fixes that change the kind', () => {
		const verdict = verifyFix({
			originalDoc: original,
			fixedDoc: original.replace('kind: Widget', 'kind: Gadget').replace('os: bad', 'os: srl'),
			issue: { message: 'bad enum', fieldPath: 'spec.os', issueKind: 'enum' },
			specSchema
		});
		expect(verdict.ok).toBe(false);
	});
});

describe('schema hints', () => {
	it('reads allowed values and types from the schema, including array items', () => {
		expect(schemaHintsForField(specSchema, 'spec.os')).toEqual({
			allowedValues: ['srl', 'sros'],
			expectedTypes: ['string']
		});
		expect(specSchemaAtPath(specSchema, 'spec.members.0.iface')).toEqual({
			type: 'string',
			enum: ['a', 'b']
		});
		expect(schemaHintsForField(specSchema, 'metadata.name')).toEqual({});
	});
});

describe('parseFixResponse', () => {
	it('handles CRLF, yml fences and a missing closing fence', () => {
		const parsed = parseFixResponse(
			'FIXABLE: yes\r\nEXPLANATION: fixed it\r\n\r\nFIXED_YAML:\r\n```yml\r\nspec:\r\n  os: srl\r\n'
		);
		expect(parsed).toEqual({
			fixable: true,
			explanation: 'fixed it',
			fixedYaml: 'spec:\n  os: srl'
		});
	});

	it('keeps the first line indentation (excerpt answers)', () => {
		const parsed = parseFixResponse(
			'FIXABLE: yes\nEXPLANATION: ok\n```yaml\n  os: srl\n  port: 1\n```'
		);
		expect(parsed.fixedYaml).toBe('  os: srl\n  port: 1');
	});

	it('accepts bold markers and an unlabelled fence', () => {
		const parsed = parseFixResponse('**FIXABLE:** yes\n**EXPLANATION:** done\n```\nspec: {}\n```');
		expect(parsed.fixable).toBe(true);
		expect(parsed.explanation).toBe('done');
		expect(parsed.fixedYaml).toBe('spec: {}');
	});
});

describe('runVerifiedFix', () => {
	const models = { default: WORKERS_AI_MODEL, fix: FIX_AI_MODEL };
	const prompt = { system: 'sys', user: 'usr' };
	const answer = (yaml: string) =>
		`FIXABLE: yes\nEXPLANATION: e\nFIXED_YAML:\n\`\`\`yaml\n${yaml}\n\`\`\``;

	it('returns a fix that passes verification on the first attempt', async () => {
		const run = vi.fn(async () => answer('good'));
		const result = await runVerifiedFix({
			prompt,
			models,
			initialModel: models.default,
			run,
			toFullDocument: (y) => y,
			verify: (d) => (d === 'good' ? { ok: true } : { ok: false, reason: 'bad' })
		});
		expect(result).toMatchObject({ verified: true, fixedYaml: 'good', attempts: 1 });
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('retries on the large model with the rejection reason, then accepts', async () => {
		const run = vi
			.fn<(model: string, messages: { role: string; content: string }[]) => Promise<string>>()
			.mockResolvedValueOnce(answer('bad'))
			.mockResolvedValueOnce(answer('good'));
		const result = await runVerifiedFix({
			prompt,
			models,
			initialModel: models.default,
			run,
			toFullDocument: (y) => y,
			verify: (d) => (d === 'good' ? { ok: true } : { ok: false, reason: 'value not allowed' })
		});
		expect(result).toMatchObject({ verified: true, attempts: 2, model: FIX_AI_MODEL });
		const [model, messages] = run.mock.calls[1]!;
		expect(model).toBe(FIX_AI_MODEL);
		expect(messages.at(-1)?.content).toContain('value not allowed');
		expect(messages.some((m) => m.role === 'assistant')).toBe(true);
	});

	it('never returns an unverified fix', async () => {
		const run = vi.fn(async () => answer('bad'));
		const result = await runVerifiedFix({
			prompt,
			models,
			initialModel: models.default,
			run,
			toFullDocument: (y) => y,
			verify: () => ({ ok: false, reason: 'still wrong' })
		});
		expect(result.verified).toBe(false);
		expect(result.fixable).toBe(false);
		expect(result.fixedYaml).toBeUndefined();
		expect(result.rejectReason).toBe('still wrong');
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('treats "FIXABLE: no" from the large model as final', async () => {
		const run = vi.fn(async () => 'FIXABLE: no\nEXPLANATION: needs a human');
		const result = await runVerifiedFix({
			prompt,
			models,
			initialModel: models.fix,
			run,
			toFullDocument: (y) => y,
			verify: () => ({ ok: true })
		});
		expect(result).toMatchObject({ fixable: false, explanation: 'needs a human', attempts: 1 });
		expect(run).toHaveBeenCalledTimes(1);
	});
});

describe('fix cache key and budgets', () => {
	it('changes with the prompt, model and prompt version', async () => {
		const base = { release: '26.8.2', promptVersion: 3, model: 'm', system: 's', user: 'u' };
		const key = await buildVerifiedFixCacheKey(base);
		expect(key).toMatch(/^ai:v3:fix:26\.8\.2:[0-9a-f]{64}$/);
		expect(await buildVerifiedFixCacheKey({ ...base, user: 'u2' })).not.toBe(key);
		expect(await buildVerifiedFixCacheKey({ ...base, model: 'm2' })).not.toBe(key);
		expect(await buildVerifiedFixCacheKey({ ...base, promptVersion: 4 })).not.toBe(key);
		expect(await buildVerifiedFixCacheKey(base)).toBe(key);
	});

	it('sizes max tokens from the expected output, within bounds', () => {
		expect(fixMaxTokensForOutput('x'.repeat(100), 'enum')).toBe(768);
		const sized = fixMaxTokensForOutput('x'.repeat(6400), 'enum');
		expect(sized).toBeGreaterThan(2000);
		expect(fixMaxTokensForOutput('x'.repeat(100_000), 'enum')).toBe(FIX_AI_MAX_OUTPUT_TOKENS);
	});

	it('resolves models from env and maps tiers', () => {
		const models = resolveAiModels({ AI_MODEL_FIX: '@cf/test/big' });
		expect(models).toEqual({ default: WORKERS_AI_MODEL, fix: '@cf/test/big' });
		expect(modelForTier(FIX_AI_MODEL, models)).toBe('@cf/test/big');
		expect(modelForTier(WORKERS_AI_MODEL, models)).toBe(WORKERS_AI_MODEL);
	});
});

describe('loadAiSchema for fixes', () => {
	it('loads a deprecated declared version only when allowed', async () => {
		const { readFile } = await import('node:fs/promises');
		const { loadAiSchema } = await import('./loadAiSchema');
		const fetcher = (async (input: RequestInfo | URL) => {
			try {
				return new Response(await readFile(`static${String(input)}`, 'utf8'));
			} catch {
				return new Response(null, { status: 404 });
			}
		}) as typeof fetch;

		// services.eda.nokia.com/v1 BridgeDomain is deprecated in 26.8.2 (v2 is current).
		expect(
			await loadAiSchema('26.8.2', 'BridgeDomain', fetcher, 'services.eda.nokia.com', 'v1')
		).toBeNull();
		const v1 = await loadAiSchema(
			'26.8.2',
			'BridgeDomain',
			fetcher,
			'services.eda.nokia.com',
			'v1',
			{
				allowDeprecated: true
			}
		);
		expect(v1?.version).toBe('v1');
		expect(v1?.deprecated).toBe(true);
		expect(
			(v1?.specSchema as { properties: Record<string, { type?: string }> }).properties.macLearning
				?.type
		).toBe('boolean');
	});
});
