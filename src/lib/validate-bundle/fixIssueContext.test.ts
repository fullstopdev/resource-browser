import { describe, expect, it } from 'vitest';
import {
	isDeterministicFixContext,
	suggestedFixFromFixContext
} from './fixIssueContext';

describe('deterministic fix context helpers', () => {
	it('detects deterministic contexts from hints and flags', () => {
		expect(isDeterministicFixContext({})).toBe(false);
		expect(isDeterministicFixContext({ deterministicFixAvailable: true })).toBe(true);
		expect(isDeterministicFixContext({ renameHint: { from: 'a', to: 'b' } })).toBe(true);
		expect(isDeterministicFixContext({ relocationHint: { from: 'spec.a', to: 'spec.b' } })).toBe(
			true
		);
		expect(
			isDeterministicFixContext({
				suggestedFix: { field: 'x', value: 'y', action: 'setValue' }
			})
		).toBe(true);
	});

	it('converts rename and relocation hints to suggestedFix', () => {
		expect(
			suggestedFixFromFixContext(
				{ renameHint: { from: 'protocol', to: 'protocols' } },
				{ line: 4 }
			)
		).toEqual({
			action: 'renameKey',
			field: 'protocol',
			value: 'protocols',
			line: 4
		});

		expect(
			suggestedFixFromFixContext(
				{
					relocationHint: {
						from: 'spec.tunnelIndexPool',
						to: 'spec.encapOptions.vxlan.tunnelIndexPool'
					}
				},
				{ line: 9, fieldPath: 'spec.tunnelIndexPool' }
			)
		).toEqual({
			action: 'relocateField',
			field: 'spec.tunnelIndexPool',
			value: 'spec.encapOptions.vxlan.tunnelIndexPool',
			line: 9
		});
	});

	it('prefers explicit suggestedFix over hints', () => {
		expect(
			suggestedFixFromFixContext({
				suggestedFix: { field: 'mode', value: 'active', action: 'setValue' },
				renameHint: { from: 'a', to: 'b' }
			})
		).toEqual({
			action: 'setValue',
			field: 'mode',
			value: 'active',
			line: undefined
		});
	});
});
