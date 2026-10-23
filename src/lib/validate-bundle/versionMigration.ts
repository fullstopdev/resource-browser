import { findLineForYamlFieldPath } from '$lib/yaml-validation/yamlFieldPath';
import { loadUserYaml } from '$lib/yaml/safeYaml';

type Node = Record<string, unknown>;

export type ScalarWrap = {
	/** Dotted instance path of the scalar, e.g. `spec.bridgeDomains.0.spec.macLearning`. */
	path: string;
	/** Property of the new object that receives the old value, e.g. `enabled`. */
	property: string;
};

export type MigrationResult = {
	yaml: string;
	/** Human-readable list of what was changed. */
	changes: string[];
	/** Scalars that became objects but have no obvious target property — left for review/AI. */
	unresolved: string[];
};

/** Preferred target names when several properties of the new object could hold the old value. */
const PREFERRED_WRAP_PROPERTIES = ['enabled', 'populate', 'value', 'count', 'name', 'mode'];

function asNode(value: unknown): Node | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Node) : null;
}

function schemaAccepts(node: Node, value: unknown): boolean {
	if (node['x-kubernetes-int-or-string'] === true) {
		return typeof value === 'string' || typeof value === 'number';
	}
	switch (node.type) {
		case 'boolean':
			return typeof value === 'boolean';
		case 'integer':
			return typeof value === 'number' && Number.isInteger(value);
		case 'number':
			return typeof value === 'number';
		case 'string':
			return typeof value === 'string';
		default:
			return false;
	}
}

/** The property of `objectSchema` that should hold a scalar that used to be the whole field. */
function pickWrapProperty(objectSchema: Node, value: unknown): string | null {
	const props = asNode(objectSchema.properties) ?? {};
	const candidates = Object.entries(props)
		.filter(([, child]) => asNode(child) && schemaAccepts(child as Node, value))
		.map(([key]) => key);
	if (candidates.length === 1) return candidates[0]!;
	return PREFERRED_WRAP_PROPERTIES.find((name) => candidates.includes(name)) ?? null;
}

/**
 * Find scalars in `data` whose field is an object in the target schema (e.g. BridgeDomain
 * v1 `macLearning: true` → v2 `macLearning: { enabled: true }`). Walks list items too.
 */
export function planScalarWraps(
	data: unknown,
	targetSchema: unknown,
	path = 'spec'
): { wraps: ScalarWrap[]; unresolved: string[] } {
	const wraps: ScalarWrap[] = [];
	const unresolved: string[] = [];

	const walk = (value: unknown, schema: Node | null, at: string) => {
		if (!schema || value === undefined || value === null) return;
		if (Array.isArray(value)) {
			const items = asNode(schema.items);
			value.forEach((item, i) => walk(item, items, `${at}.${i}`));
			return;
		}
		if (typeof value === 'object') {
			const props = asNode(schema.properties);
			if (!props) return;
			for (const [key, child] of Object.entries(value as Node)) {
				walk(child, asNode(props[key]), `${at}.${key}`);
			}
			return;
		}
		// Scalar where the target schema wants an object.
		if (schema.type === 'object' && asNode(schema.properties)) {
			const property = pickWrapProperty(schema, value);
			if (property) wraps.push({ path: at, property });
			else unresolved.push(at);
		}
	};

	walk(asNode(data), asNode(targetSchema), path);
	return { wraps, unresolved };
}

/**
 * Move one document to another apiVersion of the same CRD: rewrite `apiVersion` and wrap scalars
 * that became objects. Edits the text line by line so formatting and comments are kept; renamed or
 * moved fields are left to the regular fixes, which run against the new schema afterwards.
 */
export function migrateDocumentText(
	docYaml: string,
	options: { toApiVersion: string; targetSpecSchema: unknown }
): MigrationResult {
	const changes: string[] = [];
	let text = docYaml;

	const current = /^apiVersion:\s*["']?([^\s"'#]+)/m.exec(text)?.[1];
	if (current && current !== options.toApiVersion) {
		text = text.replace(/^apiVersion:.*$/m, `apiVersion: ${options.toApiVersion}`);
		changes.push(`apiVersion ${current} → ${options.toApiVersion}`);
	}

	let data: unknown;
	try {
		data = loadUserYaml(text);
	} catch {
		return { yaml: text, changes, unresolved: [] };
	}
	const spec = asNode(data)?.spec;
	const { wraps, unresolved } = planScalarWraps(spec, options.targetSpecSchema);

	// Bottom-up, so inserting lines never shifts a line still to be edited.
	const lines = text.split('\n');
	const located = wraps
		.map((wrap) => ({ wrap, line: findLineForYamlFieldPath(text, wrap.path) }))
		.filter((w): w is { wrap: ScalarWrap; line: number } => w.line !== undefined)
		.sort((a, b) => b.line - a.line);

	for (const { wrap, line } of located) {
		const match = /^(\s*(?:-\s+)?)([^\s:#]+)(\s*:)\s*(.*)$/.exec(lines[line]!);
		if (!match) {
			unresolved.push(wrap.path);
			continue;
		}
		const [, lead, key, colon, valueText] = match;
		const childIndent = ' '.repeat(lead!.length + 2);
		lines.splice(line, 1, `${lead}${key}${colon}`, `${childIndent}${wrap.property}: ${valueText}`);
		changes.push(`${wrap.path} → ${wrap.path}.${wrap.property}`);
	}

	return { yaml: lines.join('\n'), changes, unresolved };
}
