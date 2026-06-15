import { describe, expect, it } from 'vitest';
import {
	buildExampleYamlSnippet,
	formatCrdAnswer,
	formatExampleYamlAnswer,
	formatMultiCrdAnswer,
	formatRequiredFieldsAnswer,
	formatSchemaContextForLlm,
	formatSchemaSummaryForKv,
	assembleFullKvContext
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
			members: {
				type: 'array',
				description: 'List of member references for this interface.'
			},
			enabled: {
				type: 'boolean',
				description: 'Whether the interface is administratively enabled.'
			},
			description: { type: 'string', description: 'Optional human-readable label.' }
		},
		required: ['members', 'enabled']
	},
	statusSchema: { type: 'object', description: 'InterfaceStatus defines the observed state of Interface.' }
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

	it('formatExampleYamlAnswer wraps raw yaml in fenced block', () => {
		const answer = formatExampleYamlAnswer(
			{ kind: 'Fabric', group: 'fabrics.eda.nokia.com', release: '26.4.2' },
			'apiVersion: fabrics.eda.nokia.com/v1\nkind: Fabric',
			{ question: 'Example YAML for a Fabric in 26.4.2?' }
		);
		expect(answer).toContain('## Example manifest');
		expect(answer).toContain('```yaml');
		expect(answer).toContain('kind: Fabric');
		expect(answer).not.toContain('Schema fallback');
	});

	it('formatMultiCrdAnswer prefers kv example over explain for example questions', () => {
		const answer = formatMultiCrdAnswer(
			[
				{
					target: { kind: 'Fabric', group: 'fabrics.eda.nokia.com', release: '26.4.2' },
					kvAnswer: 'Long explain overview that should not appear',
					kvExample: 'apiVersion: fabrics.eda.nokia.com/v1\nkind: Fabric\nmetadata:\n  name: demo'
				}
			],
			{
				asksExample: true,
				question: 'Example YAML for a Fabric in 26.4.2?'
			}
		);
		expect(answer).toContain('kind: Fabric');
		expect(answer).not.toContain('Long explain overview');
	});

	it('formatSchemaSummaryForKv lists all required fields with descriptions', () => {
		const summary = formatSchemaSummaryForKv(interfaceSchema);
		expect(summary).toContain('## Schema summary');
		expect(summary).toContain('`members`');
		expect(summary).toContain('`enabled`');
		expect(summary).toContain('### Required spec fields');
		expect(summary).toContain('member references');
	});

	it('assembleFullKvContext combines schema, explain, and example', () => {
		const full = assembleFullKvContext({
			schemaSummary: '## Schema summary\nfields',
			explain: 'Overview text',
			example: 'apiVersion: v1\nkind: Interface'
		});
		expect(full).toContain('Schema summary');
		expect(full).toContain('Cached CRD explanation');
		expect(full).toContain('Cached example YAML');
		expect(full).toContain('kind: Interface');
	});

	it('formatRequiredFieldsAnswer lists real Interface spec field names', () => {
		const answer = formatRequiredFieldsAnswer(interfaceSchema, {
			question: 'Required fields for Interface in 26.4.2?'
		});
		expect(answer).toContain('## Required fields');
		expect(answer).toContain('`members`');
		expect(answer).toContain('`enabled`');
		expect(answer).not.toMatch(/@@MD\d+@@/);
	});
});
