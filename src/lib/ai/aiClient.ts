export type AiAction =
	| 'explain'
	| 'field'
	| 'validate'
	| 'example'
	| 'compare'
	| 'spec-search';

export type AskAIActionParams = {
	release: string;
	kind: string;
	action: AiAction;
	group?: string;
	version?: string;
	field?: string;
	userYaml?: string;
	compareRelease?: string;
};

export type AiActionResult = {
	answer: string;
	cached?: boolean;
	release?: string;
	kind?: string;
	field?: string;
	action?: string;
	examples?: string[];
	error?: string;
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
		return { answer: '', error: friendlyError(response.status, data.error) };
	}

	return data;
}

export const explainCRD = (release: string, kind: string, group?: string) =>
	askAI({ release, kind, group, action: 'explain' });

export const explainField = (release: string, kind: string, field: string, group?: string) =>
	askAI({ release, kind, group, action: 'field', field });

export const validateYAML = (release: string, kind: string, userYaml: string, group?: string) =>
	askAI({ release, kind, group, action: 'validate', userYaml });

export const generateExample = (release: string, kind: string, group?: string) =>
	askAI({ release, kind, group, action: 'example' });

export const compareReleases = (releaseNew: string, kind: string, releaseOld: string, group?: string) =>
	askAI({ release: releaseNew, kind, group, action: 'compare', compareRelease: releaseOld });

export const searchSpec = (release: string, kind: string, query: string, group?: string) =>
	askAI({ release, kind, group, action: 'spec-search', field: query });
