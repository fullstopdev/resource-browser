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

/** A spec request that takes longer than this is abandoned (and tried once more). */
export const SPEC_TIMEOUT_MS = 30_000;

/**
 * Load one spec JSON. A request that fails or stalls is retried once; after that the result is
 * null, so a single bad download can't hold up a page or a comparison.
 */
export async function loadOpenApiSpec(
	releaseFolder: string,
	specFile: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = SPEC_TIMEOUT_MS
): Promise<Record<string, unknown> | null> {
	assertSafeSpecFile(specFile);
	const url = `/${releaseFolder}/${specFile}`;
	for (let attempt = 1; attempt <= 2; attempt++) {
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<null>((resolve) => {
			timer = setTimeout(() => {
				controller.abort();
				resolve(null);
			}, timeoutMs);
		});
		try {
			const load = (async () => {
				const resp = await fetcher(url, { signal: controller.signal });
				if (!resp.ok) return resp.status === 404 ? 'missing' : null;
				return (await resp.json()) as Record<string, unknown>;
			})();
			const result = await Promise.race([load, timeout]);
			if (result === 'missing') return null;
			if (result) return result;
		} catch {
			// Network error or bad JSON: try again, then give up.
		} finally {
			clearTimeout(timer);
		}
	}
	return null;
}
