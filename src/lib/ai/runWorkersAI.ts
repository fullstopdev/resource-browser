import { CRD_QA_SYSTEM_PROMPT } from './prompts';

export const WORKERS_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct' as const;
export const AI_REQUEST_TIMEOUT_MS = 90_000;
export const AI_MAX_TOKENS = 1024;
export const AI_TEMPERATURE = 0.3;

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
	maxTokens?: number;
	temperature?: number;
	timeoutMs?: number;
};

export async function runWorkersAI(
	ai: Ai,
	userContent: string,
	options: RunWorkersAIOptions = {}
): Promise<string> {
	const systemPrompt = options.systemPrompt ?? CRD_QA_SYSTEM_PROMPT;
	const maxTokens = options.maxTokens ?? AI_MAX_TOKENS;
	const temperature = options.temperature ?? AI_TEMPERATURE;
	const timeoutMs = options.timeoutMs ?? AI_REQUEST_TIMEOUT_MS;

	const result = await withTimeout(
		ai.run(WORKERS_AI_MODEL, {
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userContent }
			],
			max_tokens: maxTokens,
			temperature
		}),
		timeoutMs
	);

	const answer =
		typeof result === 'object' && result !== null && 'response' in result
			? String((result as { response?: string }).response ?? '')
			: String(result);

	return answer || 'No response generated.';
}

export function workersAIErrorResponse(err: unknown): { status: number; error: string } {
	if (err instanceof Error && err.message === 'Workers AI request timed out') {
		return {
			status: 504,
			error:
				'Workers AI timed out. Check network/proxy access to Cloudflare (including workers-binding.ai) and your API token Workers AI permissions.'
		};
	}
	return { status: 500, error: 'Failed to generate answer. Please try again.' };
}
