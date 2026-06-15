import { describe, expect, it } from 'vitest';
import { enrichAnswerLinks } from './enrichAnswerLinks';

describe('enrichAnswerLinks', () => {
	it('appends Related in EDA footer with CRD and map links', () => {
		const result = enrichAnswerLinks({
			answer: '## Overview\n\nPolicy routes traffic.',
			release: '26.4.2',
			targets: [
				{
					kind: 'Policy',
					group: 'routingpolicies.eda.nokia.com',
					name: 'policys.routingpolicies.eda.nokia.com'
				}
			],
			origin: 'https://example.com'
		});

		expect(result.answer).toContain('## Related in EDA');
		expect(result.answer).toContain('[Open Policy spec]');
		expect(result.answer).toContain('intent topology');
		expect(result.relatedLinks).toHaveLength(2);
		expect(result.relatedLinks[0].type).toBe('crd');
	});
});
