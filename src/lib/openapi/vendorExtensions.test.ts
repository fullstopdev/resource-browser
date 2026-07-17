import { describe, expect, it } from 'vitest';
import {
	extractVendorExtensions,
	extractSpecLevelExtensions,
	formatExtensionValue,
	hasVendorExtensions,
	parseEdaExtension,
	summarizeVendorExtensionsInSpec
} from './vendorExtensions';

describe('vendorExtensions', () => {
	it('parses x-eda-nokia-com shapes', () => {
		const eda = parseEdaExtension({
			immutable: true,
			'ui-order-priority': 10,
			'ui-title': 'Name',
			'ui-title-key': 'name',
			'ui-auto-completes': [{ condition: 'true', kind: 'KIND', type: 'label' }]
		});

		expect(eda?.immutable).toBe(true);
		expect(eda?.['ui-order-priority']).toBe(10);
		expect(eda?.['ui-auto-completes']).toHaveLength(1);
	});

	it('extracts and labels vendor extension fields', () => {
		const entries = extractVendorExtensions({
			'x-eda-nokia-com': {
				'ui-title': 'Enabled',
				'ui-visible-if': 'enabled === true'
			},
			'x-permissive': { allowUnknown: true }
		});

		expect(entries).toHaveLength(2);
		const eda = entries.find((e) => e.key === 'x-eda-nokia-com');
		expect(eda?.label).toBe('EDA extensions');
		expect(eda?.fields.map((f) => f.key)).toEqual(['ui-title', 'ui-visible-if']);
		expect(eda?.fields.find((f) => f.key === 'ui-title')?.label).toBe('UI title');
	});

	it('formats primitive and structured values', () => {
		expect(formatExtensionValue(true)).toEqual({ text: 'yes', valueType: 'boolean' });
		expect(formatExtensionValue(42)).toEqual({ text: '42', valueType: 'number' });
		expect(formatExtensionValue(['a', 'b']).valueType).toBe('json');
	});

	it('detects presence of vendor extensions', () => {
		expect(hasVendorExtensions({ 'x-eda-nokia-com': {} })).toBe(true);
		expect(hasVendorExtensions({ description: 'plain' })).toBe(false);
	});

	it('summarizes extension locations in a spec', () => {
		const spec = {
			'x-eda-nokia-com': { 'ui-title': 'Root' },
			info: { title: 'Demo', 'x-eda-nokia-com': { 'ui-title': 'Info' } },
			paths: {
				'/items': {
					get: {
						'x-permissive': { allowUnknown: true },
						responses: { '200': { description: 'ok' } }
					}
				}
			},
			components: {
				schemas: {
					Item: {
						type: 'object',
						properties: {
							name: {
								type: 'string',
								'x-eda-nokia-com': { 'ui-title': 'Name' }
							}
						}
					}
				}
			}
		};

		const summary = summarizeVendorExtensionsInSpec(spec);
		expect(summary.edaCount).toBe(3);
		expect(summary.pathLevel).toBe(1);
		expect(summary.schemaLevel).toBe(1);
		expect(summary.specLevel).toBe(2);

		const specLevel = extractSpecLevelExtensions(spec);
		expect(specLevel.map((e) => e.key)).toEqual(['x-eda-nokia-com']);
	});
});
