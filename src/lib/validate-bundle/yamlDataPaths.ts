type PathSegment = string | number;

function parseYamlPath(fieldPath: string): PathSegment[] {
	const segments: PathSegment[] = [];
	const normalized = fieldPath.replace(/^\//, '');
	for (const part of normalized.split('.')) {
		if (!part) continue;
		const match = part.match(/^([^[]+)(?:\[(\d+)\])?$/);
		if (!match?.[1]) continue;
		segments.push(match[1]);
		if (match[2] !== undefined) segments.push(Number(match[2]));
	}
	return segments;
}

export function getValueAtYamlPath(data: unknown, fieldPath: string): unknown {
	const segments = parseYamlPath(fieldPath);
	let current: unknown = data;
	for (const segment of segments) {
		if (current === null || current === undefined || typeof current !== 'object') return undefined;
		if (typeof segment === 'number') {
			if (!Array.isArray(current)) return undefined;
			current = current[segment];
			continue;
		}
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

export function setValueAtYamlPath(
	data: Record<string, unknown>,
	fieldPath: string,
	value: unknown
): boolean {
	const segments = parseYamlPath(fieldPath);
	if (segments.length === 0) return false;

	let current: unknown = data;
	for (let i = 0; i < segments.length - 1; i++) {
		const segment = segments[i]!;
		if (typeof segment === 'number') {
			if (!Array.isArray(current)) return false;
			current = current[segment];
			continue;
		}
		if (current === null || current === undefined || typeof current !== 'object' || Array.isArray(current)) {
			return false;
		}
		const record = current as Record<string, unknown>;
		let next = record[segment];
		if (next === undefined || next === null) {
			const nextSeg = segments[i + 1];
			next = typeof nextSeg === 'number' ? [] : {};
			record[segment] = next;
		}
		current = next;
	}

	const last = segments[segments.length - 1]!;
	if (typeof last === 'number') {
		if (!Array.isArray(current)) return false;
		current[last] = value;
		return true;
	}
	if (current === null || current === undefined || typeof current !== 'object' || Array.isArray(current)) {
		return false;
	}
	(current as Record<string, unknown>)[last] = value;
	return true;
}

export function deleteValueAtYamlPath(data: Record<string, unknown>, fieldPath: string): boolean {
	const segments = parseYamlPath(fieldPath);
	if (segments.length === 0) return false;

	let current: unknown = data;
	for (let i = 0; i < segments.length - 1; i++) {
		const segment = segments[i]!;
		if (current === null || current === undefined || typeof current !== 'object') return false;
		if (typeof segment === 'number') {
			if (!Array.isArray(current)) return false;
			current = current[segment];
			continue;
		}
		current = (current as Record<string, unknown>)[segment];
	}

	const last = segments[segments.length - 1]!;
	if (typeof last === 'number') {
		if (!Array.isArray(current)) return false;
		current.splice(last, 1);
		return true;
	}
	if (current === null || current === undefined || typeof current !== 'object' || Array.isArray(current)) {
		return false;
	}
	delete (current as Record<string, unknown>)[last];
	return true;
}

export function relocateFieldInData(
	data: Record<string, unknown>,
	fromPath: string,
	toPath: string
): boolean {
	const value = getValueAtYamlPath(data, fromPath);
	if (value === undefined) return false;
	if (getValueAtYamlPath(data, toPath) !== undefined) return false;
	if (!setValueAtYamlPath(data, toPath, value)) return false;
	deleteValueAtYamlPath(data, fromPath);
	return true;
}
