/// <reference lib="webworker" />
/**
 * Runs bundle validation (YAML parse, Ajv schema checks, Kubernetes and EDA rules) off the main
 * thread, so typing in the editor stays smooth on large bundles. Only plain data crosses the
 * boundary: the parsed resources stay on the main thread (see validateOffThread.ts).
 */
import { validateBundle } from './index';
import type { ValidateBundleOptions } from './types';

type Request = { id: number; options: ValidateBundleOptions };

self.onmessage = async (event: MessageEvent<Request>) => {
	const { id, options } = event.data;
	try {
		const { valid, issues, summary } = await validateBundle(options);
		self.postMessage({ id, ok: true, valid, issues, summary });
	} catch (err) {
		self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
	}
};
