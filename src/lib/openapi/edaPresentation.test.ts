import { describe, expect, it } from 'vitest';
import {
	formatEdaCondition,
	formatEdaDefault,
	formatEdaVisibleIf,
	getEdaFieldPresentation,
	getEdaFieldSections,
	getEdaPresentationChips,
	getEdaPropertyLabel
} from './edaPresentation';

describe('edaPresentation', () => {
	it('prefers ui-title and keeps the raw name as secondary', () => {
		expect(getEdaPropertyLabel('enabled', { 'ui-title': 'Enabled' })).toEqual({
			title: 'Enabled',
			secondaryName: 'enabled'
		});
		expect(getEdaPropertyLabel('name', { 'ui-title': 'name' })).toEqual({ title: 'name' });
		expect(getEdaPropertyLabel('plain', null)).toEqual({ title: 'plain' });
	});

	it('formats visible-if as a human-readable condition', () => {
		expect(formatEdaVisibleIf('periodicSync === true')).toBe('shown when periodicSync === true');
		expect(formatEdaVisibleIf('  ')).toBe('');
		expect(formatEdaVisibleIf(undefined)).toBe('');
	});

	it('formats condition and default entries for chips/sections', () => {
		expect(formatEdaCondition({ condition: 'self.enabled === true' })).toBe(
			'self.enabled === true'
		);
		expect(
			formatEdaCondition({ condition: 'len(self.items) > 0', message: 'Need items' })
		).toBe('len(self.items) > 0 — Need items');
		expect(formatEdaDefault({ path: 'spec.replicas', value: 1 })).toBe('spec.replicas = 1');
		expect(formatEdaDefault('active')).toBe('active');
	});

	it('builds chips for high-signal EDA flags without dumping JSON', () => {
		const chips = getEdaPresentationChips({
			immutable: true,
			'ui-advanced': true,
			'ui-category': 'Certificate Authority',
			'ui-presence-toggle': true,
			'ui-unique-key': true,
			'ui-pattern-error': 'Must be a DNS label',
			'ui-auto-completes': [{ condition: 'true', kind: 'Node', type: 'label' }],
			'ui-conditions': [{ condition: 'self.enabled === true' }],
			'ui-defaults': [{ path: 'mode', value: 'auto' }],
			'ui-title': 'Name'
		});

		expect(chips.map((c) => c.id)).toEqual([
			'immutable',
			'presence',
			'advanced',
			'unique-key',
			'category',
			'pattern-error',
			'auto-complete',
			'conditions',
			'defaults'
		]);
		expect(chips.find((c) => c.id === 'category')?.label).toBe('Certificate Authority');
		expect(chips.find((c) => c.id === 'pattern-error')?.title).toBe('Must be a DNS label');
		expect(chips.find((c) => c.id === 'auto-complete')?.title).toContain('Node');
		expect(chips.find((c) => c.id === 'conditions')?.title).toContain('self.enabled');
		expect(chips.find((c) => c.id === 'defaults')?.title).toContain('mode = auto');
	});

	it('elevates auto-completes, conditions, and defaults into sections', () => {
		const sections = getEdaFieldSections({
			'ui-auto-completes': [{ kind: 'Node', type: 'label' }],
			'ui-conditions': [{ condition: 'self.enabled === true' }, 'self.count > 0'],
			'ui-defaults': [{ path: 'mode', value: 'auto' }]
		});

		expect(sections.map((s) => s.id)).toEqual(['auto-completes', 'conditions', 'defaults']);
		expect(sections.find((s) => s.id === 'conditions')?.items).toEqual([
			'self.enabled === true',
			'self.count > 0'
		]);
		expect(sections.find((s) => s.id === 'defaults')?.items).toEqual(['mode = auto']);
	});

	it('assembles a full field presentation for schema trees', () => {
		const presentation = getEdaFieldPresentation('periodicSync', {
			'ui-title': 'Periodic sync',
			'ui-visible-if': 'enabled === true',
			'ui-description': 'Run sync on a schedule.',
			'ui-summary': 'Optional schedule',
			'ui-single-line-group': 'periodic_sync',
			immutable: true,
			'ui-conditions': [{ condition: 'self.enabled === true' }],
			'ui-defaults': [{ path: 'interval', value: 30 }]
		});

		expect(presentation.label).toEqual({
			title: 'Periodic sync',
			secondaryName: 'periodicSync'
		});
		expect(presentation.visibleIfLabel).toBe('shown when enabled === true');
		expect(presentation.description).toBe('Run sync on a schedule.');
		expect(presentation.summary).toBe('Optional schedule');
		expect(presentation.group).toBe('periodic_sync');
		expect(presentation.chips.some((c) => c.id === 'immutable')).toBe(true);
		expect(presentation.chips.some((c) => c.id === 'conditions')).toBe(true);
		expect(presentation.chips.some((c) => c.id === 'defaults')).toBe(true);
		expect(presentation.sections.map((s) => s.id)).toEqual(['conditions', 'defaults']);
		expect(presentation.detailRows.map((r) => r.key)).not.toContain('ui-conditions');
		expect(presentation.detailRows.map((r) => r.key)).not.toContain('ui-defaults');
		expect(presentation.hasUiMetadata).toBe(true);
	});

	it('reports no UI metadata for empty extensions', () => {
		expect(getEdaFieldPresentation('x', null).hasUiMetadata).toBe(false);
		expect(getEdaFieldPresentation('x', {}).hasUiMetadata).toBe(false);
	});
});
