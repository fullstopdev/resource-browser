import { describe, expect, it } from 'vitest';
import {
	breadcrumbPath,
	historyAfterBreadcrumb,
	historyAfterRefocus
} from './drillDown';

describe('drillDown', () => {
	it('appends current focus when refocusing on a neighbor', () => {
		expect(historyAfterRefocus([], 'fabric')).toEqual(['fabric']);
		expect(historyAfterRefocus(['fabric'], 'keychain')).toEqual(['fabric', 'keychain']);
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
});
