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

export const WORKERS_AI_RATE_LIMIT_MESSAGE =
	'Workers AI is busy (too many requests). Try again in a minute.';

/**
 * 503 for a Workers AI 429: "daily limit" only when the free daily allocation is used up
 * (error 4006); any other 429 is a short rate limit.
 */
export function workersAIQuotaHttpResponse(err?: unknown): { status: number; error: string } {
	const text = err === undefined ? 'daily' : errorText(err).toLowerCase();
	const daily = text.includes('daily') || text.includes('4006') || text.includes('neuron');
	return {
		status: 503,
		error: daily ? WORKERS_AI_NEURON_LIMIT_MESSAGE : WORKERS_AI_RATE_LIMIT_MESSAGE
	};
}
