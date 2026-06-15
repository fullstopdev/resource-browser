import { describe, expect, it } from 'vitest';
import { firstParseIssueForInput } from './parser';

describe('firstParseIssueForInput', () => {
	it('returns null for valid YAML', () => {
		expect(firstParseIssueForInput('kind: Fabric\napiVersion: v1\n')).toBeNull();
	});

	it('returns issue for invalid YAML without waiting for validate', () => {
		const issue = firstParseIssueForInput('kind Fabric\nmetadata:\n  name: demo');
		expect(issue).not.toBeNull();
		expect(issue?.message).toMatch(/parsing error/i);
	});
});
