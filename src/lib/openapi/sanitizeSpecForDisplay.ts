const HTTP_METHODS = new Set([
	'get',
	'put',
	'post',
	'delete',
	'options',
	'head',
	'patch',
	'trace'
]);

function isOpenApiServerList(value: unknown): value is Array<{ url?: string }> {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every((entry) => entry !== null && typeof entry === 'object' && 'url' in entry)
	);
}

const sanitizeCache = new WeakMap<object, Record<string, unknown>>();

/** Remove cluster-specific server URLs from a spec before read-only display. */
export function sanitizeSpecForDisplay(
	spec: Record<string, unknown>
): Record<string, unknown> {
	const cached = sanitizeCache.get(spec);
	if (cached) return cached;

	const sanitized = JSON.parse(JSON.stringify(spec)) as Record<string, unknown>;

	delete sanitized.servers;
	delete sanitized.host;
	delete sanitized.basePath;
	delete sanitized.schemes;

	const paths = sanitized.paths;
	if (paths && typeof paths === 'object' && !Array.isArray(paths)) {
		for (const pathItem of Object.values(paths as Record<string, unknown>)) {
			if (!pathItem || typeof pathItem !== 'object' || Array.isArray(pathItem)) continue;

			const item = pathItem as Record<string, unknown>;
			if (isOpenApiServerList(item.servers)) {
				delete item.servers;
			}

			for (const [key, operation] of Object.entries(item)) {
				if (!HTTP_METHODS.has(key)) continue;
				if (!operation || typeof operation !== 'object' || Array.isArray(operation)) continue;

				const op = operation as Record<string, unknown>;
				if (isOpenApiServerList(op.servers)) {
					delete op.servers;
				}
			}
		}
	}

	sanitizeCache.set(spec, sanitized);
	return sanitized;
}
