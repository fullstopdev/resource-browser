import { describe, expect, it } from 'vitest';
import {
	classifyEnumModification,
	classifyFieldChangeType,
	detailToFieldChange,
	enumValueDelta,
	isManifestBreakingChange,
	networkBehaviorForChange
} from './fieldChangeClassifier';
import { parseDiffLine } from './diffDetails';

describe('enum diff classification', () => {
	it('classifies add-only enum growth as enum_added', () => {
		const parsed = parseDiffLine(
			'~ Modified: spec.option.enum :: ["A"] → ["A","B"]'
		);
		expect(classifyFieldChangeType(parsed)).toBe('enum_added');
		expect(enumValueDelta(parsed.before, parsed.after)).toEqual({
			added: ['B'],
			removed: []
		});
	});

	it('classifies remove-only enum shrink as enum_removed', () => {
		const parsed = parseDiffLine(
			'~ Modified: spec.option.enum :: ["A","B"] → ["A"]'
		);
		expect(classifyFieldChangeType(parsed)).toBe('enum_removed');
		expect(enumValueDelta(parsed.before, parsed.after)).toEqual({
			added: [],
			removed: ['B']
		});
	});

	it('classifies simultaneous add and remove as enum_changed', () => {
		const parsed = parseDiffLine('~ Modified: spec.option.enum :: ["A"] → ["B"]');
		expect(classifyFieldChangeType(parsed)).toBe('enum_changed');
		expect(enumValueDelta(parsed.before, parsed.after)).toEqual({
			added: ['B'],
			removed: ['A']
		});
	});

	it('classifies Topology dhcp6Options enum growth correctly', () => {
		const detail =
			'~ Modified: spec.dhcp.properties.dhcp6Options.items.properties.option.enum :: ["59-BootfileUrl"] → ["59-BootfileUrl","56-NTPServers"]';
		const change = detailToFieldChange(detail, 'NodeProfile')!;

		expect(change.changeType).toBe('enum_added');
		expect(change.networkBehavior).toContain('gained allowed value(s)');
		expect(change.networkBehavior).toContain('56-NTPServers');
		expect(isManifestBreakingChange(change)).toBe(false);
	});

	it('marks enum_removed and enum_changed as breaking', () => {
		const removed = detailToFieldChange(
			'~ Modified: spec.option.enum :: ["A","B"] → ["A"]',
			'Widget'
		)!;
		const changed = detailToFieldChange(
			'~ Modified: spec.option.enum :: ["A"] → ["B"]',
			'Widget'
		)!;

		expect(isManifestBreakingChange(removed)).toBe(true);
		expect(isManifestBreakingChange(changed)).toBe(true);
	});

	it('describes enum impact with added and removed values', () => {
		expect(
			networkBehaviorForChange(
				'enum_added',
				'spec.option.enum',
				'NodeProfile',
				'["A"]',
				'["A","B"]'
			)
		).toContain('gained allowed value(s): B');

		expect(
			networkBehaviorForChange(
				'enum_removed',
				'spec.option.enum',
				'NodeProfile',
				'["A","B"]',
				'["A"]'
			)
		).toContain('dropped allowed value(s): B');

		expect(
			networkBehaviorForChange(
				'enum_changed',
				'spec.option.enum',
				'NodeProfile',
				'["A"]',
				'["B"]'
			)
		).toContain('added: B');
		expect(
			networkBehaviorForChange('enum_changed', 'spec.option.enum', 'NodeProfile', '["A"]', '["B"]')
		).toContain('removed: A');
	});

	it('classifies newly added enum property as enum_added', () => {
		const parsed = parseDiffLine('+ Added: spec.option.enum');
		expect(classifyFieldChangeType(parsed)).toBe('enum_added');
	});

	it('falls back to enum_changed when values are not parseable arrays', () => {
		expect(classifyEnumModification('not-json', '["A"]')).toBe('enum_changed');
	});
});
