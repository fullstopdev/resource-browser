import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateOpenApiBulkDiffReport } from './diffEngine';

const source = { name: '26.4.3', label: '26.4.3', folder: 'openapi/26.4.3' };
const target = { name: '26.8.2', label: '26.8.2', folder: 'openapi/26.8.2' };

/** Serves static/ files; one spec never answers, like a stalled download. */
function fetcherWithStall(stalled: string): typeof fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith(stalled)) {
			return new Promise<Response>((_, reject) =>
				init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
			);
		}
		try {
			return new Response(readFileSync(`static${url}`), { status: 200 });
		} catch {
			return new Response('not found', { status: 404 });
		}
	}) as typeof fetch;
}

describe('generateOpenApiBulkDiffReport', () => {
	it('finishes when one spec never loads, marking only that API as an error', async () => {
		const progress: number[] = [];
		const report = await generateOpenApiBulkDiffReport(source, target, {
			fetcher: fetcherWithStall('/aaa.eda.nokia.com/v1/aaa.json'),
			timeoutMs: 50,
			onProgress: (current) => progress.push(current)
		});
		const errors = report.entries.filter((e) => e.status === 'error');
		expect(errors.map((e) => e.specId)).toEqual(['aaa.eda.nokia.com/v1']);
		expect(report.summary.modified).toBeGreaterThan(20);
		// Progress moves one spec at a time up to the total.
		expect(progress).toEqual(Array.from({ length: progress.length }, (_, i) => i + 1));
		expect(progress.at(-1)).toBe(30);
	});
});
