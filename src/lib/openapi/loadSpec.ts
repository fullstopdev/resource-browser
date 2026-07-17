const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;

export function assertSafeOpenApiSegment(segment: string, label: string): void {
	if (!segment || !SAFE_SEGMENT.test(segment)) {
		throw new Error(`Invalid ${label}: ${segment}`);
	}
}

/** Validate a relative spec file path under a release folder. */
export function assertSafeSpecFile(relativePath: string): void {
	const parts = relativePath.split('/').filter(Boolean);
	if (parts.length === 0) throw new Error('Empty spec path');
	for (const part of parts) {
		assertSafeOpenApiSegment(part.replace(/\.json$/, ''), 'path segment');
	}
	if (!relativePath.endsWith('.json')) {
		throw new Error('Spec file must be .json');
	}
}

export async function loadOpenApiSpec(
	releaseFolder: string,
	specFile: string,
	fetcher: typeof fetch = fetch
): Promise<Record<string, unknown> | null> {
	assertSafeSpecFile(specFile);
	const resp = await fetcher(`/${releaseFolder}/${specFile}`);
	if (!resp.ok) return null;
	return (await resp.json()) as Record<string, unknown>;
}
