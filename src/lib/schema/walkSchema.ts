export type SchemaWalkerVisitor = (currentPath: string[], node: unknown) => void;

/**
 * Walk a JSON Schema-like object and call `visitor` for every visited node.
 *
 * Traversal includes:
 * - `properties` (by property key)
 * - `items` (as a single child; path segment `[]`)
 * - `additionalProperties` (as a single child; path segment `*`)
 * - `allOf` / `oneOf` / `anyOf` (each branch under the same path)
 */
export function walkSchema(rawSchema: unknown, visitor: SchemaWalkerVisitor): void {
	walkSchemaInner(rawSchema, visitor, []);
}

function walkSchemaInner(rawSchema: unknown, visitor: SchemaWalkerVisitor, currentPath: string[]): void {
	visitor(currentPath, rawSchema);

	if (!rawSchema || typeof rawSchema !== 'object') return;

	const node = rawSchema as Record<string, unknown>;

	if (node.properties && typeof node.properties === 'object') {
		const props = node.properties as Record<string, unknown>;
		for (const [key, val] of Object.entries(props)) {
			walkSchemaInner(val, visitor, [...currentPath, key]);
		}
	}

	if (node.additionalProperties && typeof node.additionalProperties === 'object') {
		walkSchemaInner(node.additionalProperties, visitor, [...currentPath, '*']);
	}

	if (node.items) {
		walkSchemaInner(node.items, visitor, [...currentPath, '[]']);
	}

	// Match the legacy schemaRefs traversal order: allOf → anyOf → oneOf
	for (const comb of ['allOf', 'anyOf', 'oneOf'] as const) {
		const arr = node[comb];
		if (Array.isArray(arr)) {
			for (const el of arr) {
				walkSchemaInner(el, visitor, currentPath);
			}
		}
	}
}

