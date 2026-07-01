import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/public';
import {
	ACTION_MAX_TOKENS,
	promptCompare,
	promptExample,
	promptExplain,
	promptField,
	promptFixYaml,
	promptFixYamlMigration,
	promptFixYamlSyntax,
	promptSpecSearch,
	promptValidate,
	type FixIssueContext
} from '$lib/ai/actionPrompts';
import { parseFixResponse } from '$lib/ai/parseFixResponse';
import { loadAiSchema } from '$lib/ai/loadAiSchema';
import {
	buildCacheKey,
	buildFixCacheKey,
	buildMigrationFixCacheKey,
	buildReleaseCacheKey,
	getCachedAiResponse,
	getCachedAiResponseWithFallback,
	hashDocYamlDigest,
	hashFixCacheDigest,
	hashMigrationFixDigest,
	isCacheableAction,
	isDeterministicCacheAction,
	parseExamples,
	pickRandomExample,
	putCachedAiResponse,
	RELEASE_CACHE_KIND,
	RELEASE_DEPENDENCY_MAP_ACTION,
	type AiCachePayload
} from '$lib/ai/kvCache';
import {
	assembleFullKvContext,
	formatSchemaSummaryForKv,
	resolveKvExampleText
} from '$lib/ai/formatAnswer';
import { formatDependencyMapForKv } from '$lib/ai/formatDependencyMap';
import { loadReleaseDependencyGraph } from '$lib/ai/loadReleaseDependencyGraph';
import { formatRelationshipsForKv } from '$lib/ai/formatRelationships';
import {
	buildSchemaExplainFallback,
	buildSchemaFieldFallback,
	llmFallbackReason
} from '$lib/ai/fallbackAnswers';
import {
	runWorkersAIMessages,
	workersAIErrorResponse,
	FIX_AI_MODEL,
	FIX_AI_REQUEST_TIMEOUT_MS,
	selectFixMaxTokens,
	selectFixModel,
	WORKERS_AI_MODEL
} from '$lib/ai/runWorkersAI';
import { extractYamlIssueExcerpt } from '$lib/validate-bundle/yamlIssueExcerpt';

const VALID_ACTIONS = [
	'explain',
	'field',
	'validate',
	'fix',
	'example',
	'compare',
	'spec-search',
	'schema-summary',
	'relationships',
	'dependency-map',
	'full-context'
] as const;
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
	issue?: unknown;
	issues?: unknown;
};

function parseStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const items = value.map((item) => str(item)).filter(Boolean);
	return items.length > 0 ? items : undefined;
}

function parseIssueKind(value: unknown): FixIssueContext['issueKind'] | undefined {
	const kind = str(value);
	const allowed: FixIssueContext['issueKind'][] = [
		'unknownField',
		'misspelledField',
		'enum',
		'type',
		'required',
		'syntax',
		'other'
	];
	return allowed.includes(kind as FixIssueContext['issueKind'])
		? (kind as FixIssueContext['issueKind'])
		: undefined;
}

function parseFixIssue(value: unknown): FixIssueContext | null {
	if (!value || typeof value !== 'object') return null;
	const issue = value as Record<string, unknown>;
	const message = str(issue.message);
	if (!message) return null;
	const fieldPath = str(issue.fieldPath) || undefined;
	const lineRaw = issue.line;
	const line =
		typeof lineRaw === 'number' && Number.isFinite(lineRaw) ? Math.trunc(lineRaw) : undefined;
	const severity = str(issue.severity) || undefined;
	const issueKind = parseIssueKind(issue.issueKind);
	const allowedSiblingKeys = parseStringArray(issue.allowedSiblingKeys);
	const allowedValues = parseStringArray(issue.allowedValues);
	const expectedTypes = parseStringArray(issue.expectedTypes);
	const renameHintRaw = issue.renameHint;
	let renameHint: FixIssueContext['renameHint'];
	if (renameHintRaw && typeof renameHintRaw === 'object') {
		const from = str((renameHintRaw as Record<string, unknown>).from);
		const to = str((renameHintRaw as Record<string, unknown>).to);
		if (from && to) renameHint = { from, to };
	}
	const relocationHintRaw = issue.relocationHint;
	let relocationHint: FixIssueContext['relocationHint'];
	if (relocationHintRaw && typeof relocationHintRaw === 'object') {
		const from = str((relocationHintRaw as Record<string, unknown>).from);
		const to = str((relocationHintRaw as Record<string, unknown>).to);
		if (from && to) relocationHint = { from, to };
	}
	const migrationContext = str(issue.migrationContext) || undefined;
	const relatedIssues = parseStringArray(issue.relatedIssues);
	const suggestedFixRaw = issue.suggestedFix;
	let suggestedFix: FixIssueContext['suggestedFix'];
	if (suggestedFixRaw && typeof suggestedFixRaw === 'object') {
		const field = str((suggestedFixRaw as Record<string, unknown>).field);
		const value = str((suggestedFixRaw as Record<string, unknown>).value);
		const action = str((suggestedFixRaw as Record<string, unknown>).action) || undefined;
		if (field && value) suggestedFix = { field, value, action };
	}
	const excerptYaml = str(issue.excerptYaml) || undefined;
	const excerptIsFullDocument = issue.excerptIsFullDocument === true;
	const deterministicFixAvailable = issue.deterministicFixAvailable === true;
	return {
		message,
		fieldPath,
		line,
		severity,
		renameHint,
		relocationHint,
		migrationContext,
		relatedIssues,
		issueKind,
		allowedSiblingKeys,
		allowedValues,
		expectedTypes,
		deterministicFixAvailable,
		suggestedFix,
		excerptYaml,
		excerptIsFullDocument
	};
}

function parseFixIssues(value: unknown): FixIssueContext[] {
	if (!Array.isArray(value)) return [];
	return value.map(parseFixIssue).filter((issue): issue is FixIssueContext => issue !== null);
}

function str(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

export const POST: RequestHandler = async ({ request, platform, url }) => {
	const ai = platform?.env?.AI;

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
	const fixIssue = parseFixIssue(body.issue);
	const fixIssues = parseFixIssues(body.issues);
	const migrationIssues = fixIssues.length > 0 ? fixIssues : fixIssue ? [fixIssue] : [];
	const isMigrationBatch = fixIssues.length > 1;

	if (!release || !action) {
		return json({ error: 'Missing required fields: release, action' }, { status: 400 });
	}

	if (action === RELEASE_DEPENDENCY_MAP_ACTION) {
		if (kind !== RELEASE_CACHE_KIND) {
			return json(
				{
					error: `action=dependency-map requires kind=${RELEASE_CACHE_KIND}`
				},
				{ status: 400 }
			);
		}
	} else if (!kind && action !== 'fix') {
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
	if (action === 'fix') {
		if (!userYaml) {
			return json({ error: 'userYaml is required for action=fix' }, { status: 400 });
		}
		if (migrationIssues.length === 0) {
			return json({ error: 'issue.message or issues[] is required for action=fix' }, { status: 400 });
		}
	}
	if (action === 'compare' && !compareRelease) {
		return json({ error: 'compareRelease is required for action=compare' }, { status: 400 });
	}
	if (action === 'spec-search' && !field) {
		return json({ error: 'field (search query) is required for action=spec-search' }, { status: 400 });
	}

	const needsAi = !isDeterministicCacheAction(action);
	if (needsAi && !ai) {
		return json(
			{
				error:
					'Workers AI is not available. Run `npm run dev:ai` or deploy with the AI binding in wrangler.toml.'
			},
			{ status: 503 }
		);
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

	const kv = platform?.env?.AI_CACHE;
	const cacheable = isCacheableAction(action);

	if (action === RELEASE_DEPENDENCY_MAP_ACTION) {
		const cacheKey = buildReleaseCacheKey({ release, action });
		if (cacheable) {
			const cached = await getCachedAiResponse(kv, cacheKey);
			if (cached) {
				return json({ ...cached, cached: true });
			}
		}
		const graph = await loadReleaseDependencyGraph(release, originFetch);
		if (!graph) {
			return json(
				{
					error: `dependency-graph.json not found for release ${release}. Run npm run build:dependency-graph.`
				},
				{ status: 404 }
			);
		}
		const answer = formatDependencyMapForKv(graph, release);
		const responsePayload: AiCachePayload = {
			answer,
			release,
			kind: RELEASE_CACHE_KIND,
			action
		};
		if (cacheable) {
			await putCachedAiResponse(kv, cacheKey, responsePayload);
		}
		return json({ ...responsePayload, cached: false });
	}

	if (action === 'fix') {
		if (env.PUBLIC_FIX_AI_ENABLED === 'false') {
			return json(
				{
					error:
						'YAML fix AI is disabled. Set PUBLIC_FIX_AI_ENABLED=true (or unset) at build time to enable.'
				},
				{ status: 403 }
			);
		}

		const primaryIssue = migrationIssues[0]!;

		if (
			!isMigrationBatch &&
			(primaryIssue.renameHint ||
				primaryIssue.relocationHint ||
				primaryIssue.issueKind === 'misspelledField' ||
				primaryIssue.deterministicFixAvailable)
		) {
			return json(
				{
					error:
						'This issue has a deterministic schema fix (rename, relocate, clamp, or add field). Apply the one-click Fix instead of AI.',
					fixable: false
				},
				{ status: 422 }
			);
		}

		const fixKind = kind || RELEASE_CACHE_KIND;
		const docDigest = hashDocYamlDigest(userYaml);
		const issueIdsDigest = hashMigrationFixDigest(
			migrationIssues.map(
				(issue) =>
					`${issue.issueKind ?? ''}|${issue.fieldPath ?? ''}|${hashFixCacheDigest(issue.message, issue.fieldPath, issue.issueKind)}`
			)
		);

		const fixCacheKey = isMigrationBatch
			? buildMigrationFixCacheKey({
					release,
					kind: fixKind,
					group,
					docDigest,
					issueIdsDigest
				})
			: fixKind && fixKind !== RELEASE_CACHE_KIND
				? buildFixCacheKey({
						release,
						kind: fixKind,
						group,
						fieldPath: primaryIssue.fieldPath,
						issueKind: primaryIssue.issueKind,
						docDigest,
						messageDigest: hashFixCacheDigest(
							primaryIssue.message,
							primaryIssue.fieldPath,
							primaryIssue.issueKind
						)
					})
				: null;

		if (fixCacheKey && kv) {
			const cached = await getCachedAiResponse(kv, fixCacheKey);
			if (cached?.fixedYaml) {
				return json({
					answer: cached.answer,
					release,
					kind: kind || undefined,
					action: 'fix',
					explanation: cached.explanation,
					fixedYaml: cached.fixedYaml,
					fixable: cached.fixable,
					cached: true
				});
			}
		}

		const schema = kind
			? await loadAiSchema(release, kind, originFetch, group, version)
			: null;

		const excerpt =
			!isMigrationBatch && primaryIssue.excerptYaml && !primaryIssue.excerptIsFullDocument
				? { excerpt: primaryIssue.excerptYaml, isFullDocument: false }
				: !isMigrationBatch
					? extractYamlIssueExcerpt(userYaml, primaryIssue.fieldPath)
					: null;

		const prompt = schema
			? isMigrationBatch
				? promptFixYamlMigration(release, kind, schema, userYaml, migrationIssues)
				: promptFixYaml(release, kind, schema, userYaml, primaryIssue, {
						excerptYaml: excerpt?.isFullDocument ? undefined : excerpt?.excerpt
					})
			: promptFixYamlSyntax(release, userYaml, primaryIssue);

		const fixModelOptions = {
			batched: isMigrationBatch,
			relocationHint: primaryIssue.relocationHint,
			migrationContext: primaryIssue.migrationContext,
			fieldPath: primaryIssue.fieldPath
		};

		try {
			const initialModel = selectFixModel(primaryIssue.issueKind, fixModelOptions);
			const runFix = (model: string) =>
				runWorkersAIMessages(
					ai!,
					[
						{ role: 'system', content: prompt.system },
						{ role: 'user', content: prompt.user }
					],
					{
						model,
						maxTokens: selectFixMaxTokens(primaryIssue.issueKind, {
							batched: isMigrationBatch
						}),
						temperature: DETERMINISTIC_TEMPERATURE,
						seed: DETERMINISTIC_SEED,
						timeoutMs: FIX_AI_REQUEST_TIMEOUT_MS
					}
				);

			let answer = await runFix(initialModel);
			let parsed = parseFixResponse(answer);

			if (
				initialModel === WORKERS_AI_MODEL &&
				(!parsed.fixable || !parsed.fixedYaml)
			) {
				answer = await runFix(FIX_AI_MODEL);
				parsed = parseFixResponse(answer);
			}
			const responsePayload = {
				answer,
				release,
				kind: kind || undefined,
				action: 'fix' as const,
				explanation: parsed.explanation,
				fixedYaml: parsed.fixedYaml,
				fixable: parsed.fixable,
				cached: false
			};
			if (fixCacheKey && kv && parsed.fixable && parsed.fixedYaml) {
				await putCachedAiResponse(kv, fixCacheKey, {
					answer,
					release,
					kind: fixKind,
					action: 'fix',
					explanation: parsed.explanation,
					fixedYaml: parsed.fixedYaml,
					fixable: parsed.fixable
				});
			}
			return json(responsePayload);
		} catch (err) {
			console.error('Workers AI fix error:', err);
			const reason = llmFallbackReason(err);
			const { status, error } = workersAIErrorResponse(err);
			return json({ error, fallbackReason: reason, action }, { status });
		}
	}

	const schema = await loadAiSchema(release, kind, originFetch, group, version);
	if (!schema) {
		return json(
			{
				error: `Schema not found for ${kind} in release ${release} (inactive or deprecated-only CRD)`
			},
			{ status: 404 }
		);
	}

	const apiVersion = schema.version;
	const cacheKey = buildCacheKey({
		release,
		kind,
		group,
		apiVersion,
		field,
		compareRelease,
		action
	});

	const cacheLookup = () =>
		getCachedAiResponseWithFallback(kv, {
			release,
			kind,
			group,
			apiVersion,
			field,
			compareRelease,
			action
		});

	if (cacheable) {
		const cached = await cacheLookup();
		if (cached) {
			const response =
				action === 'example' && cached.examples?.length
					? pickRandomExample(cached)
					: cached;
			return json({ ...response, cached: true });
		}
	}

	function buildPayload(answer: string, extra?: Partial<AiCachePayload>): AiCachePayload {
		return {
			answer,
			release,
			kind,
			action,
			apiVersion,
			...extra
		};
	}

	if (action === 'schema-summary') {
		const answer = formatSchemaSummaryForKv(schema);
		const responsePayload = buildPayload(answer);
		if (cacheable) {
			await putCachedAiResponse(kv, cacheKey, responsePayload);
		}
		return json({ ...responsePayload, cached: false });
	}

	if (action === 'relationships') {
		const answer = formatRelationshipsForKv(schema);
		const responsePayload = buildPayload(answer);
		if (cacheable) {
			await putCachedAiResponse(kv, cacheKey, responsePayload);
		}
		return json({ ...responsePayload, cached: false });
	}

	if (action === 'full-context') {
		const schemaSummary =
			(
				await getCachedAiResponseWithFallback(kv, {
					release,
					kind,
					group,
					apiVersion,
					action: 'schema-summary'
				})
			)?.answer?.trim() || formatSchemaSummaryForKv(schema);

		const relationships =
			(
				await getCachedAiResponseWithFallback(kv, {
					release,
					kind,
					group,
					apiVersion,
					action: 'relationships'
				})
			)?.answer?.trim() || formatRelationshipsForKv(schema);

		const explainCached = await getCachedAiResponseWithFallback(kv, {
			release,
			kind,
			group,
			apiVersion,
			action: 'explain'
		});
		const exampleCached = await getCachedAiResponseWithFallback(kv, {
			release,
			kind,
			group,
			apiVersion,
			action: 'example'
		});

		const answer = assembleFullKvContext({
			schemaSummary,
			relationships,
			explain: explainCached?.answer,
			example: resolveKvExampleText(exampleCached)
		});

		const responsePayload = buildPayload(answer);
		if (cacheable) {
			await putCachedAiResponse(kv, cacheKey, responsePayload);
		}
		return json({ ...responsePayload, cached: false });
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
			ai!,
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

		let responsePayload: AiCachePayload = buildPayload(answer);
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
