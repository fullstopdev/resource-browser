import { validateBundle } from './index';
import { parseBundleResources } from './parser';
import type {
	BundleIssue,
	BundleValidationResult,
	BundleValidationSummary,
	ValidateBundleOptions
} from './types';

type WorkerReply =
	| {
			id: number;
			ok: true;
			valid: boolean;
			issues: BundleIssue[];
			summary: BundleValidationSummary;
	  }
	| { id: number; ok: false; error: string };

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 0;
const pending = new Map<number, (reply: WorkerReply | null) => void>();

function getWorker(): Worker | null {
	if (workerBroken || typeof Worker === 'undefined') return null;
	if (worker) return worker;
	try {
		worker = new Worker(new URL('./validation.worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = (event: MessageEvent<WorkerReply>) => {
			pending.get(event.data.id)?.(event.data);
			pending.delete(event.data.id);
		};
		worker.onerror = () => {
			// The worker failed to load or crashed: answer every waiting call on the main thread.
			workerBroken = true;
			worker?.terminate();
			worker = null;
			for (const resolve of pending.values()) resolve(null);
			pending.clear();
		};
		return worker;
	} catch {
		workerBroken = true;
		return null;
	}
}

/**
 * Same result as `validateBundle`, computed in a Web Worker when the browser supports it, and on
 * the main thread otherwise (SSR, tests, or a worker that failed). The parsed `resources` aren't
 * transferable, so they are re-parsed here — cheap next to schema validation.
 */
export async function validateBundleOffThread(
	options: ValidateBundleOptions
): Promise<BundleValidationResult> {
	const w = getWorker();
	if (!w || !options.yamlInput.trim()) return validateBundle(options);

	const id = ++nextId;
	const reply = await new Promise<WorkerReply | null>((resolve) => {
		pending.set(id, resolve);
		try {
			w.postMessage({ id, options });
		} catch {
			// Not cloneable (e.g. a reactive proxy): validate here instead.
			pending.delete(id);
			resolve(null);
		}
	});
	if (!reply || !reply.ok) return validateBundle(options);
	const resources = reply.summary.resourceCount
		? parseBundleResources(options.yamlInput).resources
		: [];
	return { valid: reply.valid, issues: reply.issues, summary: reply.summary, resources };
}
