import { describe, expect, it } from 'vitest';
import {
	filterSwaggerTaggedOperations,
	operationMatchesSwaggerFilter
} from './swaggerOpsFilter';

describe('operationMatchesSwaggerFilter', () => {
	const eqlGet = {
		path: '/core/query/v1/eql',
		summary: 'Query request using the EDA query language',
		description: 'Streaming API for EDA query language',
		operationId: 'queryGetEqlQuery',
		method: 'get'
	};

	it('matches path segments like eql', () => {
		expect(operationMatchesSwaggerFilter(eqlGet, 'coreQuery', 'eql')).toBe(true);
	});

	it('matches tag names', () => {
		expect(operationMatchesSwaggerFilter(eqlGet, 'coreQuery', 'corequery')).toBe(true);
	});

	it('matches summaries and operation ids', () => {
		expect(operationMatchesSwaggerFilter(eqlGet, 'coreQuery', 'eda query')).toBe(true);
		expect(operationMatchesSwaggerFilter(eqlGet, 'coreQuery', 'queryGetEql')).toBe(true);
	});

	it('matches HTTP methods', () => {
		expect(operationMatchesSwaggerFilter(eqlGet, 'coreQuery', 'GET')).toBe(true);
	});

	it('returns false when nothing matches', () => {
		expect(operationMatchesSwaggerFilter(eqlGet, 'coreQuery', 'zzznomatch')).toBe(false);
	});

	it('returns true for empty filter phrase', () => {
		expect(operationMatchesSwaggerFilter(eqlGet, 'coreQuery', '')).toBe(true);
		expect(operationMatchesSwaggerFilter(eqlGet, 'coreQuery', '   ')).toBe(true);
	});
});

describe('filterSwaggerTaggedOperations', () => {
	function makeTaggedOps(
		groups: Array<{ tag: string; operations: Array<Record<string, string>> }>
	) {
		return {
			map(mapper: (tagObj: { get: (k: string) => unknown; set: (k: string, v: unknown) => unknown }, tag: string) => unknown) {
				const mapped = groups.map(({ tag, operations }) => {
					const tagObj = {
						get(field: string) {
							if (field === 'operations') {
								return {
									filter(predicate: (op: { get: (k: string) => unknown }) => boolean) {
										return operations.filter((op) =>
											predicate({
												get(key: string) {
													return op[key];
												}
											})
										);
									},
									size: operations.length
								};
							}
							return undefined;
						},
						set(field: string, value: unknown) {
							if (field !== 'operations') return this;
							const ops = value as Array<Record<string, string>>;
							return {
								get(f: string) {
									if (f === 'operations') {
										return { size: ops.length };
									}
									return undefined;
								},
								set: this.set
							};
						}
					};
					return mapper(tagObj, tag);
				});
				return {
					filter(predicate: (tagObj: { get: (k: string) => { size: number } }) => boolean) {
						return mapped.filter((tagObj) => predicate(tagObj as { get: (k: string) => { size: number } }));
					}
				};
			},
			filter() {
				return this;
			}
		};
	}

	it('keeps only operations whose paths match the phrase', () => {
		const taggedOps = makeTaggedOps([
			{
				tag: 'coreQuery',
				operations: [
					{
						path: '/core/query/v1/eql',
						summary: 'EQL query',
						description: '',
						operationId: 'queryGetEqlQuery',
						method: 'get'
					},
					{
						path: '/core/query/v1/nql',
						summary: 'NQL query',
						description: '',
						operationId: 'queryGetNqlQuery',
						method: 'get'
					}
				]
			}
		]);

		const result = filterSwaggerTaggedOperations(taggedOps, 'eql') as {
			filter: (predicate: (tagObj: { get: (k: string) => { size: number } }) => boolean) => unknown[];
		};
		const kept = result.filter((tagObj) => tagObj.get('operations').size > 0);
		expect(kept).toHaveLength(1);
	});
});
