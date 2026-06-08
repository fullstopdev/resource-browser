import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const MODEL = '@cf/meta/llama-3.1-8b-instruct' as const;
const MAX_CONTEXT_CHARS = 8000;
const MAX_QUESTION_CHARS = 2000;

const SYSTEM_PROMPT = `You are an expert assistant for Nokia Event-Driven Automation (EDA) Custom Resource Definitions (CRDs).

You help engineers understand CRD schemas, fields, relationships, and typical usage patterns.
Answer concisely and accurately based on the provided CRD context (OpenAPI v3 schema fragments for spec and status).
If the context does not contain enough information, say what is missing rather than inventing details.
Use clear technical language suitable for Kubernetes / GitOps practitioners.`;

function trimContext(context: unknown): string {
	if (typeof context !== 'string') return '';
	const trimmed = context.trim();
	if (trimmed.length <= MAX_CONTEXT_CHARS) return trimmed;
	return trimmed.slice(0, MAX_CONTEXT_CHARS) + '\n…[truncated]';
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const ai = platform?.env?.AI;
	if (!ai) {
		return json(
			{
				error:
					'Workers AI is not available. Run `npm run dev:ai` (wrangler pages dev with AI binding) or deploy with the AI binding configured in wrangler.toml.'
			},
			{ status: 503 }
		);
	}

	let body: { question?: unknown; context?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const question = typeof body.question === 'string' ? body.question.trim() : '';
	if (!question) {
		return json({ error: 'Question is required' }, { status: 400 });
	}
	if (question.length > MAX_QUESTION_CHARS) {
		return json({ error: `Question must be at most ${MAX_QUESTION_CHARS} characters` }, { status: 400 });
	}

	const context = trimContext(body.context);

	try {
		const result = await ai.run(MODEL, {
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{
					role: 'user',
					content: context
						? `CRD context:\n${context}\n\nQuestion: ${question}`
						: `Question: ${question}`
				}
			],
			max_tokens: 1024,
			temperature: 0.3
		});

		const answer =
			typeof result === 'object' && result !== null && 'response' in result
				? String((result as { response?: string }).response ?? '')
				: String(result);

		return json({ answer: answer || 'No response generated.' });
	} catch (err) {
		console.error('Workers AI error:', err);
		return json({ error: 'Failed to generate answer. Please try again.' }, { status: 500 });
	}
};
