import { describe, expect, it } from 'vitest';
import {
	buildExampleYamlSnippet,
	formatCrdAnswer,
	formatSchemaContextForLlm
} from './formatAnswer';
import type { AiSchemaPayload } from './loadAiSchema';

const policySchema: AiSchemaPayload = {
	apiVersion: 'routingpolicies.eda.nokia.com/v1',
	kind: 'Policy',
	group: 'routingpolicies.eda.nokia.com',
	release: '26.4.2',
	deprecated: false,
	resourceName: 'policys.routingpolicies.eda.nokia.com',
	version: 'v1',
	specRequired: [],
	statusRequired: [],
	specSchema: {
		description:
			'Policy defines a set of rules and actions to manage network traffic or routing behavior.',
		properties: {
			configuredName: { type: 'string', description: 'The name of the policy to configure on the device.' },
			statements: {
				type: 'array',
				description: 'List of policy statements.',
				items: {
					type: 'object',
					required: ['name'],
					properties: {
						name: { type: 'string', description: 'Name of the policy statement.' }
					}
				}
			}
		}
	},
	statusSchema: { type: 'object', description: 'PolicyStatus defines the observed state of Policy.' }
};

describe('formatAnswer', () => {
	it('formats Policy CRD with markdown sections', () => {
		const answer = formatCrdAnswer(policySchema);
		expect(answer).toContain('## Overview');
		expect(answer).toContain('**Policy**');
		expect(answer).toContain('routingpolicies.eda.nokia.com/v1');
		expect(answer).toContain('## Key fields');
		expect(answer).toContain('`configuredName`');
		expect(answer).toContain('## Example manifest');
		expect(answer).toContain('```yaml');
		expect(answer).toContain('kind: Policy');
	});

	it('buildExampleYamlSnippet uses correct apiGroup for Policy', () => {
		const yaml = buildExampleYamlSnippet(policySchema);
		expect(yaml).toContain('apiVersion: routingpolicies.eda.nokia.com/v1');
		expect(yaml).toContain('kind: Policy');
	});

	it('formatSchemaContextForLlm includes group for disambiguation', () => {
		const ctx = formatSchemaContextForLlm(policySchema);
		expect(ctx).toContain('routingpolicies.eda.nokia.com');
		expect(ctx).toContain('policys.routingpolicies.eda.nokia.com');
	});
});
