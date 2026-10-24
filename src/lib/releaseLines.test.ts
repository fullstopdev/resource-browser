import { describe, expect, it } from 'vitest';
import { releaseLines, splitReleaseLines } from './releaseLines';

const names = [
	'25.4.2',
	'26.8.1',
	'25.12.3',
	'26.4.1',
	'26.8.2',
	'25.8.1',
	'25.12.1',
	'26.4.3',
	'25.8.3',
	'26.4.2'
];
const releases = names.map((name) => ({ name }));

describe('releaseLines', () => {
	it('groups by line, newest line and newest patch first', () => {
		const lines = releaseLines(releases);
		expect(lines.map((l) => l.line)).toEqual(['26.8', '26.4', '25.12', '25.8', '25.4']);
		expect(lines[1]!.releases.map((r) => r.name)).toEqual(['26.4.3', '26.4.2', '26.4.1']);
	});
});

describe('splitReleaseLines', () => {
	it('features the latest patch of four lines and puts the rest in "more"', () => {
		const { featured, more } = splitReleaseLines(releases);
		expect(featured.map((l) => l.releases[0]!.name)).toEqual([
			'26.8.2',
			'26.4.3',
			'25.12.3',
			'25.8.3'
		]);
		expect(more.flatMap((l) => l.releases.map((r) => r.name))).toEqual([
			'26.8.1',
			'26.4.2',
			'26.4.1',
			'25.12.1',
			'25.8.1',
			'25.4.2'
		]);
	});

	it('handles fewer lines than slots', () => {
		const { featured, more } = splitReleaseLines([{ name: '26.8.1' }]);
		expect(featured).toHaveLength(1);
		expect(more).toEqual([]);
	});
});
