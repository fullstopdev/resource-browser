import { describe, expect, it } from 'vitest';
import { enrichAnswerLinks } from './enrichAnswerLinks';

describe('enrichAnswerLinks', () => {
	it('returns structured links without appending markdown footer', () => {
		const result = enrichAnswerLinks({
			answer: '## Required fields\n\n- `members`',
			release: '26.4.2',
			targets: [
				{
					kind: 'Policy',
					group: 'routingpolicies.eda.nokia.com',
					name: 'policys.routingpolicies.eda.nokia.com',
					version: 'v1'
				}
			],
			origin: 'https://example.com'
		});

		expect(result.answer).not.toContain('## Related in EDA');
		expect(result.answer).toBe('## Required fields\n\n- `members`');
		expect(result.relatedLinks).toHaveLength(2);
		expect(result.relatedLinks[0].type).toBe('crd');
		expect(result.relatedLinks[0].href).toContain('/?release=26.4.2&crd=Policy&version=v1');
		expect(result.relatedLinks[1].type).toBe('dependency-map');
		expect(result.relatedLinks[1].href).toBe(
			'/dependency-map?release=26.4.2&resource=policys.routingpolicies.eda.nokia.com&group=routingpolicies.eda.nokia.com'
		);
	});
});
