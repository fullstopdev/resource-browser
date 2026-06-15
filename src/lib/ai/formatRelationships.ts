import type { AiSchemaPayload } from './loadAiSchema';
import { extractSchemaReferences } from '$lib/dependency-map/schemaRefs';

/** Deterministic CRD relationship summary from OpenAPI x-references / GVK hints. */
export function formatRelationshipsForKv(schema: AiSchemaPayload): string {
	const openApiRoot = {
		properties: {
			spec: schema.specSchema ?? {},
			...(schema.statusSchema ? { status: schema.statusSchema } : {})
		}
	};

	const refs = extractSchemaReferences(openApiRoot);
	if (!refs.length) {
		return [
			`## CRD relationships — ${schema.kind} (KV — schema-derived)`,
			`**${schema.kind}** (\`${schema.apiVersion}\`) — EDA release **${schema.release}**`,
			'',
			'_No explicit x-references or x-kubernetes-group-version-kind hints found in the OpenAPI schema._',
			'Check field descriptions in the schema summary for operational dependencies.'
		].join('\n');
	}

	const byKind = new Map<string, Set<string>>();
	for (const hit of refs) {
		const kind = hit.gvk?.kind ?? hit.kind;
		if (!kind) continue;
		const group = hit.gvk?.group ?? '';
		const label = group ? `${kind} (${group})` : kind;
		const paths = byKind.get(label) ?? new Set<string>();
		paths.add(hit.fieldPath);
		byKind.set(label, paths);
	}

	const lines = [
		`## CRD relationships — ${schema.kind} (KV — schema-derived)`,
		`**${schema.kind}** (\`${schema.apiVersion}\`) — EDA release **${schema.release}**`,
		'',
		'### Referenced / related kinds (from schema)',
		''
	];

	for (const [label, paths] of [...byKind.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		const pathList = [...paths].slice(0, 6).join(', ');
		const more = paths.size > 6 ? ` (+${paths.size - 6} more fields)` : '';
		lines.push(`- **${label}** — via \`${pathList}\`${more}`);
	}

	return lines.join('\n');
}
