import { buildSlimTargetContext } from '$lib/ai/buildRichContext';
import { classifyQuestionIntent, questionAsksRelationships } from '$lib/ai/classifyQuestionIntent';
import {
	assembleFullKvContext,
	formatKvContextSection,
	formatKvExampleContextSection,
	formatKvFullContextSection,
	formatSchemaContextForLlm,
	formatSchemaSummaryForKv,
	resolveKvExampleText
} from '$lib/ai/formatAnswer';
import { formatRelationshipsForKv } from '$lib/ai/formatRelationships';
import { getCachedAiResponsesForTargets, type AiCachePayload } from '$lib/ai/kvCache';
import { loadAiSchema } from '$lib/ai/loadAiSchema';
import type { RagSource } from '$lib/ai/rag/chunkTypes';
import {
	crdChunkMatchesFilters,
	hasStrictCrdTarget,
	isRagSufficient,
	retrieveRagContext
} from '$lib/ai/rag/retrieve';
import {
	questionMentionsCrossRelease,
	questionMentionsFieldPath,
	questionAsksExampleYaml,
	questionAsksRequiredFields,
	type ResolvedAskTarget
} from '$lib/ai/resolveAskTargets';
import {
	assembleContext,
	MULTI_TARGET_KV_CHAR_POOL,
	SINGLE_TARGET_KV_CHAR_LIMIT,
	trimToBudget,
	type ContextTier
} from '$lib/ai/tokenBudget';

export type TargetKvHit = {
	target: ResolvedAskTarget;
	kvAnswer?: string;
	kvExample?: string;
	kvSchemaSummary?: string;
	kvRelationships?: string;
	kvFullContext?: string;
	kvContextText?: string;
	kvExampleContextText?: string;
	kvFullContextText?: string;
	kvRelationshipsText?: string;
	/** True when warmed full-context or schema-summary KV is present. */
	hasCompleteKvContext?: boolean;
};

export type TargetSchemaContext = {
	target: ResolvedAskTarget;
	schema: Awaited<ReturnType<typeof loadAiSchema>>;
	schemaContextText: string;
};

export type BuildAskContextInput = {
	question: string;
	targets: ResolvedAskTarget[];
	kv: KVNamespace | undefined;
	originFetch: typeof fetch;
	ai: Ai;
	crdIndex?: VectorizeIndex;
	docsIndex?: VectorizeIndex;
	version?: string;
	fieldPath?: string;
	/** When true, skip Vectorize retrieval entirely. */
	skipRag?: boolean;
};

export type BuildAskContextResult = {
	contextText: string;
	kvHits: TargetKvHit[];
	schemas: TargetSchemaContext[];
	ragSources: RagSource[];
	ragContextText: string;
	intent: ReturnType<typeof classifyQuestionIntent>;
	ragMeta?: {
		chunkCount: number;
		topScore: number;
		release: string;
		sufficient: boolean;
		skipped: boolean;
	};
	releaseNotIndexed: boolean;
};

function targetKey(target: ResolvedAskTarget): string {
	return `${target.kind}::${target.group}`;
}

/** KV char budget per target — single-target questions keep full warmed payloads. */
export function perTargetKvCharLimit(targetCount: number): number {
	if (targetCount <= 1) return SINGLE_TARGET_KV_CHAR_LIMIT;
	return Math.max(6_000, Math.floor(MULTI_TARGET_KV_CHAR_POOL / targetCount));
}

/** Schema char budget per target — generous for single-target, split for multi. */
export function perTargetSchemaCharLimit(targetCount: number): number {
	if (targetCount <= 1) return 20_000;
	return Math.max(4_000, Math.floor(36_000 / targetCount));
}

export function shouldSkipRag(params: {
	question: string;
	targets: ResolvedAskTarget[];
	kvHits: TargetKvHit[];
	hasSchema: boolean;
	/** One resolved CRD in scope (pinned page or question-resolved kind). */
	singleFocused: boolean;
}): boolean {
	const { question, targets, kvHits, hasSchema, singleFocused } = params;
	if (questionMentionsFieldPath(question)) return false;
	if (questionMentionsCrossRelease(question)) return false;
	if (!targets.length) return false;

	const kvHitCount = kvHits.filter(
		(h) =>
			h.kvFullContext?.trim() ||
			h.kvAnswer?.trim() ||
			h.kvExample?.trim() ||
			h.kvSchemaSummary?.trim() ||
			h.kvRelationships?.trim()
	).length;
	const kvCoverage = kvHitCount / targets.length;

	if (singleFocused && kvHits.some((h) => h.kvFullContext?.trim())) return true;
	if (singleFocused && kvHitCount > 0 && hasSchema) return true;
	if (kvCoverage >= 0.5 && !questionMentionsFieldPath(question)) return true;
	return false;
}

export async function buildAskContext(input: BuildAskContextInput): Promise<BuildAskContextResult> {
	const {
		question,
		targets,
		kv,
		originFetch,
		ai,
		crdIndex,
		docsIndex,
		version,
		fieldPath,
		skipRag: forceSkipRag
	} = input;

	const release = targets[0]?.release ?? '';
	const intent = classifyQuestionIntent(question);
	const singleFocused = targets.length === 1;
	const pinnedSingle = singleFocused && targets[0].source === 'pinned';
	const asksExample = questionAsksExampleYaml(question);
	const asksRelationships = questionAsksRelationships(question) || intent === 'relationships';
	const targetCount = Math.max(targets.length, 1);
	const kvLimit = perTargetKvCharLimit(targetCount);
	const schemaLimit = perTargetSchemaCharLimit(targetCount);

	const targetRefs = targets.map((t) => ({ release: t.release, kind: t.kind, group: t.group }));

	const [explainMap, schemaSummaryMap, fullContextMap, relationshipsMap, exampleMap] =
		await Promise.all([
			getCachedAiResponsesForTargets(kv, targetRefs, 'explain'),
			getCachedAiResponsesForTargets(kv, targetRefs, 'schema-summary'),
			getCachedAiResponsesForTargets(kv, targetRefs, 'full-context'),
			getCachedAiResponsesForTargets(kv, targetRefs, 'relationships'),
			asksExample
				? getCachedAiResponsesForTargets(kv, targetRefs, 'example')
				: Promise.resolve(new Map<string, AiCachePayload | null>())
		]);

	const kvHits: TargetKvHit[] = targets.map((target) => {
		const key = targetKey(target);
		const explainCached = explainMap.get(key);
		const schemaSummaryCached = schemaSummaryMap.get(key);
		const fullContextCached = fullContextMap.get(key);
		const relationshipsCached = relationshipsMap.get(key);
		const exampleCached = exampleMap.get(key);

		const kvAnswer = explainCached?.answer?.trim();
		const kvSchemaSummary = schemaSummaryCached?.answer?.trim();
		const kvRelationships = relationshipsCached?.answer?.trim();
		const kvFullContext = fullContextCached?.answer?.trim();
		const kvExample = resolveKvExampleText(exampleCached);

		const hasCompleteKvContext = !!(kvFullContext?.trim() || kvSchemaSummary?.trim());

		let kvFullContextText: string | undefined;
		if (kvFullContext?.trim()) {
			kvFullContextText = formatKvFullContextSection(kvFullContext, target.kind);
		} else if (hasCompleteKvContext || kvRelationships || kvAnswer || kvExample) {
			const assembled = assembleFullKvContext({
				schemaSummary: kvSchemaSummary,
				relationships: kvRelationships,
				explain: kvAnswer,
				example: kvExample
			});
			if (assembled.trim()) {
				kvFullContextText = formatKvFullContextSection(assembled, target.kind);
			}
		}

		const kvRelationshipsText = kvRelationships
			? `## CRD relationships — ${target.kind}\n${kvRelationships}`
			: undefined;

		return {
			target,
			kvAnswer: kvAnswer || undefined,
			kvSchemaSummary: kvSchemaSummary || undefined,
			kvRelationships: kvRelationships || undefined,
			kvFullContext: kvFullContext || undefined,
			kvExample: kvExample || undefined,
			kvContextText: kvAnswer ? formatKvContextSection(kvAnswer, target.kind) : undefined,
			kvExampleContextText: kvExample
				? formatKvExampleContextSection(kvExample, target.kind)
				: undefined,
			kvFullContextText,
			kvRelationshipsText,
			hasCompleteKvContext
		};
	});

	const ragFilters = singleFocused
		? {
				release: targets[0].release,
				kind: targets[0].kind,
				group: targets[0].group
			}
		: { release: release || undefined };

	let ragSources: RagSource[] = [];
	let ragContextText = '';
	let ragMeta:
		| {
				chunkCount: number;
				topScore: number;
				release: string;
				sufficient: boolean;
				skipped: boolean;
		  }
		| undefined;
	let releaseNotIndexed = false;
	let ragSufficient = false;

	const skipRag =
		forceSkipRag ??
		shouldSkipRag({
			question,
			targets,
			kvHits,
			hasSchema: kvHits.some(
				(h) => !!(h.kvSchemaSummary?.trim() || h.kvFullContext?.trim())
			),
			singleFocused
		});

	const hasRagIndexes = !!(crdIndex || docsIndex);
	const kvCoverageRatio =
		kvHits.filter(
			(h) =>
				h.kvFullContext?.trim() ||
				h.kvSchemaSummary?.trim() ||
				h.kvAnswer?.trim() ||
				h.kvRelationships?.trim()
		).length / Math.max(targets.length, 1);
	const ragTopK = kvCoverageRatio < 0.5 ? 10 : 6;

	if (hasRagIndexes && !skipRag) {
		const rag = await retrieveRagContext(ai, crdIndex, docsIndex, question, ragFilters, ragTopK);
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
		ragSufficient = rag.sufficient;
		ragMeta = {
			chunkCount: rag.mergedCount,
			topScore: rag.topScore,
			release,
			sufficient: rag.sufficient,
			skipped: false
		};
	} else if (hasRagIndexes) {
		ragMeta = {
			chunkCount: 0,
			topScore: 0,
			release,
			sufficient: false,
			skipped: true
		};
	}

	const hasKvSchemaSummary = kvHits.some(
		(h) => h.kvSchemaSummary?.trim() || h.kvFullContext?.trim()
	);

	const singleTargetColdKv =
		singleFocused && !kvHits[0]?.hasCompleteKvContext && !kvHits[0]?.kvRelationships?.trim();

	const needsSchema =
		singleTargetColdKv ||
		(!hasKvSchemaSummary &&
			(questionAsksRequiredFields(question) ||
				questionMentionsFieldPath(question) ||
				asksRelationships ||
				(asksExample && !kvHits.some((h) => h.kvExample?.trim())) ||
				(!asksExample &&
					kvHits.filter(
						(h) => h.kvAnswer || h.kvFullContext || h.kvSchemaSummary || h.kvRelationships
					).length < targets.length) ||
				(pinnedSingle &&
					!kvHits[0]?.kvAnswer &&
					!kvHits[0]?.kvExample &&
					!kvHits[0]?.kvSchemaSummary &&
					!kvHits[0]?.kvFullContext &&
					!kvHits[0]?.kvRelationships)));

	const schemas: TargetSchemaContext[] = [];
	if (needsSchema && targets.length) {
		const schemaResults = await Promise.all(
			targets.map(async (target) => {
				const schema = await loadAiSchema(
					target.release,
					target.kind,
					originFetch,
					target.group,
					version || undefined
				);
				if (!schema) return null;

				const useSlim =
					pinnedSingle &&
					targets.length === 1 &&
					ragSufficient &&
					isRagSufficient(ragMeta?.chunkCount ?? 0, ragMeta?.topScore ?? 0) &&
					!questionMentionsFieldPath(question) &&
					!singleTargetColdKv;

				let schemaContextText: string;
				if (useSlim) {
					schemaContextText = buildSlimTargetContext({
						release: target.release,
						kind: target.kind,
						group: target.group,
						version: version || undefined,
						fieldPath: fieldPath || undefined,
						question
					});
				} else if (singleTargetColdKv || asksRelationships) {
					schemaContextText = [
						formatSchemaSummaryForKv(schema),
						formatRelationshipsForKv(schema)
					].join('\n\n');
				} else {
					schemaContextText = formatSchemaContextForLlm(schema);
				}

				return { target, schema, schemaContextText };
			})
		);
		for (const row of schemaResults) {
			if (row) schemas.push(row);
		}
	}

	const sections: { tier: ContextTier; text: string }[] = [];

	for (const hit of kvHits) {
		const headerBase = `## CRD: ${hit.target.kind} (${hit.target.group})`;

		if (hit.kvFullContextText) {
			const header = trimToBudget(`${headerBase}\n${hit.kvFullContextText}`, kvLimit);
			sections.push({ tier: 'kv', text: header });
			if (hit.hasCompleteKvContext) continue;
		}

		if (asksExample && hit.kvExampleContextText) {
			const header = trimToBudget(`${headerBase}\n${hit.kvExampleContextText}`, kvLimit);
			sections.push({ tier: 'kv', text: header });
		}
		if (hit.kvContextText) {
			const header = trimToBudget(`${headerBase}\n${hit.kvContextText}`, kvLimit);
			sections.push({ tier: 'kv', text: header });
		}
		if (hit.kvSchemaSummary && !hit.kvFullContextText) {
			const header = trimToBudget(`${headerBase}\n${hit.kvSchemaSummary}`, kvLimit);
			sections.push({ tier: 'kv', text: header });
		}
		if (hit.kvRelationshipsText && !hit.kvFullContextText && asksRelationships) {
			const header = trimToBudget(`${headerBase}\n${hit.kvRelationshipsText}`, kvLimit);
			sections.push({ tier: 'kv', text: header });
		}
	}

	for (const row of schemas) {
		if (
			kvHits.some(
				(h) =>
					h.target.kind === row.target.kind &&
					h.target.group === row.target.group &&
					h.hasCompleteKvContext
			)
		) {
			continue;
		}
		const header = trimToBudget(
			`## CRD: ${row.target.kind} (${row.target.group})\n${row.schemaContextText}`,
			schemaLimit
		);
		sections.push({ tier: 'target', text: header });
	}

	if (ragContextText) {
		const ragHeader =
			targets.length === 1
				? `## Indexed excerpts (${targets[0].kind} / ${targets[0].group} only)\n${ragContextText}`
				: `## Indexed excerpts\n${ragContextText}`;
		sections.push({ tier: 'rag', text: ragHeader });
	}

	const contextText = assembleContext(sections);

	return {
		contextText,
		kvHits,
		schemas,
		ragSources,
		ragContextText,
		ragMeta,
		releaseNotIndexed,
		intent
	};
}
