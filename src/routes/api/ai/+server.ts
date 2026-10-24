import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import {
	ACTION_MAX_TOKENS,
	promptCompare,
	promptExample,
	promptExplain,
	promptField,
	promptFixPatch,
	promptFixYaml,
	promptFixYamlMigration,
	promptFixYamlSyntax,
	promptSpecSearch,
	promptValidate,
	FIX_PROMPT_VERSION,
	type FixIssueContext
} from '$lib/ai/actionPrompts';
import { buildFixInput, spliceFixedExcerpt, type FixInput } from '$lib/ai/fixInput';
import { runVerifiedFix } from '$lib/ai/runFix';
import { tryRuleFix } from '$lib/ai/ruleFix';
import { parsePatchAnswer } from '$lib/ai/fixPatch';
import {
	schemaHintsForField,
	specSchemaAtPath,
	verifyFix,
	verifyMigrationFix
} from '$lib/ai/verifyFix';
import { loadAiSchema } from '$lib/ai/loadAiSchema';
import {
	buildCacheKey,
	buildReleaseCacheKey,
	buildVerifiedFixCacheKey,
	FIX_CACHE_TTL_SECONDS,
	getCachedAiResponse,
	getCachedAiResponseWithFallback,
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
	estimateNeurons,
	runWorkersAIMessages,
	workersAIErrorResponse,
	type AiUsage,
	FIX_AI_REQUEST_TIMEOUT_MS,
	fixMaxTokensForOutput,
	modelForTier,
	resolveAiGateway,
	resolveAiModels,
	selectFixModel
} from '$lib/ai/runWorkersAI';
import { MAX_YAML_INPUT_BYTES } from '$lib/yaml/inputLimits';

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

/** Upper bounds on untrusted input so a single request cannot inflate Workers AI prompt cost. */
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_USER_YAML_CHARS = MAX_YAML_INPUT_BYTES;
const MAX_FIELD_CHARS = 1024;
const MAX_FIX_ISSUES = 100;

/**
 * LLM actions with no UI that only cost quota: `validate` (uncached, large prompts) duplicates the
 * browser validator, and `compare` works from truncated schemas while the diff engine is exact.
 */
const DISABLED_ACTIONS = new Set<string>(['validate', 'compare']);

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

/** Version part of the document's `apiVersion`, when it belongs to `group` (or no group is known). */
function declaredVersionForGroup(yaml: string, group: string | undefined): string | undefined {
	const apiVersion = /^apiVersion:\s*["']?([^\s"'#]+)/m.exec(yaml)?.[1];
	const [docGroup, docVersion] = apiVersion?.split('/') ?? [];
	if (!docVersion || (group && docGroup !== group)) return undefined;
	return docVersion;
}

/** One structured line per AI call, readable in Workers Logs (fix success rate, latency, retries). */
/** A missing required field that takes one value (not a list or an object): fits a CHANGE line. */
function requiredTargetIsScalar(specSchema: unknown, issue: FixIssueContext): boolean {
	const named = /([A-Za-z0-9_.]+) is required/.exec(issue.message)?.[1];
	const path =
		named && issue.fieldPath && named.startsWith(issue.fieldPath) ? named : issue.fieldPath;
	if (!path) return false;
	const node = specSchemaAtPath(specSchema, path) as { type?: unknown } | null;
	const type = Array.isArray(node?.type) ? node?.type[0] : node?.type;
	return type === 'string' || type === 'integer' || type === 'number' || type === 'boolean';
}

function logAiEvent(event: Record<string, unknown>): void {
	console.log(JSON.stringify({ evt: 'ai', ...event }));
}

export const POST: RequestHandler = async ({ request, platform, url }) => {
	// Browsers always send these on POST; refuse calls from other sites' pages. Scripts that
	// send no Origin (warm-cache) are still allowed — rate limiting is done at the Cloudflare edge.
	const fetchSite = request.headers.get('sec-fetch-site');
	const origin = request.headers.get('origin');
	if (
		(fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') ||
		(origin && origin !== url.origin)
	) {
		return json({ error: 'Cross-site requests are not allowed.' }, { status: 403 });
	}

	const ai = platform?.env?.AI;
	const models = resolveAiModels(privateEnv);
	const gateway = resolveAiGateway(privateEnv);

	if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
		return json({ error: 'Request body too large' }, { status: 413 });
	}

	let body: AiBody;
	try {
		const raw = await request.text();
		if (raw.length > MAX_BODY_BYTES) {
			return json({ error: 'Request body too large' }, { status: 413 });
		}
		body = JSON.parse(raw);
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	if (!body || typeof body !== 'object') {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	if (Array.isArray(body.issues) && body.issues.length > MAX_FIX_ISSUES) {
		return json({ error: `At most ${MAX_FIX_ISSUES} issues per request` }, { status: 400 });
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

	if (userYaml.length > MAX_USER_YAML_CHARS) {
		return json({ error: 'userYaml is too large' }, { status: 413 });
	}
	if ((field?.length ?? 0) > MAX_FIELD_CHARS) {
		return json({ error: 'field is too long' }, { status: 400 });
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

	if (DISABLED_ACTIONS.has(action)) {
		return json({ error: `The ${action} action is not available.` }, { status: 404 });
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
			return json(
				{ error: 'issue.message or issues[] is required for action=fix' },
				{ status: 400 }
			);
		}
	}
	if (action === 'compare' && !compareRelease) {
		return json({ error: 'compareRelease is required for action=compare' }, { status: 400 });
	}
	if (action === 'spec-search' && !field) {
		return json(
			{ error: 'field (search query) is required for action=spec-search' },
			{ status: 400 }
		);
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

		// Fix against the schema of the apiVersion the document declares (like the browser
		// validator does); the latest schema would "fix" toward a version the user isn't on.
		const fixVersion = version ?? declaredVersionForGroup(userYaml, group);
		const loadedSchema = kind
			? ((fixVersion
					? await loadAiSchema(release, kind, originFetch, group, fixVersion, {
							allowDeprecated: true
						})
					: null) ?? (await loadAiSchema(release, kind, originFetch, group)))
			: null;
		// Deprecation is reported to the user separately; flagging it in a fix prompt invites the
		// model to "upgrade" apiVersion, which the minimal-edit guard then rejects.
		const schema = loadedSchema ? { ...loadedSchema, deprecated: false } : null;

		// Single-issue fixes: short docs go in full, long ones as an excerpt that is spliced back.
		const input: FixInput = isMigrationBatch
			? { mode: 'full', doc: userYaml.trim() }
			: buildFixInput(userYaml, primaryIssue.fieldPath);
		// Allowed values / types come from the CRD schema, not from the client.
		const issueForPrompt: FixIssueContext = schema
			? { ...primaryIssue, ...schemaHintsForField(schema.specSchema, primaryIssue.fieldPath) }
			: primaryIssue;

		// Rules first: when the schema (or the YAML parser) decides the answer, no Workers AI call.
		// Also when the browser has a one-click fix: the AI Fix button then simply works.
		if (!isMigrationBatch) {
			const rule = tryRuleFix(input.doc, issueForPrompt, schema?.specSchema);
			const ruleIssue = {
				...issueForPrompt,
				suggestedFix: rule?.suggestedFix ?? issueForPrompt.suggestedFix
			};
			if (
				rule &&
				verifyFix({
					originalDoc: input.doc,
					fixedDoc: rule.fixedDoc,
					issue: ruleIssue,
					specSchema: schema?.specSchema
				}).ok
			) {
				logAiEvent({
					action,
					release,
					kind,
					cached: false,
					verified: true,
					model: 'rules',
					issueKind: primaryIssue.issueKind,
					neurons: 0
				});
				return json({
					answer: rule.explanation,
					release,
					kind: kind || undefined,
					action: 'fix' as const,
					explanation: rule.explanation,
					fixedYaml: rule.fixedDoc,
					fixable: true,
					verified: true,
					attempts: 0,
					model: 'rules',
					neurons: 0,
					cached: false
				});
			}
		}

		// Only reached when the rules couldn't do the one-click fix themselves.
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

		// One-field issues: the model answers with one CHANGE line (few output tokens), applied here.
		const patchMode =
			!!schema &&
			!isMigrationBatch &&
			!primaryIssue.relocationHint &&
			!primaryIssue.migrationContext &&
			['enum', 'type', 'required', 'unknownField', 'misspelledField'].includes(
				primaryIssue.issueKind ?? ''
			) &&
			(primaryIssue.issueKind !== 'required' ||
				requiredTargetIsScalar(schema.specSchema, primaryIssue));

		const prompt =
			schema && patchMode
				? promptFixPatch(
						release,
						kind,
						schema,
						input.mode === 'excerpt' ? input.excerpt : input.doc,
						issueForPrompt
					)
				: schema
					? isMigrationBatch
						? promptFixYamlMigration(release, kind, schema, input.doc, migrationIssues)
						: promptFixYaml(
								release,
								kind,
								schema,
								input.doc,
								issueForPrompt,
								input.mode === 'excerpt'
									? {
											excerpt: {
												text: input.excerpt,
												startLine: input.startLine,
												endLine: input.endLine,
												totalLines: input.totalLines
											}
										}
									: undefined
							)
					: promptFixYamlSyntax(release, input.doc, primaryIssue);

		const initialModel = patchMode
			? models.default
			: modelForTier(
					selectFixModel(primaryIssue.issueKind, {
						batched: isMigrationBatch,
						relocationHint: primaryIssue.relocationHint,
						migrationContext: primaryIssue.migrationContext,
						fieldPath: primaryIssue.fieldPath
					}),
					models
				);
		const fixCacheKey = await buildVerifiedFixCacheKey({
			release,
			promptVersion: FIX_PROMPT_VERSION,
			model: initialModel,
			system: prompt.system,
			user: prompt.user
		});

		const cached = await getCachedAiResponse(kv, fixCacheKey);
		// A cached fix is re-checked with today's verification (free): an entry cached before a
		// stricter check, or under an older schema, is ignored and recomputed.
		const cachedStillValid =
			!!cached?.fixedYaml &&
			(isMigrationBatch
				? verifyMigrationFix({
						originalDoc: input.doc,
						fixedDoc: cached.fixedYaml,
						issues: migrationIssues
					}).ok
				: verifyFix({
						originalDoc: input.doc,
						fixedDoc: cached.fixedYaml,
						issue: issueForPrompt,
						specSchema: schema?.specSchema
					}).ok);
		if (cached?.fixedYaml && cachedStillValid) {
			logAiEvent({ action, release, kind, cached: true, verified: true });
			return json({
				answer: cached.answer,
				release,
				kind: kind || undefined,
				action: 'fix',
				explanation: cached.explanation,
				fixedYaml: cached.fixedYaml,
				fixable: true,
				verified: true,
				neurons: 0,
				cached: true
			});
		}

		const expectedOutput = input.mode === 'excerpt' ? input.excerpt : input.doc;
		const maxTokens = patchMode
			? 160
			: fixMaxTokensForOutput(expectedOutput, primaryIssue.issueKind, {
					batched: isMigrationBatch
				});
		const usages: AiUsage[] = [];
		const startedAt = Date.now();

		try {
			const result = await runVerifiedFix({
				prompt,
				models,
				initialModel,
				run: (model, messages) =>
					runWorkersAIMessages(ai!, messages, {
						model,
						maxTokens,
						temperature: DETERMINISTIC_TEMPERATURE,
						seed: DETERMINISTIC_SEED,
						timeoutMs: FIX_AI_REQUEST_TIMEOUT_MS,
						gateway,
						onUsage: (u) => usages.push(u)
					}),
				...(patchMode
					? {
							parse: (answer: string) => parsePatchAnswer(answer, input.doc),
							retryModel: models.default
						}
					: {}),
				toFullDocument: (fixedYaml) =>
					!patchMode && input.mode === 'excerpt' ? spliceFixedExcerpt(input, fixedYaml) : fixedYaml,
				verify: (fixedDoc) =>
					isMigrationBatch
						? verifyMigrationFix({ originalDoc: input.doc, fixedDoc, issues: migrationIssues })
						: verifyFix({
								originalDoc: input.doc,
								fixedDoc,
								issue: issueForPrompt,
								specSchema: schema?.specSchema
							})
			});

			logAiEvent({
				action,
				release,
				kind,
				cached: false,
				verified: result.verified,
				attempts: result.attempts,
				model: result.model,
				mode: input.mode,
				issueKind: primaryIssue.issueKind,
				rejectReason: result.rejectReason,
				patchMode,
				tokensIn: usages.reduce((n, u) => n + u.promptTokens, 0),
				tokensOut: usages.reduce((n, u) => n + u.completionTokens, 0),
				neurons: estimateNeurons(usages),
				ms: Date.now() - startedAt
			});

			// Only verified fixes are shared through the cache; a KV error never fails the request.
			if (result.verified && result.fixedYaml && kv) {
				const write = putCachedAiResponse(
					kv,
					fixCacheKey,
					{
						answer: result.answer,
						release,
						kind: kind || RELEASE_CACHE_KIND,
						action: 'fix',
						explanation: result.explanation,
						fixedYaml: result.fixedYaml,
						fixable: true
					},
					{ expirationTtl: FIX_CACHE_TTL_SECONDS }
				).catch((err) => console.error('AI fix cache write failed:', err));
				platform?.context?.waitUntil(write);
			}

			return json({
				answer: result.answer,
				release,
				kind: kind || undefined,
				action: 'fix' as const,
				explanation: result.explanation,
				fixedYaml: result.fixedYaml,
				fixable: result.fixable,
				verified: result.verified,
				attempts: result.attempts,
				model: result.model,
				neurons: estimateNeurons(usages),
				cached: false
			});
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
				action === 'example' && cached.examples?.length ? pickRandomExample(cached) : cached;
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
				model: models.default,
				maxTokens: ACTION_MAX_TOKENS[action] ?? 512,
				temperature: DETERMINISTIC_TEMPERATURE,
				seed: DETERMINISTIC_SEED,
				gateway
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
