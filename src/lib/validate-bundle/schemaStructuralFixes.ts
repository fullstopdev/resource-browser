import {
	collectSchemaProperties,
	findNestedSchemaPropertyPath,
	getChildPropertySchema
} from './schemaNavigation';
import { collectSchemaConstraints } from './schemaSuggestedFix';
import { getValueAtYamlPath, relocateFieldInData } from './yamlDataPaths';
import type { SchemaSections } from '$lib/yaml-validation/schemaCache';

export type StructuralFixReport = {
	path: string;
	kind: 'wrapObject' | 'relocateField' | 'removeField';
	from?: string;
	to?: string;
};

function asSpecRecord(data: Record<string, unknown>): Record<string, unknown> | null {
	const spec = data.spec;
	if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
	return spec as Record<string, unknown>;
}

function schemaExpectsObject(schema: unknown): boolean {
	return collectSchemaConstraints(schema).types.includes('object');
}

function isScalarRelocatable(value: unknown): boolean {
	return (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	);
}

/** Apply schema-driven structural transforms (type wraps, field relocations) to a document. */
export function applySchemaStructuralFixes(
	data: Record<string, unknown>,
	sections: SchemaSections
): { data: Record<string, unknown>; fixes: StructuralFixReport[] } {
	const fixes: StructuralFixReport[] = [];
	if (!sections.spec) return { data, fixes };

	const specRecord = asSpecRecord(data);
	if (!specRecord) return { data, fixes };

	const out = { ...data, spec: { ...specRecord } };
	const spec = out.spec as Record<string, unknown>;

	const macLearningSchema = getChildPropertySchema(sections.spec, 'macLearning');
	const macLearning = spec.macLearning;
	if (
		typeof macLearning === 'boolean' &&
		macLearningSchema &&
		schemaExpectsObject(macLearningSchema)
	) {
		const aging =
			typeof spec.macAging === 'number'
				? spec.macAging
				: typeof spec.macAging === 'string'
					? Number(spec.macAging)
					: undefined;
		const wrapped: Record<string, unknown> = { enabled: macLearning };
		if (aging !== undefined && Number.isFinite(aging)) {
			wrapped.agingTimeSeconds = aging;
		}
		spec.macLearning = wrapped;
		fixes.push({ path: 'spec.macLearning', kind: 'wrapObject' });
		if (spec.macAging !== undefined) {
			delete spec.macAging;
			fixes.push({
				path: 'spec.macAging',
				kind: 'removeField',
				from: 'spec.macAging',
				to: 'spec.macLearning.agingTimeSeconds'
			});
		}
	}

	const specProps = collectSchemaProperties(sections.spec);
	if (specProps) {
		for (const key of Object.keys(spec)) {
			if (specProps.has(key)) continue;
			const value = spec[key];
			if (!isScalarRelocatable(value)) continue;
			const nested = findNestedSchemaPropertyPath(sections.spec, key);
			if (!nested) continue;
			const from = `spec.${key}`;
			const to = `spec.${nested}`;
			if (getValueAtYamlPath(out, to) !== undefined) continue;
			if (relocateFieldInData(out, from, to)) {
				fixes.push({ path: from, kind: 'relocateField', from, to });
			}
		}
	}

	return { data: out, fixes };
}
