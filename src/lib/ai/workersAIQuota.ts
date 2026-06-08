export const WORKERS_AI_NEURON_LIMIT_MESSAGE =
	'Workers AI daily limit reached. Try again tomorrow or upgrade Workers plan.';

export class WorkersAINeuronLimitError extends Error {
	constructor(message = WORKERS_AI_NEURON_LIMIT_MESSAGE) {
		super(message);
		this.name = 'WorkersAINeuronLimitError';
	}
}

function errorText(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === 'object' && err !== null) {
		const o = err as Record<string, unknown>;
		const nested =
			typeof o.cause === 'object' && o.cause !== null
				? errorText(o.cause)
				: typeof o.cause === 'string'
					? o.cause
					: '';
		const parts = [
			o.message,
			o.error,
			o.error_message,
			typeof o.response === 'string' ? o.response : undefined,
			nested
		].filter((x) => typeof x === 'string') as string[];
		return parts.join(' ');
	}
	return String(err);
}

function httpStatus(err: unknown): number | undefined {
	if (typeof err === 'object' && err !== null) {
		const o = err as Record<string, unknown>;
		const status = o.status ?? o.statusCode;
		if (typeof status === 'number') return status;
		const remote = o.remote as Record<string, unknown> | undefined;
		if (typeof remote?.status === 'number') return remote.status;
	}
	return undefined;
}

/** True when Workers AI rejected the call due to daily neuron / rate limits (HTTP 429). */
export function isWorkersAINeuronLimitError(err: unknown): boolean {
	if (err instanceof WorkersAINeuronLimitError) return true;

	if (httpStatus(err) === 429) return true;

	const text = errorText(err).toLowerCase();
	if (text.includes('429')) return true;
	if (text.includes('neuron')) return true;
	if (text.includes('too many requests')) return true;
	if (text.includes('daily') && (text.includes('limit') || text.includes('quota'))) return true;

	return false;
}

export function workersAIQuotaHttpResponse(): { status: number; error: string } {
	return { status: 503, error: WORKERS_AI_NEURON_LIMIT_MESSAGE };
}
