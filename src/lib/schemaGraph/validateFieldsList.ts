export type RedundantParentChildPair = {
	parent: string;
	child: string;
};

export type FieldsValidationResult = {
	/**
	 * Captured entries that are exact matches to enumerated valid leaf paths.
	 */
	validLeafPaths: string[];
	/**
	 * Captured entries that are not found anywhere in the schema (neither as a leaf nor as an ancestor of a leaf).
	 */
	unknownPaths: string[];
	/**
	 * Redundant parent+child pairs detected in the captured list.
	 * A pair `(parent, child)` means `parent` is the nearest ancestor path in the captured set for `child`.
	 */
	redundantPairs: RedundantParentChildPair[];
};

function normalizeFieldsList(fields: string[]): string[] {
	const uniq = new Set<string>();
	for (const f of fields) {
		const t = f.trim();
		if (!t) continue;
		uniq.add(t);
	}
	return [...uniq].sort((a, b) => a.localeCompare(b));
}

function allPrefixes(paths: string[]): Set<string> {
	const out = new Set<string>();
	for (const p of paths) {
		const segs = p.split('.').filter(Boolean);
		for (let i = 1; i < segs.length; i++) {
			out.add(segs.slice(0, i).join('.'));
		}
	}
	return out;
}

function longestCapturedAncestor(child: string, capturedSet: Set<string>): string | null {
	const segs = child.split('.').filter(Boolean);
	let best: string | null = null;
	for (let i = segs.length - 1; i >= 1; i--) {
		const candidate = segs.slice(0, i).join('.');
		if (capturedSet.has(candidate)) {
			best = candidate;
			break;
		}
	}
	return best;
}

/**
 * Validate a user-captured `FIELDS` list against enumerated schema leaf paths.
 *
 * Note: `rootSchemaName` is currently informational; the schema-side truth comes from `schemaLeafPaths`.
 */
export function validateFieldsList(
	capturedFieldsList: string[],
	rootSchemaName: string,
	schemaLeafPaths: string[]
): FieldsValidationResult {
	void rootSchemaName;

	const captured = normalizeFieldsList(capturedFieldsList);
	const capturedSet = new Set(captured);

	const leafSet = new Set(normalizeFieldsList(schemaLeafPaths));
	const validAncestors = allPrefixes([...leafSet]);
	const knownAnywhere = new Set<string>([...leafSet, ...validAncestors]);

	const validLeafPaths = captured.filter((p) => leafSet.has(p));
	const unknownPaths = captured.filter((p) => !knownAnywhere.has(p));

	const redundantPairs: RedundantParentChildPair[] = [];
	for (const child of captured) {
		const parent = longestCapturedAncestor(child, capturedSet);
		if (!parent) continue;
		if (!knownAnywhere.has(parent)) continue;
		redundantPairs.push({ parent, child });
	}

	// Deterministic output
	redundantPairs.sort((a, b) => a.parent.localeCompare(b.parent) || a.child.localeCompare(b.child));

	return { validLeafPaths, unknownPaths, redundantPairs };
}

