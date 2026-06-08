import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildRichContext, trimLegacyContext } from '$lib/ai/buildRichContext';
import { buildCrdUserMessage } from '$lib/ai/prompts';
import { retrieveRagContext } from '$lib/ai/rag/retrieve';
import { runWorkersAI, workersAIErrorResponse } from '$lib/ai/runWorkersAI';
import { assembleContext, MAX_QUESTION_CHARS } from '$lib/ai/tokenBudget';

type AskBody = {
	question?: unknown;
	context?: unknown;
	release?: unknown;
	kind?: unknown;
	group?: unknown;
	version?: unknown;
	fieldPath?: unknown;
	filters?: {
		release?: unknown;
		kind?: unknown;
		group?: unknown;
	};
};

function str(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

export const POST: RequestHandler = async ({ request, platform, url }) => {
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

	let body: AskBody;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const question = str(body.question);
	if (!question) {
		return json({ error: 'Question is required' }, { status: 400 });
	}
	if (question.length > MAX_QUESTION_CHARS) {
		return json({ error: `Question must be at most ${MAX_QUESTION_CHARS} characters` }, { status: 400 });
	}

	const release = str(body.release) || str(body.filters?.release);
	const kind = str(body.kind) || str(body.filters?.kind);
	const group = str(body.group) || str(body.filters?.group);
	const version = str(body.version);
	const fieldPath = str(body.fieldPath);

	const originFetch: typeof fetch = (input, init) => {
		const href =
			typeof input === 'string'
				? input.startsWith('http')
					? input
					: new URL(input, url.origin).href
				: input instanceof URL
					? input.href
					: input.url.startsWith('http')
						? input.url
						: new URL(input.url, url.origin).href;
		return fetch(href, init);
	};

	let ragSources: string[] = [];
	let context = '';

	const vectorIndex = platform?.env?.CRD_INDEX;
	if (vectorIndex && (release || kind || group)) {
		const rag = await retrieveRagContext(ai, vectorIndex, question, {
			release: release || undefined,
			kind: kind || undefined,
			group: group || undefined
		});
		ragSources = rag.sources;
		if (rag.contextText) {
			context = rag.contextText;
		}
	}

	if (release && kind && group) {
		const rich = await buildRichContext(
			{ release, kind, group, version: version || undefined, fieldPath: fieldPath || undefined, question },
			originFetch
		);
		if (rich?.context) {
			context = assembleContext([
				{ tier: 'rag', text: context ? `## Retrieved schema excerpts\n${context}` : '' },
				{ tier: 'target', text: rich.context }
			]);
		}
	} else {
		const legacy = trimLegacyContext(body.context);
		if (legacy) {
			context = legacy;
		}
	}

	try {
		const answer = await runWorkersAI(ai, buildCrdUserMessage(context, question));
		const payload: { answer: string; sources?: string[] } = { answer };
		if (ragSources.length > 0) {
			payload.sources = ragSources;
		}
		return json(payload);
	} catch (err) {
		console.error('Workers AI error:', err);
		const { status, error } = workersAIErrorResponse(err);
		return json({ error }, { status });
	}
};
