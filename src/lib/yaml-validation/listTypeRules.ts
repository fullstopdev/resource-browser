/**
 * Kubernetes structural-schema rules that JSON Schema (Ajv) does not enforce:
 * - `x-kubernetes-list-type: set` — list items must be unique;
 * - `x-kubernetes-list-type: map` + `x-kubernetes-list-map-keys` — key tuples must be unique;
 * - `x-kubernetes-validations` — CEL rules; not evaluated here, surfaced as hints.
 */

export type StructuralFinding = {
	severity: 'error' | 'info';
	/** Dotted path of the list or object, e.g. `spec.pools.1.ranges` (indices for list items). */
	path: string;
	message: string;
};

type SchemaNode = Record<string, unknown>;

function asNode(value: unknown): SchemaNode | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as SchemaNode) : null;
}

function itemLabel(item: unknown): string {
	const text = typeof item === 'string' ? `"${item}"` : JSON.stringify(item);
	return text.length > 50 ? `${text.slice(0, 47)}…` : text;
}

/** Schema-path key used to report each CEL rule once, not once per list item. */
const genericPath = (path: string) => path.replace(/\.\d+(?=\.|$)/g, '[]');

export function checkStructuralRules(
	data: unknown,
	schema: unknown,
	path = 'spec'
): StructuralFinding[] {
	const findings: StructuralFinding[] = [];
	const celSeen = new Set<string>();

	const walk = (value: unknown, node: SchemaNode | null, at: string) => {
		if (!node || value === undefined || value === null) return;

		const rules = node['x-kubernetes-validations'];
		if (Array.isArray(rules)) {
			for (const rule of rules) {
				const message = asNode(rule)?.message;
				const key = `${genericPath(at)}|${String(message)}`;
				if (typeof message !== 'string' || celSeen.has(key)) continue;
				celSeen.add(key);
				findings.push({
					severity: 'info',
					path: at,
					message: `${genericPath(at)}: the cluster also enforces "${message}" (CEL rule, not checked here)`
				});
			}
		}

		if (Array.isArray(value)) {
			const listType = node['x-kubernetes-list-type'];
			if (listType === 'set') {
				const seen = new Map<string, number>();
				value.forEach((item, index) => {
					const key = JSON.stringify(item);
					const first = seen.get(key);
					if (first !== undefined) {
						findings.push({
							severity: 'error',
							path: at,
							message: `${at} must not contain duplicates: item ${index + 1} repeats item ${first + 1} (${itemLabel(item)})`
						});
					} else {
						seen.set(key, index);
					}
				});
			} else if (listType === 'map') {
				const keys = node['x-kubernetes-list-map-keys'];
				if (Array.isArray(keys) && keys.length > 0) {
					const seen = new Map<string, number>();
					value.forEach((item, index) => {
						const obj = asNode(item);
						if (!obj) return;
						const tuple = keys.map((k) => obj[String(k)]);
						const key = JSON.stringify(tuple);
						const first = seen.get(key);
						if (first !== undefined) {
							const keyText = keys.map((k, i) => `${String(k)}=${itemLabel(tuple[i])}`).join(', ');
							findings.push({
								severity: 'error',
								path: at,
								message: `${at} must have unique keys: item ${index + 1} has the same ${keyText} as item ${first + 1}`
							});
						} else {
							seen.set(key, index);
						}
					});
				}
			}
			const items = asNode(node.items);
			value.forEach((item, index) => walk(item, items, `${at}.${index}`));
			return;
		}

		const obj = asNode(value);
		const props = asNode(node.properties);
		if (obj && props) {
			for (const [key, child] of Object.entries(obj)) {
				walk(child, asNode(props[key]), `${at}.${key}`);
			}
		}
	};

	walk(data, asNode(schema), path);
	return findings;
}
