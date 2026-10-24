import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAiSchema } from '../loadAiSchema';
import { tryRuleFix } from '../ruleFix';
import { schemaHintsForField, verifyFix } from '../verifyFix';
import { latestReleaseName } from '$lib/latestRelease';
import { FIX_EVAL_CASES } from './fixCases';

// How many eval cases the server fixes with rules alone (no Workers AI call).
describe('rule-based fixes on the eval cases', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('fixes and verifies the cases the schema decides', async () => {
		const fetcher = (async (input: RequestInfo | URL) => {
			try {
				return new Response(await readFile(`static${String(input)}`, 'utf8'));
			} catch {
				return new Response(null, { status: 404 });
			}
		}) as typeof fetch;
		const fixed: string[] = [];
		const left: string[] = [];
		for (const c of FIX_EVAL_CASES) {
			const version = /apiVersion:\s*[^/\s]+\/(\S+)/.exec(c.yaml)?.[1];
			const schema = await loadAiSchema(latestReleaseName(), c.kind, fetcher, c.group, version, {
				allowDeprecated: true
			});
			const issue = {
				message: c.message,
				fieldPath: c.fieldPath,
				issueKind: c.issueKind,
				...schemaHintsForField(schema?.specSchema, c.fieldPath)
			};
			const rule = schema ? tryRuleFix(c.yaml, issue, schema.specSchema) : null;
			const ok =
				rule &&
				verifyFix({
					originalDoc: c.yaml,
					fixedDoc: rule.fixedDoc,
					issue: { ...issue, suggestedFix: rule.suggestedFix },
					specSchema: schema!.specSchema
				}).ok;
			if (ok) {
				const yaml = await import('js-yaml');
				const doc = yaml.load(rule!.fixedDoc) as Record<string, unknown>;
				expect(c.check(doc), `${c.id}: ${rule!.explanation}`).toBeNull();
				fixed.push(c.id);
			} else left.push(c.id);
		}
		console.log(`rules: ${fixed.length}/${FIX_EVAL_CASES.length}\nleft for AI: ${left.join(', ')}`);
		expect(fixed.length).toBeGreaterThan(20);
	});
});
