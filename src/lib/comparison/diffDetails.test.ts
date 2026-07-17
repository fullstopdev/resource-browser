import { describe, expect, it } from 'vitest';
import {
	buildDiffDetailLine,
	buildSideBySideRows,
	findDetailLineIndex,
	parseDiffLine,
	syntheticPathDetailLine
} from './diffDetails';

describe('parseDiffLine', () => {
	it('extracts before and after from enriched modify lines', () => {
		const parsed = parseDiffLine('~ Modified: spec.mode :: "a" → "b"');
		expect(parsed.type).toBe('modify');
		expect(parsed.path).toBe('spec.mode');
		expect(parsed.before).toBe('"a"');
		expect(parsed.after).toBe('"b"');
		expect(parsed.section).toBe('spec');
	});

	it('parses legacy modify lines without values', () => {
		const parsed = parseDiffLine('~ Modified: status.phase');
		expect(parsed.path).toBe('status.phase');
		expect(parsed.before).toBeUndefined();
	});

	it('extracts values from added and removed lines with ::', () => {
		const added = parseDiffLine('+ Added: properties.foo :: {"type":"string"}');
		expect(added.type).toBe('add');
		expect(added.path).toBe('properties.foo');
		expect(added.after).toBe('{"type":"string"}');

		const removed = parseDiffLine('- Removed: properties.bar :: {"type":"integer"}');
		expect(removed.type).toBe('remove');
		expect(removed.path).toBe('properties.bar');
		expect(removed.before).toBe('{"type":"integer"}');
	});
});

describe('buildSideBySideRows', () => {
	it('shows before on the left and after on the right for modifications', () => {
		const rows = buildSideBySideRows([
			parseDiffLine(
				'~ Modified: operationId :: "listOamEdaNokiaComV1alpha1Mirrors" → "listOamEdaNokiaComV1Mirrors"'
			)
		]);
		expect(rows).toHaveLength(1);
		expect(rows[0].left).toBe('operationId: "listOamEdaNokiaComV1alpha1Mirrors"');
		expect(rows[0].right).toBe('operationId: "listOamEdaNokiaComV1Mirrors"');
		expect(rows[0].leftType).toBe('modify');
		expect(rows[0].rightType).toBe('modify');
	});
});

describe('buildDiffDetailLine', () => {
	it('builds added, removed, and modified detail strings', () => {
		expect(buildDiffDetailLine({ field: 'spec.foo', kind: 'added', after: '"bar"' })).toBe(
			'+ Added: spec.foo :: "bar"'
		);
		expect(buildDiffDetailLine({ field: 'spec.foo', kind: 'removed', before: '"bar"' })).toBe(
			'- Removed: spec.foo :: "bar"'
		);
		expect(
			buildDiffDetailLine({ field: 'spec.mode', kind: 'modified', before: '"a"', after: '"b"' })
		).toBe('~ Modified: spec.mode :: "a" → "b"');
		expect(syntheticPathDetailLine('added', '/v1/widgets')).toBe('+ Added: /v1/widgets');

		const details = ['~ Modified: spec.mode :: "a" → "b"', '+ Added: spec.other'];
		const parsed = parseDiffLine('~ Modified: spec.mode :: "a" → "b"');
		expect(findDetailLineIndex(details, parsed)).toBe(1);
	});
});
