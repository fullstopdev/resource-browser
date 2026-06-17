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
	explanation?: string;
	error?: string;
	llmFallback?: boolean;
	fallbackReason?: 'quota' | 'llm_error';
};

function friendlyError(status: number, message?: string): string {
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

export async function askAI(params: AskAIActionParams): Promise<AiActionResult> {
	let response: Response;
	try {
		response = await fetch('/api/ai', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(params)
		});
	} catch {
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
	opts?: { kind?: string; group?: string; issues?: FixIssuePayload[] }
) =>
	askAI({
		release,
		kind: opts?.kind,
		group: opts?.group,
		action: 'fix',
		userYaml,
		issue,
		...(opts?.issues && opts.issues.length > 1 ? { issues: opts.issues } : {})
	});

export const generateExample = (release: string, kind: string, group?: string) =>
	askAI({ release, kind, group, action: 'example' });

export const compareReleases = (releaseNew: string, kind: string, releaseOld: string, group?: string) =>
	askAI({ release: releaseNew, kind, group, action: 'compare', compareRelease: releaseOld });

export const searchSpec = (release: string, kind: string, query: string, group?: string) =>
	askAI({ release, kind, group, action: 'spec-search', field: query });
