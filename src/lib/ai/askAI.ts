export interface AskAIParams {
	question: string;
	release?: string;
	kind?: string;
	group?: string;
	version?: string;
	fieldPath?: string;
	/** Legacy client-built context (fallback when release/kind/group omitted). */
	context?: string;
}

export interface AskAIResult {
	answer?: string;
	sources?: string[];
	error?: string;
}

/** Call the server-side Workers AI endpoint (no API keys in the browser). */
export async function askAI(params: AskAIParams): Promise<AskAIResult> {
	const { question, release, kind, group, version, fieldPath, context } = params;

	const body: Record<string, unknown> = { question };
	if (release) body.release = release;
	if (kind) body.kind = kind;
	if (group) body.group = group;
	if (version) body.version = version;
	if (fieldPath) body.fieldPath = fieldPath;
	if (context && !release) body.context = context;

	const response = await fetch('/api/ask', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});

	let data: { answer?: string; sources?: string[]; error?: string };
	try {
		data = await response.json();
	} catch {
		return { error: 'Invalid response from server' };
	}

	if (!response.ok) {
		return { error: data.error ?? `Request failed (${response.status})` };
	}

	return {
		answer: data.answer ?? 'No answer returned.',
		sources: data.sources
	};
}
