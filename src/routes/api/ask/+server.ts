import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildAskContext } from '$lib/ai/buildAskContext';
import { trimLegacyContext } from '$lib/ai/buildRichContext';
import { enrichAnswerLinks } from '$lib/ai/enrichAnswerLinks';
import { sanitizeAskAnswer } from '$lib/ai/sanitizeAskAnswer';
import { llmFallbackReason } from '$lib/ai/fallbackAnswers';
import { buildCrdUserMessage } from '$lib/ai/prompts';
import type { RagSource } from '$lib/ai/rag/chunkTypes';
import { extractCrdCandidatesFromSources, retrieveRagContext } from '$lib/ai/rag/retrieve';
import { resolveAskTargetsWithMeta } from '$lib/ai/resolveAskTargets';
import {
	ASK_AI_MAX_TOKENS,
	ASK_AI_MODEL,
	ASK_AI_REQUEST_TIMEOUT_MS,
	runWorkersAI,
	workersAIErrorResponse
} from '$lib/ai/runWorkersAI';
import { MAX_QUESTION_CHARS } from '$lib/ai/tokenBudget';
import { fetchManifest } from '$lib/manifest/fetch';
import { activeApiVersion, filterActiveManifest } from '$lib/manifest/activeCrds';
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

function releaseFolder(releaseName: string): string | null {
	return releasesConfig.releases.find((r) => r.name === releaseName)?.folder ?? null;
}

function str(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function hasGroundingContext(context: string): boolean {
	return context.trim().length > 80;
}

function buildTargetsResolved(
	targets: Awaited<ReturnType<typeof resolveAskTargetsWithMeta>>['targets'],
	kvHits: Array<{
		target: { kind: string; group: string; name: string };
		kvAnswer?: string;
		kvExample?: string;
		kvSchemaSummary?: string;
		kvFullContext?: string;
	}>
) {
	return targets.map((target) => ({
		kind: target.kind,
		group: target.group,
		name: target.name,
		version: target.version || undefined,
		kvHit: !!kvHits.find(
			(h) =>
				h.target.kind === target.kind &&
				h.target.group === target.group &&
				(h.kvAnswer?.trim() ||
					h.kvExample?.trim() ||
					h.kvSchemaSummary?.trim() ||
					h.kvFullContext?.trim())
		)
	}));
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
	const hasPinnedTarget = !!(release && kind && group);

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

	const kv = platform?.env?.AI_CACHE;
	const crdIndex = platform?.env?.CRD_INDEX;
	const docsIndex = platform?.env?.DOCS_INDEX;
	const hasRagIndexes = !!(crdIndex || docsIndex);

	const folder = releaseFolder(release);
	const manifest = folder ? (await fetchManifest(folder, undefined, originFetch)) ?? [] : [];

	let { targets, confidence, ambiguousKinds } = resolveAskTargetsWithMeta({
		question,
		release,
		pinned: hasPinnedTarget ? { kind, group } : undefined,
		manifest
	});

	if (
		confidence === 'low' &&
		ambiguousKinds &&
		ambiguousKinds.length > 1 &&
		!hasPinnedTarget
	) {
		return json(
			{
				error: `Your question matches multiple CRDs: ${ambiguousKinds.join(', ')}. Please name the exact kind and apiGroup (e.g. "Required fields for Interface in ${release}").`,
				ambiguousKinds,
				confidence,
				release,
				grounded: false
			},
			{ status: 422 }
		);
	}

	let ragSources: RagSource[] = [];
	let ragContextText = '';
	let releaseNotIndexed = false;
	let ragMeta:
		| {
				chunkCount: number;
				topScore: number;
				release: string;
				sufficient: boolean;
				skipped: boolean;
		  }
		| undefined;

	if (targets.length < 2 && hasRagIndexes) {
		const probeRag = await retrieveRagContext(ai, crdIndex, docsIndex, question, {
			release: release || undefined,
			kind: hasPinnedTarget ? kind : undefined,
			group: hasPinnedTarget ? group : undefined
		});
		const candidates = extractCrdCandidatesFromSources(probeRag.sources);
		if (candidates.length) {
			const enriched = resolveAskTargetsWithMeta({
				question,
				release,
				pinned: hasPinnedTarget ? { kind, group } : undefined,
				manifest,
				ragCandidates: candidates
			});
			if (enriched.targets.length > targets.length) {
				targets = enriched.targets;
				confidence = enriched.confidence;
				ambiguousKinds = enriched.ambiguousKinds;
			}
		}
	}

	let context = '';
	let kvHits: Awaited<ReturnType<typeof buildAskContext>>['kvHits'] = [];
	let kvCached = false;
	let askIntent: Awaited<ReturnType<typeof buildAskContext>>['intent'] = 'overview';

	if (targets.length > 0) {
		const built = await buildAskContext({
			question,
			targets,
			kv,
			originFetch,
			ai,
			crdIndex,
			docsIndex,
			version: version || undefined,
			fieldPath: fieldPath || undefined
		});
		context = built.contextText;
		kvHits = built.kvHits;
		ragSources = built.ragSources;
		ragContextText = built.ragContextText;
		releaseNotIndexed = built.releaseNotIndexed;
		ragMeta = built.ragMeta;
		askIntent = built.intent;
		kvCached = kvHits.some(
			(h) =>
				!!(
					h.kvAnswer?.trim() ||
					h.kvExample?.trim() ||
					h.kvSchemaSummary?.trim() ||
					h.kvFullContext?.trim()
				)
		);
	} else if (hasRagIndexes) {
		const rag = await retrieveRagContext(ai, crdIndex, docsIndex, question, {
			release: release || undefined
		});
		ragSources = rag.sources;
		ragContextText = rag.contextText;
		releaseNotIndexed = rag.releaseNotIndexed;
		ragMeta = {
			chunkCount: rag.mergedCount,
			topScore: rag.topScore,
			release,
			sufficient: rag.sufficient,
			skipped: false
		};
		if (ragContextText) {
			context = `## Retrieved schema excerpts\n${ragContextText}`;
		}
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

	const targetsResolved = buildTargetsResolved(targets, kvHits);
	const targetScope = targets.map((t) => ({ kind: t.kind, group: t.group }));

	try {
		const llmStart = Date.now();
		const rawAnswer = await runWorkersAI(
			ai,
			buildCrdUserMessage(context, question, targetScope, askIntent),
			{
				model: ASK_AI_MODEL,
				maxTokens: ASK_AI_MAX_TOKENS,
				temperature: ASK_TEMPERATURE,
				timeoutMs: ASK_AI_REQUEST_TIMEOUT_MS
			}
		);
		const llmMs = Date.now() - llmStart;

		const { answer, relatedLinks } = enrichAnswerLinks({
			answer: sanitizeAskAnswer(rawAnswer, askIntent),
			release,
			targets: targets.map((t) => ({
				kind: t.kind,
				group: t.group,
				name: t.name,
				version: t.version
			})),
			origin: url.origin
		});

		console.info(
			JSON.stringify({
				event: 'ask_ai',
				intent: askIntent,
				targetCount: targets.length,
				kvCached,
				contextChars: context.length,
				llmMs,
				model: ASK_AI_MODEL,
				confidence
			})
		);

		return json({
			answer,
			grounded: true,
			release,
			kvCached,
			formattedBy: 'llm',
			confidence,
			intent: askIntent,
			relatedLinks,
			targetsResolved,
			...(ragSources.length > 0 ? { sources: ragSources } : {}),
			...(ragMeta ? { rag: ragMeta } : {})
		});
	} catch (err) {
		console.error('Workers AI error:', err);
		const { status, error } = workersAIErrorResponse(err);
		return json({ error, fallbackReason: llmFallbackReason(err) }, { status });
	}
};
