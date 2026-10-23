import { collectSchemaProperties, getRequiredKeys, specSchemaAtPath } from './schemaNavigation';
import { schemaKeyForResource, type YamlCompletionContext } from './yamlSchemaKeys';
import type { BundleIssue } from './types';

export type IssueExplanation = {
	fieldPath: string;
	kind?: string;
	/** Short label/value facts from the CRD schema (type, allowed values, default, …). */
	facts: { label: string; value: string }[];
	description?: string;
};

function joinValues(values: unknown[], max = 12): string {
	const shown = values.slice(0, max).map(String).join(', ');
	return values.length > max ? `${shown}, … (${values.length} total)` : shown;
}

/**
 * Explain an issue's field from the CRD schema alone — instant and free, no AI. For a field the
 * schema doesn't define (unknown/misspelled), lists the fields that are allowed at that level.
 */
export function explainIssueFromSchema(
	issue: Pick<BundleIssue, 'fieldPath' | 'docIndex'>,
	ctx: YamlCompletionContext | null
): IssueExplanation | null {
	const fieldPath = issue.fieldPath?.replace(/^\//, '').replace(/\//g, '.');
	if (!ctx || !fieldPath?.startsWith('spec')) return null;

	const resource = ctx.resources.find((r) => r.docIndex + 1 === (issue.docIndex ?? 1));
	if (!resource) return null;
	const key = schemaKeyForResource(ctx, resource);
	const specSchema = key ? ctx.schemas.get(key)?.spec : undefined;
	if (!specSchema) return null;

	const node = specSchemaAtPath(specSchema, fieldPath) as Record<string, unknown> | null;
	const segments = fieldPath.split('.');
	const parentPath = segments.slice(0, -1).join('.');
	const parent = parentPath === 'spec' ? specSchema : specSchemaAtPath(specSchema, parentPath);
	const leaf = segments[segments.length - 1]!;
	const facts: IssueExplanation['facts'] = [];

	if (!node) {
		const allowed = parent ? collectSchemaProperties(parent) : null;
		if (!allowed || allowed.size === 0) return null;
		facts.push({ label: 'Not in schema', value: `"${leaf}" is not a field of ${parentPath}` });
		facts.push({ label: 'Fields allowed here', value: joinValues([...allowed].sort(), 40) });
		return { fieldPath, kind: resource.kind, facts };
	}

	const type =
		node['x-kubernetes-int-or-string'] === true
			? 'integer or string'
			: typeof node.type === 'string'
				? node.type
				: undefined;
	if (type)
		facts.push({ label: 'Type', value: node.format ? `${type} (${String(node.format)})` : type });
	if (parent) {
		facts.push({ label: 'Required', value: getRequiredKeys(parent).includes(leaf) ? 'yes' : 'no' });
	}
	if (Array.isArray(node.enum))
		facts.push({ label: 'Allowed values', value: joinValues(node.enum) });
	if (node.default !== undefined)
		facts.push({ label: 'Default', value: JSON.stringify(node.default) });
	if (node.minimum !== undefined || node.maximum !== undefined) {
		facts.push({
			label: 'Range',
			value: `${node.minimum ?? '−∞'} … ${node.maximum ?? '∞'}`
		});
	}
	if (node.minLength !== undefined || node.maxLength !== undefined) {
		facts.push({ label: 'Length', value: `${node.minLength ?? 0} … ${node.maxLength ?? '∞'}` });
	}
	if (typeof node.pattern === 'string') facts.push({ label: 'Pattern', value: node.pattern });
	if (node.type === 'object') {
		const children = collectSchemaProperties(node);
		if (children?.size)
			facts.push({ label: 'Fields', value: joinValues([...children].sort(), 40) });
	}

	return {
		fieldPath,
		kind: resource.kind,
		facts,
		description: typeof node.description === 'string' ? node.description : undefined
	};
}
