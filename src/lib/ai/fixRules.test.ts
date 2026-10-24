import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { addUnder, deleteAt, formatScalar, renameKeyAt, setScalarAt } from './yamlLineEdit';
import { applyFixPatch, parseFixPatch } from './fixPatch';
import { tryRuleFix } from './ruleFix';
import { runVerifiedFix } from './runFix';
import { parsePatchAnswer } from './fixPatch';

const DOC = `apiVersion: core.eda.nokia.com/v1
kind: TopoNode
metadata:
  name: leaf1 # first leaf
  namespace: eda
spec:
  operatingSystem: SRL
  version: "26.7.1"
  links:
    - 25Gbps
  npp:
    mode: Normal
  hostname: leaf1
`;

const SCHEMA = {
	type: 'object',
	required: ['operatingSystem', 'platform'],
	properties: {
		operatingSystem: { type: 'string', enum: ['srl', 'sros', 'eos'] },
		version: { type: 'string' },
		mtu: { type: 'integer' },
		enabled: { type: 'boolean' },
		platform: { type: 'string', default: '7220 IXR-D3L' },
		npp: {
			type: 'object',
			properties: { mode: { type: 'string', enum: ['normal', 'maintenance'] } }
		}
	}
};

describe('yamlLineEdit', () => {
	it('sets a scalar and keeps comments and the rest of the document', () => {
		const out = setScalarAt(DOC, 'spec.operatingSystem', 'srl')!;
		expect(out).toContain('  operatingSystem: srl\n');
		expect(out).toContain('name: leaf1 # first leaf');
		expect(out.split('\n')).toHaveLength(DOC.split('\n').length);
	});

	it('sets a list item and quotes values that need it', () => {
		expect(setScalarAt(DOC, 'spec.links.0', '25G')).toContain('    - 25G\n');
		expect(formatScalar('true')).toBe('"true"');
		expect(formatScalar('7220 IXR-D3L')).toBe('7220 IXR-D3L');
		expect(formatScalar(9000)).toBe('9000');
	});

	it('deletes a key with its block, renames and adds keys', () => {
		const deleted = deleteAt(DOC, 'spec.npp')!;
		expect(deleted).not.toContain('npp:');
		expect(deleted).not.toContain('mode: Normal');
		expect(renameKeyAt(DOC, 'spec.hostname', 'nodeName')).toContain('  nodeName: leaf1');
		const added = addUnder(DOC, 'spec', 'platform', '7220 IXR-D3L')!;
		expect((yaml.load(added) as { spec: Record<string, unknown> }).spec.platform).toBe(
			'7220 IXR-D3L'
		);
	});
});

describe('tryRuleFix', () => {
	it('fixes enum case and spelling from the schema', () => {
		expect(
			tryRuleFix(
				DOC,
				{ message: 'x', fieldPath: 'spec.operatingSystem', issueKind: 'enum' },
				SCHEMA
			)?.fixedDoc
		).toContain('operatingSystem: srl');
		expect(
			tryRuleFix(DOC, { message: 'x', fieldPath: 'spec.npp.mode', issueKind: 'enum' }, SCHEMA)
				?.fixedDoc
		).toContain('mode: normal');
	});

	it('coerces quoted numbers and booleans', () => {
		const doc = 'spec:\n  mtu: "9000"\n  enabled: "yes"\n';
		expect(
			tryRuleFix(doc, { message: 'x', fieldPath: 'spec.mtu', issueKind: 'type' }, SCHEMA)?.fixedDoc
		).toContain('mtu: 9000');
		expect(
			tryRuleFix(doc, { message: 'x', fieldPath: 'spec.enabled', issueKind: 'type' }, SCHEMA)
				?.fixedDoc
		).toContain('enabled: true');
	});

	it('removes unknown fields and renames misspelled ones', () => {
		expect(
			tryRuleFix(
				DOC,
				{ message: 'Unknown field', fieldPath: 'spec.hostname', issueKind: 'unknownField' },
				SCHEMA
			)?.fixedDoc
		).not.toContain('hostname');
		const rename = tryRuleFix(
			'spec:\n  versoin: "1"\n',
			{
				message: 'Misspelled field "spec.versoin" — use "spec.version" per the CRD schema',
				fieldPath: 'spec.versoin',
				issueKind: 'misspelledField'
			},
			SCHEMA
		)!;
		expect(rename.fixedDoc).toContain('version: "1"');
		expect(rename.suggestedFix).toEqual({
			action: 'renameKey',
			field: 'versoin',
			value: 'version'
		});
	});

	it('adds a required field only when the schema gives its value', () => {
		const fix = tryRuleFix(
			DOC,
			{ message: 'spec.platform is required', fieldPath: 'spec', issueKind: 'required' },
			SCHEMA
		);
		expect(fix?.fixedDoc).toContain('platform: 7220 IXR-D3L');
		expect(
			tryRuleFix(
				DOC,
				{ message: 'spec.version is required', fieldPath: 'spec', issueKind: 'required' },
				SCHEMA
			)
		).toBeNull();
	});

	it('leaves ambiguous or unknown answers to the AI', () => {
		const doc = 'spec:\n  operatingSystem: linux\n';
		expect(
			tryRuleFix(
				doc,
				{ message: 'x', fieldPath: 'spec.operatingSystem', issueKind: 'enum' },
				SCHEMA
			)
		).toBeNull();
	});
});

describe('one-line AI answers', () => {
	it('parses and applies SET and DELETE', () => {
		const set = parseFixPatch('FIXABLE: yes\nEXPLANATION: fixed\nCHANGE: SET spec.links[0] = 25G');
		expect(set.patch).toEqual({ op: 'set', path: 'spec.links.0', value: '25G' });
		expect(applyFixPatch(DOC, set.patch!)).toContain('- 25G');
		const del = parseFixPatch('FIXABLE: yes\nEXPLANATION: x\nCHANGE: `DELETE spec.hostname`');
		expect(applyFixPatch(DOC, del.patch!)).not.toContain('hostname');
		expect(parseFixPatch('FIXABLE: no\nEXPLANATION: unsure\nCHANGE: none').fixable).toBe(false);
	});

	it('adds a missing field under its parent', () => {
		const patch = parseFixPatch(
			'FIXABLE: yes\nEXPLANATION: x\nCHANGE: SET spec.platform = 7220 IXR-D3L'
		).patch!;
		expect(applyFixPatch(DOC, patch)).toContain('  platform: 7220 IXR-D3L');
	});

	it('retries a rejected one-line fix on the same small model, never the large one', async () => {
		const models: string[] = [];
		const answers = [
			'FIXABLE: yes\nEXPLANATION: x\nCHANGE: SET spec.operatingSystem = linux',
			'FIXABLE: yes\nEXPLANATION: x\nCHANGE: SET spec.operatingSystem = srl'
		];
		const result = await runVerifiedFix({
			prompt: { system: 's', user: 'u' },
			models: { default: 'small', fix: 'large' },
			initialModel: 'small',
			retryModel: 'small',
			run: async (model) => {
				models.push(model);
				return answers.shift()!;
			},
			parse: (a) => parsePatchAnswer(a, DOC),
			toFullDocument: (d) => d,
			verify: (d) =>
				d.includes('operatingSystem: srl') ? { ok: true } : { ok: false, reason: 'not allowed' }
		});
		expect(result.verified).toBe(true);
		expect(models).toEqual(['small', 'small']);
	});
});

describe('verifyFix for required fields', () => {
	it('checks the named field, its type and allowed values, not just the parent', async () => {
		const { verifyFix } = await import('./verifyFix');
		const schema = {
			type: 'object',
			properties: {
				localAS: { type: 'object', properties: { autonomousSystem: { type: 'integer' } } }
			}
		};
		const issue = {
			message: 'spec.localAS.autonomousSystem is required',
			fieldPath: 'spec.localAS',
			issueKind: 'required' as const
		};
		const originalDoc = 'kind: BGPGroup\nspec:\n  localAS:\n    note: x\n';
		const empty = verifyFix({
			originalDoc,
			fixedDoc: 'kind: BGPGroup\nspec:\n  localAS:\n    note: x\n    autonomousSystem: ""\n',
			issue,
			specSchema: schema
		});
		expect(empty.ok).toBe(false);
		const good = verifyFix({
			originalDoc,
			fixedDoc: 'kind: BGPGroup\nspec:\n  localAS:\n    note: x\n    autonomousSystem: 65000\n',
			issue,
			specSchema: schema
		});
		expect(good.ok).toBe(true);
	});
});

describe('more rule edits', () => {
	it('adds inside an empty flow mapping and inside a list item', () => {
		const flow = addUnder(
			'spec:\n  localAS: {}\n  peerAS:\n    autonomousSystem: 100\n',
			'spec.localAS',
			'autonomousSystem',
			65000
		)!;
		expect(yaml.load(flow)).toEqual({
			spec: { localAS: { autonomousSystem: 65000 }, peerAS: { autonomousSystem: 100 } }
		});
		const item = addUnder(
			'spec:\n  prefixes:\n    - exact: true\n',
			'spec.prefixes.0',
			'prefix',
			'192.0.2.0/24'
		)!;
		expect(yaml.load(item)).toEqual({
			spec: { prefixes: [{ exact: true, prefix: '192.0.2.0/24' }] }
		});
	});

	it('repairs a missing colon and a misaligned line', () => {
		const colon = tryRuleFix(
			'spec:\n  enabled true\n  mtu: 9000\n',
			{ message: 'YAML syntax error', issueKind: 'syntax' },
			null
		)!;
		expect(yaml.load(colon.fixedDoc)).toEqual({ spec: { enabled: true, mtu: 9000 } });
		const indent = tryRuleFix(
			'spec:\n  platform: x\n   version: "1"\n  os: srl\n',
			{ message: 'bad indentation', issueKind: 'syntax' },
			null
		)!;
		expect(yaml.load(indent.fixedDoc)).toEqual({
			spec: { platform: 'x', version: '1', os: 'srl' }
		});
	});

	it('does not overwrite a block with a one-line change', () => {
		const patch = parseFixPatch(
			'FIXABLE: yes\nEXPLANATION: x\nCHANGE: SET spec.npp = normal'
		).patch!;
		expect(applyFixPatch(DOC, patch)).toBeNull();
	});
});
