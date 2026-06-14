import { describe, expect, it } from 'vitest';
import {
	buildRagEmbeddingQuery,
	crdChunkMatchesFilters,
	docsReleaseForCrd,
	isRagSufficient,
	MIN_CHUNK_SCORE,
	MIN_RAG_SCORE
} from './retrieve';
import { resourceBrowserPathFromMetadata } from './resourceLinks';

describe('isRagSufficient', () => {
	it('requires 3+ chunks or a high top score', () => {
		expect(isRagSufficient(3, 0.5)).toBe(true);
		expect(isRagSufficient(1, MIN_RAG_SCORE)).toBe(true);
		expect(isRagSufficient(2, 0.6)).toBe(false);
		expect(isRagSufficient(0, 0)).toBe(false);
	});
});

describe('docsReleaseForCrd', () => {
	it('maps patch release to docs major.minor', () => {
		expect(docsReleaseForCrd('26.4.2')).toBe('26.4');
		expect(docsReleaseForCrd('25.12.3')).toBe('25.12');
	});
});

describe('resourceBrowserPathFromMetadata', () => {
	it('builds CRD detail URL from vectorize path', () => {
		expect(
			resourceBrowserPathFromMetadata(
				'26.4.2',
				'/resources/26.4.2/policies.core.eda.nokia.com/v1.yaml'
			)
		).toBe('/policies.core.eda.nokia.com/v1?release=26.4.2');
	});
});

describe('MIN_CHUNK_SCORE', () => {
	it('is a sensible cosine floor', () => {
		expect(MIN_CHUNK_SCORE).toBeGreaterThan(0.4);
		expect(MIN_CHUNK_SCORE).toBeLessThan(MIN_RAG_SCORE);
	});
});

describe('crdChunkMatchesFilters', () => {
	it('rejects PolicyAttachment when target is Policy + routingpolicies', () => {
		const filters = {
			release: '26.4.2',
			kind: 'Policy',
			group: 'routingpolicies.eda.nokia.com'
		};
		expect(
			crdChunkMatchesFilters(
				{ kind: 'PolicyAttachment', group: 'core.eda.nokia.com', release: '26.4.2' },
				filters
			)
		).toBe(false);
		expect(
			crdChunkMatchesFilters(
				{ kind: 'Policy', group: 'routingpolicies.eda.nokia.com', release: '26.4.2' },
				filters
			)
		).toBe(true);
	});
});

describe('buildRagEmbeddingQuery', () => {
	it('includes kind and group in embedding text', () => {
		const q = buildRagEmbeddingQuery('What is the Policy CRD?', {
			release: '26.4.2',
			kind: 'Policy',
			group: 'routingpolicies.eda.nokia.com'
		});
		expect(q).toContain('kind Policy');
		expect(q).toContain('routingpolicies.eda.nokia.com');
	});
});
