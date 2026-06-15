import { describe, expect, it } from 'vitest';
import { buildYamlHoverMarkdown, extractYamlLineKey } from './yamlHover';
import { resolveYamlFieldContext } from './yamlFieldContext';
import type { YamlCompletionContext } from './yamlSchemaKeys';
import type { BundleResource } from './types';

const fabricSpecSchema = {
	type: 'object',
	properties: {
		leafs: {
			type: 'object',
			properties: {
				asnPool: {
					type: 'string',
					description: 'Reference to an IndexAllocationPool pool to use for ASN allocations.'
				}
			},
			required: ['asnPool']
		}
	}
};

function mockCtx(): YamlCompletionContext {
	const resource: BundleResource = {
		id: 'eda/default/Fabric/lab',
		docIndex: 0,
		kind: 'Fabric',
		apiVersion: 'fabrics.eda.nokia.com/v1',
		group: 'fabrics.eda.nokia.com',
		version: 'v1',
		name: 'lab',
		namespace: 'eda',
		data: {},
		doc: { data: {}, rawText: '', startLine: 0, index: 0 }
	};

	return {
		resources: [resource],
		manifest: [
			{
				name: 'fabrics.fabrics.eda.nokia.com',
				kind: 'Fabric',
				group: 'fabrics.eda.nokia.com',
				versions: [{ name: 'v1' }]
			}
		],
		schemas: new Map([
			['/resources/26.4.2/fabrics.fabrics.eda.nokia.com/v1.yaml', { spec: fabricSpecSchema, isSpecRequired: true }]
		]),
		releaseFolder: 'resources/26.4.2'
	};
}

const YAML = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
  namespace: eda
spec:
  leafs:
    asnPool: `;

describe('extractYamlLineKey', () => {
	it('returns the full key when cursor is in the middle of the name', () => {
		const line = '    spineNodeSelectors:';
		expect(extractYamlLineKey(line, 18)).toBe('spineNodeSelectors');
	});

	it('returns undefined when cursor is in the value region', () => {
		const line = '    spineNodeSelectors: my-value';
		expect(extractYamlLineKey(line, 28)).toBeUndefined();
	});
});

describe('buildYamlHoverMarkdown', () => {
	it('shows manifest hint for apiVersion key', () => {
		const fieldCtx = resolveYamlFieldContext(YAML, 1, 11, null);
		expect(fieldCtx).not.toBeNull();
		const line = 'apiVersion: fabrics.eda.nokia.com/v1';
		const md = buildYamlHoverMarkdown(fieldCtx!, line, 11);
		expect(md).toContain('**apiVersion**');
		expect(md).toContain('Kubernetes API version');
	});

	it('shows schema description for spec field on value hover', () => {
		const ctx = mockCtx();
		const line = YAML.split('\n').find((l) => l.includes('asnPool:'))!;
		const lineNo = YAML.split('\n').findIndex((l) => l.includes('asnPool:')) + 1;
		const col = line.length;
		const fieldCtx = resolveYamlFieldContext(YAML, lineNo, col, ctx);
		expect(fieldCtx?.meta).toBeDefined();
		const md = buildYamlHoverMarkdown(fieldCtx!, line, col);
		expect(md).toContain('IndexAllocationPool');
	});

	it('shows full key name when hovering mid-key', () => {
		const ctx = mockCtx();
		const line = '    spineNodeSelectors:';
		const yaml = `${YAML.split('\n').slice(0, -1).join('\n')}\n  leafs:\n${line}`;
		const lineNo = yaml.split('\n').length;
		const fieldCtx = resolveYamlFieldContext(yaml, lineNo, 14, ctx);
		const md = buildYamlHoverMarkdown(fieldCtx!, line, 14);
		expect(md).toContain('**spineNodeSelectors**');
	});
});
