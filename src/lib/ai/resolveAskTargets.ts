import { inferOperationalArea } from '$lib/release-notes/presentation';
import {
	crdShortName,
	findManifestEntriesByKindInsensitive,
	resolveEntryKind
} from '$lib/manifest/lookup';
import type { ManifestEntry } from '$lib/yaml-validation/types';

export const MAX_ASK_TARGETS = 10;

export type ResolvedAskTargetSource =
	| 'pinned'
	| 'kind'
	| 'apiGroup'
	| 'operationalArea'
	| 'rag';

export type ResolvedAskTarget = {
	release: string;
	kind: string;
	group: string;
	name: string;
	score: number;
	source: ResolvedAskTargetSource;
};

export type ResolveAskTargetsInput = {
	question: string;
	release: string;
	pinned?: { kind: string; group: string };
	manifest: ManifestEntry[];
	/** Optional RAG-derived candidates when manifest resolution is sparse. */
	ragCandidates?: Array<{ kind: string; group: string; score?: number }>;
};

const STOP_WORDS = new Set([
	'a',
	'an',
	'the',
	'what',
	'which',
	'how',
	'why',
	'when',
	'where',
	'is',
	'are',
	'for',
	'in',
	'on',
	'of',
	'and',
	'or',
	'to',
	'do',
	'does',
	'can',
	'could',
	'would',
	'about',
	'explain',
	'describe',
	'tell',
	'me',
	'crd',
	'crds',
	'resource',
	'resources',
	'eda',
	'kubernetes',
	'release',
	'latest',
	'field',
	'fields',
	'required',
	'example',
	'yaml',
	'manifest'
]);

const EXPLICIT_KIND_PATTERNS = [
	/(?:the\s+)?([A-Za-z][A-Za-z0-9]*)\s+CRD\b/i,
	/\bCRD\s+(?:for\s+)?([A-Za-z][A-Za-z0-9]*)\b/i,
	/\bwhat\s+is\s+(?:the\s+)?([A-Za-z][A-Za-z0-9]*)\s+(?:CRD|resource)\b/i
];

const REQUIRED_FIELDS_KIND_PATTERNS = [
	/required\s+fields?\s+for\s+(?:the\s+)?([A-Za-z][A-Za-z0-9]*)/i,
	/(?:what\s+are\s+)?(?:the\s+)?required\s+fields?\s+(?:for\s+)?(?:the\s+)?([A-Za-z][A-Za-z0-9]*)/i,
	/([A-Za-z][A-Za-z0-9]*)\s+required\s+fields?/i
];

const OPERATIONAL_AREA_PATTERNS: Array<{ area: string; pattern: RegExp }> = [
	{ area: 'BGP', pattern: /\bbgp\b|peer|neighbor|autonomous.?system/i },
	{ area: 'EVPN', pattern: /\bevpn\b|vxlan|esi|vni|ethernet.?segment/i },
	{ area: 'Interfaces', pattern: /\binterface\b|port|ethernet|lag|breakout|subinterface/i },
	{ area: 'Topology', pattern: /\btopology\b|\bfabric\b|\blink\b|\bnode\b|\bsite\b|leaf|spine/i },
	{ area: 'Policies', pattern: /\bpolicy\b|route.?policy|prefix|filter|acl|\bvrf\b|routing/i },
	{ area: 'Platform', pattern: /\bplatform\b|bootstrap|engine|cluster|init/i }
];

function normalizeToken(token: string): string {
	return token.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function questionMentionsState(question: string): boolean {
	return /\b(state|states|status|observed)\b/i.test(question);
}

function isStateEntry(entry: ManifestEntry): boolean {
	return crdShortName(entry.name).includes('states') || /state$/i.test(resolveEntryKind(entry));
}

function entryFromManifest(
	entry: ManifestEntry,
	release: string,
	score: number,
	source: ResolvedAskTargetSource
): ResolvedAskTarget {
	return {
		release,
		kind: resolveEntryKind(entry),
		group: entry.group ?? '',
		name: entry.name,
		score,
		source
	};
}

function dedupeTargets(targets: ResolvedAskTarget[]): ResolvedAskTarget[] {
	const seen = new Map<string, ResolvedAskTarget>();
	for (const target of targets) {
		const key = `${target.kind}::${target.group}`;
		const existing = seen.get(key);
		if (!existing || target.score > existing.score) {
			seen.set(key, target);
		}
	}
	return [...seen.values()].sort((a, b) => b.score - a.score);
}

function filterStateEntries(
	entries: ManifestEntry[],
	question: string
): ManifestEntry[] {
	if (questionMentionsState(question)) return entries;
	return entries.filter((e) => !isStateEntry(e));
}

function extractQuestionTokens(question: string): string[] {
	const cleaned = question
		.replace(/\b\d+\.\d+(?:\.\d+)?\b/g, ' ')
		.replace(/\bEDA\s+\d+\.\d+(?:\.\d+)?\b/gi, ' ');
	const tokens = cleaned
		.split(/[\s,;:?]+/)
		.map((t) => normalizeToken(t))
		.filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
	return [...new Set(tokens)];
}

/** Extract kind from "Required fields for Interface" style questions. */
export function extractKindFromRequiredFieldsQuestion(question: string): string | undefined {
	for (const pattern of REQUIRED_FIELDS_KIND_PATTERNS) {
		const match = question.match(pattern);
		const raw = match?.[1]?.trim();
		if (!raw) continue;
		const token = normalizeToken(raw);
		if (token.length < 2 || STOP_WORDS.has(token)) continue;
		return raw.charAt(0).toUpperCase() + raw.slice(1);
	}
	return undefined;
}

export function questionAsksRequiredFields(question: string): boolean {
	return (
		/\brequired\s+fields?\b/i.test(question) ||
		!!extractKindFromRequiredFieldsQuestion(question)
	);
}

/** True when the user wants a YAML manifest example (not a conceptual overview). */
export function questionAsksExampleYaml(question: string): boolean {
	if (/\bexample\s+(?:ya?ml|manifest)\b/i.test(question)) return true;
	if (/\b(?:ya?ml|manifest)\s+example\b/i.test(question)) return true;
	if (
		/\b(?:show|give|provide|need|want|sample)\b/i.test(question) &&
		/\b(?:ya?ml|manifest)\b/i.test(question)
	) {
		return true;
	}
	if (
		/\bexample\b/i.test(question) &&
		/\b(?:for|of)\b/i.test(question) &&
		/\b(?:ya?ml|manifest|crd|resource)\b/i.test(question)
	) {
		return true;
	}
	return false;
}

/** Pick the best target when a required-fields question names a kind. */
export function pickTargetForRequiredFields(
	question: string,
	targets: ResolvedAskTarget[]
): ResolvedAskTarget | undefined {
	if (!targets.length) return undefined;
	const namedKind = extractKindFromRequiredFieldsQuestion(question);
	if (namedKind) {
		const exact = targets.find(
			(t) => t.kind.toLowerCase() === namedKind.toLowerCase()
		);
		if (exact) return exact;
	}
	return targets.length === 1 ? targets[0] : undefined;
}

/** Extract a Kubernetes kind name from patterns like "the Policy CRD" or "what is Fabric resource". */
export function extractExplicitKindFromQuestion(question: string): string | undefined {
	for (const pattern of EXPLICIT_KIND_PATTERNS) {
		const match = question.match(pattern);
		const raw = match?.[1]?.trim();
		if (!raw) continue;
		const token = normalizeToken(raw);
		if (token.length < 2 || STOP_WORDS.has(token)) continue;
		return raw.charAt(0).toUpperCase() + raw.slice(1);
	}
	return undefined;
}

/** True when the question names one CRD kind (not a plural/topic catalog query). */
export function isSpecificCrdQuestion(question: string): boolean {
	if (!extractExplicitKindFromQuestion(question)) return false;
	if (/\b(?:all|exist|available|are there)\b/i.test(question)) return false;
	if (/\bwhich\b.+\b(?:crds?|resources?|kinds?)\b/i.test(question)) return false;
	return true;
}

function scoreKindToken(token: string, kind: string): number {
	const kindNorm = normalizeToken(kind);
	if (kindNorm === token) return 100;
	if (kindNorm.startsWith(token) || token.startsWith(kindNorm)) return 85;
	if (kindNorm.includes(token) || token.includes(kindNorm)) return 70;
	return 0;
}

function scoreApiGroupMatch(token: string, entry: ManifestEntry): number {
	const short = crdShortName(entry.name).toLowerCase();
	const group = (entry.group ?? '').toLowerCase();
	let score = 0;
	if (short.includes(token) || group.includes(token)) {
		score = 75;
	}
	if (token === 'fabric' && group.includes('fabric')) {
		score = Math.max(score, 90);
	}
	return score;
}

function resolvePinned(
	input: ResolveAskTargetsInput
): ResolvedAskTarget[] | null {
	const { pinned, release, manifest } = input;
	if (!pinned?.kind || !pinned.group) return null;
	const entry = manifest.find(
		(e) =>
			e.group === pinned.group &&
			resolveEntryKind(e).toLowerCase() === pinned.kind.toLowerCase()
	);
	if (entry) {
		return [entryFromManifest(entry, release, 200, 'pinned')];
	}
	return [
		{
			release,
			kind: pinned.kind,
			group: pinned.group,
			name: `${pinned.kind.toLowerCase()}s.${pinned.group}`,
			score: 200,
			source: 'pinned'
		}
	];
}

function resolveByRequiredFieldsKind(input: ResolveAskTargetsInput): ResolvedAskTarget[] {
	const requiredKind = extractKindFromRequiredFieldsQuestion(input.question);
	if (!requiredKind) return [];

	const entries = filterStateEntries(
		findManifestEntriesByKindInsensitive(input.manifest, requiredKind),
		input.question
	);
	return entries.map((entry) => entryFromManifest(entry, input.release, 160, 'kind'));
}

function resolveByExplicitKind(input: ResolveAskTargetsInput): ResolvedAskTarget[] {
	const explicitKind = extractExplicitKindFromQuestion(input.question);
	if (!explicitKind) return [];

	const entries = filterStateEntries(
		findManifestEntriesByKindInsensitive(input.manifest, explicitKind),
		input.question
	);
	return entries.map((entry) => entryFromManifest(entry, input.release, 150, 'kind'));
}

function resolveByKind(
	input: ResolveAskTargetsInput,
	tokens: string[]
): ResolvedAskTarget[] {
	const { manifest, release } = input;
	const results: ResolvedAskTarget[] = [];

	for (const token of tokens) {
		const capitalized = token.charAt(0).toUpperCase() + token.slice(1);
		const entries = filterStateEntries(
			findManifestEntriesByKindInsensitive(manifest, capitalized),
			input.question
		);
		for (const entry of entries) {
			const score = scoreKindToken(token, resolveEntryKind(entry));
			if (score > 0) {
				results.push(entryFromManifest(entry, release, score, 'kind'));
			}
		}
	}

	return results;
}

function resolveByApiGroup(
	input: ResolveAskTargetsInput,
	tokens: string[]
): ResolvedAskTarget[] {
	const { manifest, release } = input;
	const results: ResolvedAskTarget[] = [];

	for (const token of tokens) {
		for (const entry of filterStateEntries(manifest, input.question)) {
			const score = scoreApiGroupMatch(token, entry);
			if (score > 0) {
				results.push(entryFromManifest(entry, release, score, 'apiGroup'));
			}
		}
	}

	return results;
}

function resolveByOperationalArea(input: ResolveAskTargetsInput): ResolvedAskTarget[] {
	const { question, manifest, release } = input;
	const matchedAreas = OPERATIONAL_AREA_PATTERNS.filter((p) => p.pattern.test(question)).map(
		(p) => p.area
	);
	if (!matchedAreas.length) return [];

	const results: ResolvedAskTarget[] = [];
	for (const entry of filterStateEntries(manifest, question)) {
		const area = inferOperationalArea(resolveEntryKind(entry), entry.group);
		if (matchedAreas.includes(area)) {
			results.push(entryFromManifest(entry, release, 60, 'operationalArea'));
		}
	}
	return results;
}

function resolveFromRagCandidates(
	input: ResolveAskTargetsInput
): ResolvedAskTarget[] {
	const { ragCandidates, manifest, release } = input;
	if (!ragCandidates?.length) return [];

	const results: ResolvedAskTarget[] = [];
	for (const candidate of ragCandidates) {
		const entry = manifest.find(
			(e) =>
				e.group === candidate.group &&
				resolveEntryKind(e).toLowerCase() === candidate.kind.toLowerCase()
		);
		if (entry && !isStateEntry(entry)) {
			results.push(
				entryFromManifest(entry, release, 40 + (candidate.score ?? 0) * 10, 'rag')
			);
		}
	}
	return results;
}

function preferGroupMentionedInQuestion(
	targets: ResolvedAskTarget[],
	question: string
): ResolvedAskTarget[] {
	const q = question.toLowerCase();
	const withGroupHint = targets.filter((t) => q.includes(t.group.toLowerCase()));
	if (withGroupHint.length) return withGroupHint;
	return targets;
}

function filterByMentionedGroup(
	targets: ResolvedAskTarget[],
	question: string
): ResolvedAskTarget[] {
	const q = question.toLowerCase();
	const withGroup = targets.filter((t) => q.includes(t.group.toLowerCase()));
	return withGroup.length ? withGroup : targets;
}

function isBroadTopicQuestion(question: string): boolean {
	if (isSpecificCrdQuestion(question)) return false;
	return (
		/\b(?:crds?|resources?|kinds?)\b/i.test(question) ||
		/\bwhat\b.+\b(?:exist|available|are there)\b/i.test(question) ||
		/\ball\b/i.test(question)
	);
}

/** Resolve 0..N CRD targets from a free-form question and optional pinned UI context. */
export function resolveAskTargets(input: ResolveAskTargetsInput): ResolvedAskTarget[] {
	const pinned = resolvePinned(input);
	if (pinned) return pinned.slice(0, MAX_ASK_TARGETS);

	if (questionAsksRequiredFields(input.question)) {
		const required = filterByMentionedGroup(resolveByRequiredFieldsKind(input), input.question);
		if (required.length) return required.slice(0, MAX_ASK_TARGETS);
	}

	if (isSpecificCrdQuestion(input.question)) {
		const explicit = filterByMentionedGroup(resolveByExplicitKind(input), input.question);
		if (explicit.length) return explicit.slice(0, MAX_ASK_TARGETS);
	}

	const tokens = extractQuestionTokens(input.question);
	const kindMatches = dedupeTargets(resolveByKind(input, tokens));
	const exactKindMatches = kindMatches.filter((m) => m.score === 100);
	if (exactKindMatches.length && !isBroadTopicQuestion(input.question)) {
		return preferGroupMentionedInQuestion(exactKindMatches, input.question).slice(
			0,
			MAX_ASK_TARGETS
		);
	}

	const apiGroupMatches = dedupeTargets(resolveByApiGroup(input, tokens));
	let candidates: ResolvedAskTarget[] = [];

	if (isBroadTopicQuestion(input.question) && apiGroupMatches.length > kindMatches.length) {
		candidates = filterByMentionedGroup(apiGroupMatches, input.question);
	} else if (kindMatches.length) {
		candidates = preferGroupMentionedInQuestion(kindMatches, input.question);
	} else if (apiGroupMatches.length) {
		candidates = filterByMentionedGroup(apiGroupMatches, input.question);
	} else {
		candidates = dedupeTargets([
			...resolveByOperationalArea(input),
			...resolveFromRagCandidates(input)
		]);
	}

	return candidates.slice(0, MAX_ASK_TARGETS);
}

export function questionMentionsFieldPath(question: string): boolean {
	return /\b(?:spec|status)\.[a-zA-Z0-9_.[\]]+/i.test(question);
}

export function questionMentionsCrossRelease(question: string): boolean {
	const releases = question.match(/\b\d+\.\d+(?:\.\d+)?\b/g) ?? [];
	return releases.length >= 2 || /\bcompare\b/i.test(question);
}

export function isOverviewStyleQuestion(question: string): boolean {
	return (
		!questionMentionsFieldPath(question) &&
		!questionMentionsCrossRelease(question) &&
		!questionAsksExampleYaml(question)
	);
}
