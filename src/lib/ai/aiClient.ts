export type AiAction =
	| 'explain'
	| 'field'
	| 'validate'
	| 'fix'
	| 'example'
	| 'compare'
	| 'spec-search';

export type FixIssuePayload = {
	message: string;
	fieldPath?: string;
	line?: number;
	severity?: string;
	renameHint?: { from: string; to: string };
	relocationHint?: { from: string; to: string };
	migrationContext?: string;
	issueKind?: 'unknownField' | 'misspelledField' | 'enum' | 'type' | 'required' | 'syntax' | 'other';
	allowedSiblingKeys?: string[];
	allowedValues?: string[];
	expectedTypes?: string[];
	deterministicFixAvailable?: boolean;
	suggestedFix?: { action?: string; field: string; value: string };
	/** Client-computed YAML excerpt for compact prompts (server prefers when set). */
	excerptYaml?: string;
	excerptIsFullDocument?: boolean;
};

export type AskAIActionParams = {
	release: string;
	kind?: string;
	action: AiAction;
	group?: string;
	version?: string;
	field?: string;
	userYaml?: string;
	compareRelease?: string;
	issue?: FixIssuePayload;
	issues?: FixIssuePayload[];
};

export type AiActionResult = {
	answer: string;
	cached?: boolean;
	release?: string;
	kind?: string;
	field?: string;
	action?: string;
	examples?: string[];
	fixable?: boolean;
	fixedYaml?: string;
	/** Fix passed the server's validation before being returned. */
	verified?: boolean;
	explanation?: string;
	error?: string;
	/** Request was cancelled by the user. */
	aborted?: boolean;
	llmFallback?: boolean;
	fallbackReason?: 'quota' | 'llm_error';
};

/** Slightly longer than the server's worst case (one model call, plus one retry on timeout). */
export const AI_CLIENT_TIMEOUT_MS = 130_000;

function friendlyError(status: number, message?: string): string {
	if (status === 413) return 'The YAML is too large for an AI request (limit 512 KB).';
	if (status === 422) return message ?? 'Use the one-click Fix for this issue instead of AI.';
	if (status === 429) return 'Too many AI requests — wait a moment and try again.';
	if (status === 503) {
		return message ?? 'Workers AI is temporarily unavailable.';
	}
	if (status === 504) {
		return message ?? 'The AI request timed out. Try again.';
	}
	if (status === 0) {
		return 'Network error — check your connection and try again.';
	}
	if (status === 404) return message ?? 'Schema not found for that kind/release.';
	return message ?? `Request failed (${status}). Please try again.`;
}

export async function askAI(
	params: AskAIActionParams,
	options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<AiActionResult> {
	const timeout = AbortSignal.timeout(options?.timeoutMs ?? AI_CLIENT_TIMEOUT_MS);
	const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
	let response: Response;
	try {
		response = await fetch('/api/ai', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(params),
			signal
		});
	} catch {
		if (options?.signal?.aborted) return { answer: '', error: 'Cancelled.', aborted: true };
		if (timeout.aborted) return { answer: '', error: friendlyError(504) };
		return { answer: '', error: friendlyError(0) };
	}

	let data: AiActionResult & { error?: string };
	try {
		data = await response.json();
	} catch {
		return { answer: '', error: 'Invalid response from server' };
	}

	if (!response.ok) {
		return {
			answer: '',
			error: friendlyError(response.status, data.error),
			fallbackReason: data.fallbackReason
		};
	}

	return data;
}

export const explainCRD = (release: string, kind: string, group?: string) =>
	askAI({ release, kind, group, action: 'explain' });

export const explainField = (release: string, kind: string, field: string, group?: string) =>
	askAI({ release, kind, group, action: 'field', field });

export const validateYAML = (release: string, kind: string, userYaml: string, group?: string) =>
	askAI({ release, kind, group, action: 'validate', userYaml });

export const fixYAML = (
	release: string,
	userYaml: string,
	issue: FixIssuePayload,
	opts?: { kind?: string; group?: string; issues?: FixIssuePayload[]; signal?: AbortSignal }
) =>
	askAI(
		{
			release,
			kind: opts?.kind,
			group: opts?.group,
			action: 'fix',
			userYaml,
			issue,
			...(opts?.issues && opts.issues.length > 1 ? { issues: opts.issues } : {})
		},
		{ signal: opts?.signal }
	);

export const generateExample = (release: string, kind: string, group?: string) =>
	askAI({ release, kind, group, action: 'example' });

export const compareReleases = (releaseNew: string, kind: string, releaseOld: string, group?: string) =>
	askAI({ release: releaseNew, kind, group, action: 'compare', compareRelease: releaseOld });

export const searchSpec = (release: string, kind: string, query: string, group?: string) =>
	askAI({ release, kind, group, action: 'spec-search', field: query });
