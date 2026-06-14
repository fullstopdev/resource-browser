import { describe, expect, it } from 'vitest';
import {
	breadcrumbPath,
	breadcrumbSegmentPairs,
	edgeConnectsPair,
	historyAfterBreadcrumb,
	historyAfterRefocus,
	normalizeFocusHistory
} from './drillDown';

describe('drillDown', () => {
	it('appends current focus when refocusing on a neighbor', () => {
		expect(historyAfterRefocus([], 'fabric', 'keychain')).toEqual(['fabric']);
		expect(historyAfterRefocus(['fabric'], 'keychain', 'defaultbgpgroup')).toEqual([
			'fabric',
			'keychain'
		]);
	});

	it('builds a five-step drill-down trail', () => {
		const chain = ['Policy', 'BGPPeer', 'Keychain', 'BGPGroup', 'VirtualNetwork'] as const;
		let focusHistory: string[] = [];
		let focusNodeId: (typeof chain)[number] = chain[0];

		for (let i = 1; i < chain.length; i++) {
			const targetId = chain[i];
			focusHistory = historyAfterRefocus(focusHistory, focusNodeId, targetId);
			focusNodeId = targetId;
		}

		expect(focusHistory).toEqual(['Policy', 'BGPPeer', 'Keychain', 'BGPGroup']);
		expect(breadcrumbPath(focusHistory, focusNodeId)).toEqual([...chain]);
	});

	it('truncates instead of duplicating when refocusing to a node already on the trail', () => {
		expect(historyAfterRefocus(['fabric', 'keychain'], 'defaultbgpgroup', 'keychain')).toEqual([
			'fabric'
		]);
		expect(historyAfterRefocus(['fabric'], 'keychain', 'fabric')).toEqual([]);
	});

	it('returns unchanged history when refocusing to the current focus', () => {
		expect(historyAfterRefocus(['fabric'], 'keychain', 'keychain')).toEqual(['fabric']);
	});

	it('recovers from duplicate history entries caused by stale refocus races', () => {
		expect(historyAfterRefocus(['Policy', 'Policy'], 'Policy', 'BGPPeer')).toEqual(['Policy']);
		expect(breadcrumbPath(['Policy', 'Policy'], 'BGPPeer')).toEqual(['Policy', 'BGPPeer']);
	});

	it('prevents Policy → BGPPeer → Policy → BGPPeer loops', () => {
		let focusHistory: string[] = [];
		let focusNodeId = 'Policy';

		focusHistory = historyAfterRefocus(focusHistory, focusNodeId, 'BGPPeer');
		focusNodeId = 'BGPPeer';
		expect(breadcrumbPath(focusHistory, focusNodeId)).toEqual(['Policy', 'BGPPeer']);

		focusHistory = historyAfterRefocus(focusHistory, focusNodeId, 'Policy');
		focusNodeId = 'Policy';
		expect(breadcrumbPath(focusHistory, focusNodeId)).toEqual(['Policy']);

		// Simulate a stale second refocus before focus updates.
		focusHistory = historyAfterRefocus(focusHistory, 'Policy', 'BGPPeer');
		focusNodeId = 'BGPPeer';
		expect(focusHistory).toEqual(['Policy']);
		expect(breadcrumbPath(focusHistory, focusNodeId)).toEqual(['Policy', 'BGPPeer']);

		focusHistory = historyAfterRefocus(focusHistory, focusNodeId, 'Policy');
		focusNodeId = 'Policy';
		expect(breadcrumbPath(focusHistory, focusNodeId)).toEqual(['Policy']);
	});

	it('normalizes history by removing current focus and consecutive duplicates', () => {
		expect(normalizeFocusHistory(['Policy', 'Policy', 'BGPPeer'], 'BGPPeer')).toEqual([
			'Policy'
		]);
		expect(normalizeFocusHistory(['Policy', 'BGPPeer', 'Policy'], 'Policy')).toEqual(['BGPPeer']);
	});

	it('rewinds history when breadcrumb navigates to an ancestor', () => {
		const history = historyAfterBreadcrumb(['fabric'], 'keychain', 'fabric');
		expect(history).toEqual([]);

		const deeper = historyAfterBreadcrumb(
			['fabric', 'keychain'],
			'defaultbgpgroup',
			'keychain'
		);
		expect(deeper).toEqual(['fabric']);
	});

	it('builds breadcrumb path from history and current focus', () => {
		expect(breadcrumbPath([], 'fabric')).toEqual(['fabric']);
		expect(breadcrumbPath(['fabric'], 'keychain')).toEqual(['fabric', 'keychain']);
	});

	it('returns null when breadcrumb target is current focus', () => {
		expect(historyAfterBreadcrumb(['fabric'], 'keychain', 'keychain')).toBeNull();
	});

	it('builds segment pairs for path highlighting', () => {
		expect(breadcrumbSegmentPairs(['fabric'])).toEqual([]);
		expect(breadcrumbSegmentPairs(['fabric', 'keychain'])).toEqual([
			{ from: 'fabric', to: 'keychain' }
		]);
		expect(
			breadcrumbSegmentPairs(['fabric', 'keychain', 'defaultbgpgroup'])
		).toEqual([
			{ from: 'fabric', to: 'keychain' },
			{ from: 'keychain', to: 'defaultbgpgroup' }
		]);
	});

	it('matches edges in either direction', () => {
		expect(edgeConnectsPair('a', 'b', 'a', 'b')).toBe(true);
		expect(edgeConnectsPair('b', 'a', 'a', 'b')).toBe(true);
		expect(edgeConnectsPair('a', 'c', 'a', 'b')).toBe(false);
	});
});
