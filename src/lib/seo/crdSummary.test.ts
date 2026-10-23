import { describe, expect, it } from 'vitest';
import { buildCrdSeoSummary, crdJsonLd } from './crdSummary';

const sections = {
	spec: {
		description: 'BridgeDomain is the Schema for the bridgedomains API. It creates an L2 domain.',
		required: ['type'],
		properties: {
			type: { type: 'string' },
			evi: { type: 'integer' },
			macLearning: { type: 'object' }
		}
	},
	status: undefined,
	topLevel: {},
	isSpecRequired: true
};

describe('CRD SEO summary', () => {
	it('uses the CRD description and lists required fields first', () => {
		const summary = buildCrdSeoSummary({
			kind: 'BridgeDomain',
			group: 'services.eda.nokia.com',
			version: 'v2',
			release: '26.8.2',
			sections
		});
		expect(summary.description).toContain('creates an L2 domain');
		expect(summary.fields.map((f) => f.name)).toEqual(['type', 'evi', 'macLearning']);
		expect(summary.fields[0]).toEqual({ name: 'type', type: 'string', required: true });
	});

	it('produces JSON-LD that cannot break out of its script tag', () => {
		const summary = buildCrdSeoSummary({
			kind: 'X',
			group: 'g',
			version: 'v1',
			release: 'r',
			sections: {
				...sections,
				spec: { ...sections.spec, description: 'evil </script><script>alert(1)' }
			}
		});
		const json = crdJsonLd(summary, 'https://example.com/?crd=X');
		expect(json).not.toContain('</script>');
		expect(JSON.parse(json)).toMatchObject({ '@type': 'TechArticle', about: 'X (g/v1)' });
	});
});
