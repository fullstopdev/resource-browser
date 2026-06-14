import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	ACTION_MAX_TOKENS,
	promptCompare,
	promptExample,
	promptExplain,
	promptField,
	promptSpecSearch,
	promptValidate
} from '$lib/ai/actionPrompts';
import { loadAiSchema } from '$lib/ai/loadAiSchema';
import {
	buildCacheKey,
	getCachedAiResponseWithFallback,
	isCacheableAction,
	parseExamples,
	pickRandomExample,
	putCachedAiResponse,
	type AiCachePayload
} from '$lib/ai/kvCache';
import {
	buildSchemaExplainFallback,
	buildSchemaFieldFallback,
	llmFallbackReason
} from '$lib/ai/fallbackAnswers';
import { runWorkersAIMessages, workersAIErrorResponse } from '$lib/ai/runWorkersAI';

const VALID_ACTIONS = ['explain', 'field', 'validate', 'example', 'compare', 'spec-search'] as const;
type ValidAction = (typeof VALID_ACTIONS)[number];

const DETERMINISTIC_SEED = 42;
const DETERMINISTIC_TEMPERATURE = 0;

type AiBody = {
	release?: unknown;
	kind?: unknown;
	group?: unknown;
	version?: unknown;
	field?: unknown;
	action?: unknown;
	userYaml?: unknown;
	compareRelease?: unknown;
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
					'Workers AI is not available. Run `npm run dev:ai` or deploy with the AI binding in wrangler.toml.'
			},
			{ status: 503 }
		);
	}

	let body: AiBody;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const release = str(body.release);
	const kind = str(body.kind);
	const group = str(body.group) || undefined;
	const version = str(body.version) || undefined;
	const action = str(body.action) as ValidAction;
	const field = str(body.field) || undefined;
	const userYaml = str(body.userYaml);
	const compareRelease = str(body.compareRelease) || undefined;

	if (!release || !kind || !action) {
		return json({ error: 'Missing required fields: release, kind, action' }, { status: 400 });
	}

	if (!VALID_ACTIONS.includes(action)) {
		return json(
			{ error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` },
			{ status: 400 }
		);
	}

	if (action === 'field' && !field) {
		return json({ error: 'field is required for action=field' }, { status: 400 });
	}
	if (action === 'validate' && !userYaml) {
		return json({ error: 'userYaml is required for action=validate' }, { status: 400 });
	}
	if (action === 'compare' && !compareRelease) {
		return json({ error: 'compareRelease is required for action=compare' }, { status: 400 });
	}
	if (action === 'spec-search' && !field) {
		return json({ error: 'field (search query) is required for action=spec-search' }, { status: 400 });
	}

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

	const cacheKey = buildCacheKey({ release, kind, group, field, compareRelease, action });
	const kv = platform?.env?.AI_CACHE;
	const cacheable = isCacheableAction(action);

	if (cacheable) {
		const cached = await getCachedAiResponseWithFallback(kv, {
			release,
			kind,
			group,
			field,
			compareRelease,
			action
		});
		if (cached) {
			const response =
				action === 'example' && cached.examples?.length
					? pickRandomExample(cached)
					: cached;
			return json({ ...response, cached: true });
		}
	}

	const schema = await loadAiSchema(release, kind, originFetch, group, version);
	if (!schema) {
		return json(
			{ error: `Schema not found for ${kind} in release ${release}` },
			{ status: 404 }
		);
	}

	let prompt: { system: string; user: string };

	if (action === 'explain') {
		prompt = promptExplain(release, kind, schema);
	} else if (action === 'field') {
		prompt = promptField(release, kind, schema, field!);
	} else if (action === 'validate') {
		prompt = promptValidate(release, kind, schema, userYaml);
	} else if (action === 'example') {
		prompt = promptExample(release, kind, schema);
	} else if (action === 'compare') {
		const schemaOld = await loadAiSchema(compareRelease!, kind, originFetch, schema.group, version);
		if (!schemaOld) {
			return json(
				{ error: `Schema not found for ${kind} in release ${compareRelease}` },
				{ status: 404 }
			);
		}
		prompt = promptCompare(kind, schemaOld, schema, compareRelease!, release);
	} else {
		prompt = promptSpecSearch(release, kind, schema, field!);
	}

	try {
		const answer = await runWorkersAIMessages(
			ai,
			[
				{ role: 'system', content: prompt.system },
				{ role: 'user', content: prompt.user }
			],
			{
				maxTokens: ACTION_MAX_TOKENS[action] ?? 512,
				temperature: DETERMINISTIC_TEMPERATURE,
				seed: DETERMINISTIC_SEED
			}
		);

		let responsePayload: AiCachePayload = {
			answer,
			release,
			kind,
			action
		};
		if (field) responsePayload.field = field;
		if (compareRelease) responsePayload.compareRelease = compareRelease;

		if (action === 'example') {
			responsePayload.examples = parseExamples(answer);
		}

		if (cacheable) {
			await putCachedAiResponse(kv, cacheKey, responsePayload);
		}

		const clientPayload =
			action === 'example' && responsePayload.examples?.length
				? pickRandomExample(responsePayload)
				: responsePayload;

		return json({ ...clientPayload, cached: false });
	} catch (err) {
		console.error('Workers AI action error:', err);
		const reason = llmFallbackReason(err);
		if (action === 'explain') {
			const answer = buildSchemaExplainFallback(schema);
			return json({
				answer,
				release,
				kind,
				action,
				llmFallback: true,
				fallbackReason: reason,
				cached: false
			});
		}
		if (action === 'field' && field) {
			const answer = buildSchemaFieldFallback(schema, field);
			if (answer) {
				return json({
					answer,
					release,
					kind,
					field,
					action,
					llmFallback: true,
					fallbackReason: reason,
					cached: false
				});
			}
		}
		const { status, error } = workersAIErrorResponse(err);
		return json({ error, fallbackReason: reason, action }, { status });
	}
};
