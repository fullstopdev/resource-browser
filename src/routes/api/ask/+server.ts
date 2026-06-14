import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildRichContext, trimLegacyContext } from '$lib/ai/buildRichContext';
import { buildCrdUserMessage } from '$lib/ai/prompts';
import type { RagSource } from '$lib/ai/rag/chunkTypes';
import { crdChunkMatchesFilters, hasStrictCrdTarget, retrieveRagContext } from '$lib/ai/rag/retrieve';
import {
	buildContextFirstFallbackAnswer,
	buildRagOnlyAnswer,
	buildSchemaExplainFallback,
	llmFallbackReason
} from '$lib/ai/fallbackAnswers';
import { loadAiSchema } from '$lib/ai/loadAiSchema';
import { runWorkersAI, workersAIErrorResponse } from '$lib/ai/runWorkersAI';
import { assembleContext, MAX_QUESTION_CHARS } from '$lib/ai/tokenBudget';
import releasesYaml from '$lib/releases.yaml?raw';
import type { ReleasesConfig } from '$lib/structure';
import { loadStaticYaml } from '$lib/yaml/safeYaml';

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

/** Lower temperature for free-form Q&A — reduces creative hallucination. */
const ASK_TEMPERATURE = 0.1;

const releasesConfig = loadStaticYaml(releasesYaml) as ReleasesConfig;

function defaultReleaseName(): string {
	return (
		releasesConfig.releases.find((r) => r.default)?.name ??
		releasesConfig.releases[0]?.name ??
		'26.4.2'
	);
}

function str(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function hasGroundingContext(context: string): boolean {
	return context.trim().length > 80;
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

	const release =
		str(body.release) ||
		str(body.filters?.release) ||
		defaultReleaseName();
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

	let ragSources: RagSource[] = [];
	let context = '';
	let richContextText = '';
	let ragContextText = '';
	let targetSchemaSummary = '';
	let ragMeta: {
		chunkCount: number;
		topScore: number;
		release: string;
		sufficient: boolean;
	} | undefined;
	let releaseNotIndexed = false;

	const crdIndex = platform?.env?.CRD_INDEX;
	const docsIndex = platform?.env?.DOCS_INDEX;
	const hasRagIndexes = !!(crdIndex || docsIndex);
	const hasTarget = !!(release && kind && group);
	const ragFilters = {
		release: release || undefined,
		kind: kind || undefined,
		group: group || undefined
	};

	if (hasTarget) {
		const rich = await buildRichContext(
			{ release, kind, group, version: version || undefined, fieldPath: fieldPath || undefined, question },
			originFetch,
			{ mode: 'trimmed' }
		);
		if (rich?.context) {
			richContextText = rich.context;
		}
		const schemaPayload = await loadAiSchema(release, kind, originFetch, group, version || undefined);
		if (schemaPayload) {
			targetSchemaSummary = buildSchemaExplainFallback(schemaPayload);
		}
	}

	if (hasRagIndexes) {
		const rag = await retrieveRagContext(ai, crdIndex, docsIndex, question, ragFilters);
		ragSources = rag.sources;
		if (hasStrictCrdTarget(ragFilters)) {
			ragSources = ragSources.filter(
				(s) =>
					s.source !== 'crd-corpus' ||
					crdChunkMatchesFilters(
						{ kind: s.kind ?? '', group: s.group ?? '', release: s.release },
						ragFilters
					)
			);
		}
		ragContextText = rag.contextText;
		releaseNotIndexed = rag.releaseNotIndexed;
		ragMeta = {
			chunkCount: rag.mergedCount,
			topScore: rag.topScore,
			release,
			sufficient: rag.sufficient
		};
	}

	if (hasTarget) {
		const parts: { tier: 'target' | 'rag'; text: string }[] = [];
		if (richContextText) {
			parts.push({ tier: 'target', text: richContextText });
		} else if (targetSchemaSummary) {
			parts.push({ tier: 'target', text: `## Target CRD schema\n${targetSchemaSummary}` });
		}
		if (ragContextText) {
			parts.push({
				tier: 'rag',
				text: `## Indexed excerpts (${kind} / ${group} only)\n${ragContextText}`
			});
		}
		context = parts.length ? assembleContext(parts) : '';
	} else if (ragContextText) {
		context = `## Retrieved schema excerpts\n${ragContextText}`;
	} else {
		const legacy = trimLegacyContext(body.context);
		if (legacy) {
			context = legacy;
		}
	}

	if (!hasGroundingContext(context)) {
		if (releaseNotIndexed) {
			return json(
				{
					error: `No indexed schema or documentation found for release ${release}. Run embed:crd-corpus and embed:eda-docs for this release, then redeploy.`,
					release,
					grounded: false,
					rag: ragMeta
				},
				{ status: 404 }
			);
		}
		return json(
			{
				error:
					'Not enough grounded schema context to answer safely. Open a CRD page, mention a release (e.g. 26.4.2), or ask about a known indexed resource.',
				release,
				grounded: false,
				rag: ragMeta
			},
			{ status: 422 }
		);
	}

	try {
		const answer = await runWorkersAI(ai, buildCrdUserMessage(context, question), {
			temperature: ASK_TEMPERATURE
		});
		const payload: {
			answer: string;
			sources?: RagSource[];
			grounded: boolean;
			release: string;
			rag?: typeof ragMeta;
		} = {
			answer,
			grounded: true,
			release
		};
		if (ragSources.length > 0) {
			payload.sources = ragSources;
		}
		if (ragMeta) {
			payload.rag = ragMeta;
		}
		return json(payload);
	} catch (err) {
		console.error('Workers AI error:', err);
		if (hasGroundingContext(context)) {
			const reason = llmFallbackReason(err);
			const answer = hasTarget
				? buildContextFirstFallbackAnswer({
						question,
						release,
						kind,
						group,
						version: version || undefined,
						schemaSummary: targetSchemaSummary || undefined,
						richContext: richContextText || undefined,
						ragContext: ragContextText || undefined,
						sources: ragSources.length ? ragSources : undefined,
						reason
					})
				: buildRagOnlyAnswer({
						question,
						context,
						release,
						sources: ragSources.length ? ragSources : undefined,
						reason
					});
			return json({
				answer,
				grounded: true,
				llmFallback: true,
				fallbackReason: reason,
				release,
				...(ragSources.length ? { sources: ragSources } : {}),
				...(ragMeta ? { rag: ragMeta } : {})
			});
		}
		const { status, error } = workersAIErrorResponse(err);
		return json({ error, fallbackReason: llmFallbackReason(err) }, { status });
	}
};
