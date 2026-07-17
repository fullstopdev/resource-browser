/** Fields Swagger UI exposes on each operation when filtering tagged ops. */
export type SwaggerFilterOperation = {
	path?: string;
	summary?: string;
	description?: string;
	operationId?: string;
	method?: string;
};

type ImmutableOperation = { get(field: string): unknown };
type ImmutableTagGroup = { get(field: string): unknown; set(field: string, value: unknown): ImmutableTagGroup };
type ImmutableTaggedOps = {
	filter(predicate: (tagObj: ImmutableTagGroup) => boolean): ImmutableTaggedOps;
	map(
		mapper: (tagObj: ImmutableTagGroup, tag: string) => ImmutableTagGroup
	): ImmutableTaggedOps;
};

/** Case-insensitive match for Swagger UI filter input (path, tag, summary, etc.). */
export function operationMatchesSwaggerFilter(
	operation: SwaggerFilterOperation,
	tag: string,
	phrase: string
): boolean {
	const q = phrase.trim().toLowerCase();
	if (!q) return true;

	if (tag.toLowerCase().includes(q)) return true;
	if ((operation.path ?? '').toLowerCase().includes(q)) return true;
	if ((operation.summary ?? '').toLowerCase().includes(q)) return true;
	if ((operation.description ?? '').toLowerCase().includes(q)) return true;
	if ((operation.operationId ?? '').toLowerCase().includes(q)) return true;
	if ((operation.method ?? '').toLowerCase().includes(q)) return true;

	return false;
}

function filterTagOperations(
	tagObj: ImmutableTagGroup,
	tag: string,
	phrase: string
): ImmutableTagGroup {
	const operations = tagObj.get('operations') as {
		filter(predicate: (op: ImmutableOperation) => boolean): unknown;
	};
	const filtered = operations.filter((op) =>
		operationMatchesSwaggerFilter(
			{
				path: String(op.get('path') ?? ''),
				summary: String(op.get('summary') ?? ''),
				description: String(op.get('description') ?? ''),
				operationId: String(op.get('operationId') ?? ''),
				method: String(op.get('method') ?? '')
			},
			tag,
			phrase
		)
	);
	return tagObj.set('operations', filtered);
}

/** Filter tagged operations by path segments and metadata, not tag name alone. */
export function filterSwaggerTaggedOperations(
	taggedOps: ImmutableTaggedOps,
	phrase: string
): ImmutableTaggedOps {
	const q = phrase.trim();
	if (!q) return taggedOps;

	return taggedOps
		.map((tagObj, tag) => filterTagOperations(tagObj, tag, q))
		.filter((tagObj) => {
			const operations = tagObj.get('operations') as { size: number };
			return operations.size > 0;
		});
}

/** Swagger UI plugin replacing default tag-only opsFilter. */
export function createSwaggerOpsFilterPlugin(): () => {
	fn: { opsFilter: (taggedOps: ImmutableTaggedOps, phrase: string) => ImmutableTaggedOps };
} {
	return function SwaggerOpsFilterPlugin() {
		return {
			fn: {
				opsFilter: filterSwaggerTaggedOperations
			}
		};
	};
}
