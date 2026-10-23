import yaml from 'js-yaml';
import { getRequiredKeys } from './schemaNavigation';

type Node = Record<string, unknown>;

const MAX_DEPTH = 5;

function asNode(value: unknown): Node | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Node) : null;
}

/** Placeholder for one schema node: its default, first enum value, or an empty value of its type. */
function placeholder(node: Node | null, depth: number): unknown {
	if (!node) return '';
	if (node.default !== undefined) return node.default;
	if (Array.isArray(node.enum) && node.enum.length > 0) return node.enum[0];
	if (node['x-kubernetes-int-or-string'] === true) return '';
	switch (node.type) {
		case 'integer':
		case 'number':
			return typeof node.minimum === 'number' ? node.minimum : 0;
		case 'boolean':
			return false;
		case 'array':
			// A required list that must not be empty gets one placeholder item.
			return typeof node.minItems === 'number' && node.minItems > 0 && depth < MAX_DEPTH
				? [placeholder(asNode(node.items), depth + 1)]
				: [];
		case 'object':
			return depth < MAX_DEPTH ? requiredFields(node, depth + 1) : {};
		default:
			return '';
	}
}

/** Only the required fields, recursively — the smallest object the schema accepts. */
function requiredFields(node: Node, depth = 0): Record<string, unknown> {
	const props = asNode(node.properties) ?? {};
	const out: Record<string, unknown> = {};
	for (const key of getRequiredKeys(node)) {
		out[key] = placeholder(asNode(props[key]), depth);
	}
	return out;
}

/**
 * A minimal manifest for a CRD: identity, metadata and the required spec fields filled with
 * defaults or placeholders. Built from the schema, so it costs nothing and needs no AI.
 */
export function buildSkeletonYaml(params: {
	apiVersion: string;
	kind: string;
	specSchema: unknown;
	namespace?: string;
}): string {
	const specNode = asNode(params.specSchema);
	const spec = specNode ? requiredFields(specNode) : {};
	const name = `my-${params.kind.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`;
	return yaml.dump(
		{
			apiVersion: params.apiVersion,
			kind: params.kind,
			metadata: { name, namespace: params.namespace ?? 'eda' },
			spec
		},
		{ lineWidth: -1, noRefs: true, quotingType: '"' }
	);
}
