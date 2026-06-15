import { describe, expect, it } from 'vitest';
import { promptFixYaml, promptFixYamlSyntax } from './actionPrompts';
import type { AiSchemaPayload } from './loadAiSchema';

const schema: AiSchemaPayload = {
	apiVersion: 'fabrics.eda.nokia.com/v1',
	kind: 'Fabric',
	group: 'fabrics.eda.nokia.com',
	release: '26.4.2',
	deprecated: false,
	specSchema: { type: 'object' },
	statusSchema: null,
	specRequired: ['os'],
	statusRequired: [],
	resourceName: 'fabrics.eda.nokia.com',
	version: 'v1'
};

describe('promptFixYaml', () => {
	it('includes issue context and document YAML', () => {
		const prompt = promptFixYaml('26.4.2', 'Fabric', schema, 'kind: Fabric\n', {
			message: 'spec.os must be srl or sros',
			fieldPath: 'spec.os',
			line: 8,
			severity: 'error'
		});

		expect(prompt.user).toContain('spec.os must be srl or sros');
		expect(prompt.user).toContain('Field: spec.os');
		expect(prompt.user).toContain('kind: Fabric');
		expect(prompt.user).toContain('FIXABLE:');
	});

	it('syntax prompt works without CRD schema', () => {
		const prompt = promptFixYamlSyntax('26.4.2', 'kind Fabric\n', {
			message: 'YAML parsing error at line 1',
			line: 1
		});
		expect(prompt.user).toContain('YAML parsing error');
		expect(prompt.user).toContain('kind Fabric');
	});
});
