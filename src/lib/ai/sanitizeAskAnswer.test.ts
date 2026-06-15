import { describe, expect, it } from 'vitest';
import { sanitizeAskAnswer, stripRelatedSection } from './sanitizeAskAnswer';

describe('sanitizeAskAnswer', () => {
	it('strips Related in EDA section and source citations', () => {
		const raw = `The Interface CRD requires members. [Source: KV summary]

## Required fields
- \`members\`

## Related in EDA
- [Open Interface spec](/?release=26.4.2&crd=Interface)`;

		expect(sanitizeAskAnswer(raw, 'required_fields')).toBe(
			`The Interface CRD requires members.

## Required fields
- \`members\``
		);
	});

	it('drops Overview when intent is required_fields', () => {
		const raw = `Short intro.

## Overview
Long tour.

## Required fields
- \`enabled\``;

		expect(sanitizeAskAnswer(raw, 'required_fields')).toBe(
			`Short intro.

## Required fields
- \`enabled\``
		);
	});

	it('stripRelatedSection removes footer only', () => {
		expect(stripRelatedSection('Answer\n\n## Related in EDA\n- link')).toBe('Answer');
	});
});
