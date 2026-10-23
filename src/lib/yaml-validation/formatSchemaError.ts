import type { ErrorObject } from 'ajv';

function getValueByPointer(data: unknown, pointer: string): unknown {
	if (!pointer) return data;
	const parts = pointer.split('/').filter(Boolean);
	let current: unknown = data;
	for (const p of parts) {
		const key = p.replace(/~1/g, '/').replace(/~0/g, '~');
		if (current === null || current === undefined) return undefined;
		if (typeof current !== 'object') return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

function allowedValuesForError(err: ErrorObject): string[] | undefined {
	if (err.keyword === 'enum') {
		const values = err.params?.allowedValues;
		return Array.isArray(values) ? values.map(String) : undefined;
	}
	if (err.keyword === 'const') {
		const value = err.params?.allowedValue;
		return value !== undefined ? [String(value)] : undefined;
	}
	return undefined;
}

/**
 * Formats AJV enum/const mismatch messages with explicit case-sensitivity hints.
 */
export function formatValueConstraintError(
	err: ErrorObject,
	data: unknown,
	fieldLabel: string
): string {
	const allowed = allowedValuesForError(err);
	if (!allowed || allowed.length === 0) {
		return err.message || `${fieldLabel} has an invalid value`;
	}

	const providedValue = getValueByPointer(data, err.instancePath);
	const allowedText = allowed.join(', ');
	const constraint = `must be one of: ${allowedText} (exact case)`;

	if (providedValue !== undefined) {
		return `${fieldLabel}: value '${String(providedValue)}' is invalid; ${constraint}`;
	}

	return `${fieldLabel}: ${constraint}`;
}

function describeValue(value: unknown): string {
	if (value === undefined) return 'missing';
	const text = typeof value === 'string' ? `"${value}"` : JSON.stringify(value);
	return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function jsonType(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	if (Number.isInteger(value)) return 'integer';
	return typeof value;
}

/**
 * A readable message for any AJV keyword: the field, the value found and the rule it breaks.
 * Phrases like "must be integer" and "must be one of" are kept because issue classification
 * (fixIssueContext.inferIssueKind) relies on them.
 */
export function formatAjvError(err: ErrorObject, data: unknown, fieldLabel: string): string {
	const value = getValueByPointer(data, err.instancePath);
	const p = (err.params ?? {}) as Record<string, unknown>;
	switch (err.keyword) {
		case 'enum':
		case 'const':
			return formatValueConstraintError(err, data, fieldLabel);
		case 'type':
			return `${fieldLabel} must be ${String(p.type)} (found ${jsonType(value)} ${describeValue(value)})`;
		case 'pattern':
			return `${fieldLabel} value ${describeValue(value)} does not match the required pattern ${String(p.pattern)}`;
		case 'format':
			return `${fieldLabel} value ${describeValue(value)} is not a valid ${String(p.format)}`;
		case 'minimum':
		case 'exclusiveMinimum':
			return `${fieldLabel} is ${describeValue(value)}; it must be ${err.keyword === 'minimum' ? '>=' : '>'} ${String(p.limit)}`;
		case 'maximum':
		case 'exclusiveMaximum':
			return `${fieldLabel} is ${describeValue(value)}; it must be ${err.keyword === 'maximum' ? '<=' : '<'} ${String(p.limit)}`;
		case 'minLength':
			return `${fieldLabel} must be at least ${String(p.limit)} characters (found ${String((value as string)?.length ?? 0)})`;
		case 'maxLength':
			return `${fieldLabel} must be at most ${String(p.limit)} characters (found ${String((value as string)?.length ?? 0)})`;
		case 'minItems':
			return `${fieldLabel} must have at least ${String(p.limit)} item(s) (found ${String((value as unknown[])?.length ?? 0)})`;
		case 'maxItems':
			return `${fieldLabel} must have at most ${String(p.limit)} item(s) (found ${String((value as unknown[])?.length ?? 0)})`;
		case 'uniqueItems':
			return `${fieldLabel} must not contain duplicate items (items ${String(p.j)} and ${String(p.i)} are equal)`;
		case 'minProperties':
		case 'maxProperties':
			return `${fieldLabel} ${err.message ?? 'has the wrong number of properties'}`;
		case 'additionalProperties':
			return `${fieldLabel} has an unknown property "${String(p.additionalProperty)}"`;
		case 'anyOf':
		case 'oneOf':
			return `${fieldLabel} does not match any of the allowed forms for this field`;
		default:
			return `${fieldLabel} ${err.message ?? 'is invalid'}`;
	}
}

/**
 * With allErrors, a failed anyOf/oneOf also reports every failing branch. Keep the single
 * anyOf/oneOf error and drop the branch noise beneath it.
 */
export function collapseCompositeErrors(errors: ErrorObject[]): ErrorObject[] {
	const composite = errors.filter((e) => e.keyword === 'anyOf' || e.keyword === 'oneOf');
	if (composite.length === 0) return errors;
	return errors.filter((e) => {
		if (e.keyword === 'anyOf' || e.keyword === 'oneOf') return true;
		return !composite.some(
			(c) =>
				e.schemaPath.startsWith(`${c.schemaPath}/`) &&
				(e.instancePath === c.instancePath || e.instancePath.startsWith(`${c.instancePath}/`))
		);
	});
}
