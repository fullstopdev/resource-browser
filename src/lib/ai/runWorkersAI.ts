import { CRD_QA_SYSTEM_PROMPT } from './prompts';
import {
	isWorkersAINeuronLimitError,
	workersAIQuotaHttpResponse
} from './workersAIQuota';

/** Default Workers AI model for lightweight `/api/ai` actions (explain, field, etc.). */
export const WORKERS_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast' as const;
/** Higher-quality model for YAML fix (`/api/ai` action `fix`). 24k context window. */
export const FIX_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as const;
export const AI_REQUEST_TIMEOUT_MS = 90_000;
export const FIX_AI_REQUEST_TIMEOUT_MS = 120_000;
export const AI_MAX_TOKENS = 2048;
export const FIX_AI_MAX_TOKENS = 2048;
export const AI_TEMPERATURE = 0.3;

export class WorkersAIEmptyResponseError extends Error {
	constructor() {
		super('Workers AI returned an empty response');
		this.name = 'WorkersAIEmptyResponseError';
	}
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('Workers AI request timed out')), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

export type RunWorkersAIOptions = {
	systemPrompt?: string;
	model?: string;
	maxTokens?: number;
	temperature?: number;
	seed?: number;
	timeoutMs?: number;
};

export type AiMessage = { role: 'system' | 'user' | 'assistant'; content: string };

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

/** Parse Workers AI run() output — supports legacy `response` and chat `choices` shapes. */
export function extractWorkersAIText(result: unknown): string {
	if (typeof result === 'string') return result.trim();

	if (typeof result === 'object' && result !== null) {
		const o = result as Record<string, unknown>;

		if (typeof o.response === 'string' && o.response.trim()) {
			return o.response.trim();
		}

		const choices = o.choices;
		if (Array.isArray(choices) && choices.length > 0) {
			const first = choices[0] as Record<string, unknown> | undefined;
			const message = first?.message as Record<string, unknown> | undefined;
			if (typeof message?.content === 'string' && message.content.trim()) {
				return message.content.trim();
			}
		}
	}

	return '';
}

export function workersAIErrorMessage(err: unknown): string {
	const text = errorText(err).trim();
	if (!text) {
		return 'Failed to generate answer. Please try again.';
	}
	if (/deprecated/i.test(text)) {
		return 'Workers AI model is no longer available (deprecated). Redeploy the latest app version.';
	}
	if (/context length|maximum context|token limit|too many tokens|prompt is too long/i.test(text)) {
		return 'Prompt too large for Workers AI. Try a shorter question or open a specific CRD page.';
	}
	if (err instanceof WorkersAIEmptyResponseError) {
		return 'Workers AI returned an empty answer. Try again or rephrase your question.';
	}
	if (text.length <= 280) return text;
	return 'Failed to generate answer. Please try again.';
}

export async function runWorkersAIMessages(
	ai: Ai,
	messages: AiMessage[],
	options: Omit<RunWorkersAIOptions, 'systemPrompt'> = {}
): Promise<string> {
	if ((process.env.VITEST || process.env.CI) && process.env.WORKERS_AI_ALLOW !== '1') {
		throw new Error(
			'Workers AI is disabled during tests and CI. Set WORKERS_AI_ALLOW=1 to override.'
		);
	}

	const model = options.model ?? WORKERS_AI_MODEL;
	const maxTokens = options.maxTokens ?? AI_MAX_TOKENS;
	const temperature = options.temperature ?? AI_TEMPERATURE;
	const timeoutMs = options.timeoutMs ?? AI_REQUEST_TIMEOUT_MS;

	const runOptions: Record<string, unknown> = {
		messages,
		max_tokens: maxTokens,
		temperature
	};
	if (options.seed !== undefined) {
		runOptions.seed = options.seed;
	}

	const result = await withTimeout(
		ai.run(model as Parameters<Ai['run']>[0], runOptions),
		timeoutMs
	);
	const answer = extractWorkersAIText(result);
	if (!answer) {
		throw new WorkersAIEmptyResponseError();
	}
	return answer;
}

export async function runWorkersAI(
	ai: Ai,
	userContent: string,
	options: RunWorkersAIOptions = {}
): Promise<string> {
	const systemPrompt = options.systemPrompt ?? CRD_QA_SYSTEM_PROMPT;
	return runWorkersAIMessages(
		ai,
		[
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userContent }
		],
		options
	);
}

export function workersAIErrorResponse(err: unknown): { status: number; error: string } {
	if (isWorkersAINeuronLimitError(err)) {
		return workersAIQuotaHttpResponse();
	}
	if (err instanceof Error && err.message === 'Workers AI request timed out') {
		return {
			status: 504,
			error:
				'Workers AI timed out. Check network/proxy access to Cloudflare (including workers-binding.ai) and your API token Workers AI permissions.'
		};
	}
	return { status: 500, error: workersAIErrorMessage(err) };
}

/** Pick a Workers AI model for YAML fix — 8B for scoped/syntax fixes, 70B only when needed. */
function specFieldDepth(fieldPath?: string): number {
	if (!fieldPath) return 0;
	return fieldPath.replace(/^spec\./, '').split('.').filter(Boolean).length;
}

export function selectFixModel(
	issueKind?: string,
	options?: {
		batched?: boolean;
		relocationHint?: { from: string; to: string };
		migrationContext?: string;
		fieldPath?: string;
	}
): string {
	if (options?.batched) return FIX_AI_MODEL;
	const depth = specFieldDepth(options?.fieldPath);
	const needsLargeModel =
		!!options?.relocationHint || !!options?.migrationContext || depth >= 3;
	if (
		issueKind === 'syntax' ||
		issueKind === 'misspelledField' ||
		issueKind === 'enum'
	) {
		return WORKERS_AI_MODEL;
	}
	if (issueKind === 'type') {
		return depth >= 3 ? FIX_AI_MODEL : WORKERS_AI_MODEL;
	}
	if (issueKind === 'unknownField' || issueKind === 'required' || issueKind === 'other') {
		return needsLargeModel ? FIX_AI_MODEL : WORKERS_AI_MODEL;
	}
	return WORKERS_AI_MODEL;
}

/** Dynamic max output tokens by fix complexity. */
export function selectFixMaxTokens(
	issueKind?: string,
	options?: { batched?: boolean }
): number {
	if (options?.batched) return 2048;
	if (issueKind === 'enum' || issueKind === 'type' || issueKind === 'syntax') return 768;
	if (issueKind === 'unknownField') return 1536;
	return FIX_AI_MAX_TOKENS;
}
