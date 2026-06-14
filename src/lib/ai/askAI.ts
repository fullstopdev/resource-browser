import type { RagSource } from '$lib/ai/rag/chunkTypes';

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
	sources?: RagSource[];
	error?: string;
	grounded?: boolean;
	release?: string;
}

function friendlyError(status: number, message?: string): string {
	if (status === 503) {
		return (
			message ??
			'AI service is temporarily unavailable. Start the app with `npm run dev:ai` or check that Workers AI is configured in production.'
		);
	}
	if (status === 504) {
		return (
			message ??
			'The request timed out. Check your network or proxy access to Cloudflare Workers AI and try a shorter question.'
		);
	}
	if (status === 0 || (typeof navigator !== 'undefined' && !navigator.onLine)) {
		return 'Network error — check your connection and try again.';
	}
	return message ?? `Request failed (${status}). Please try again.`;
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

	let response: Response;
	try {
		response = await fetch('/api/ask', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
	} catch {
		return { error: friendlyError(0) };
	}

	let data: {
		answer?: string;
		sources?: RagSource[];
		error?: string;
		grounded?: boolean;
		release?: string;
	};
	try {
		data = await response.json();
	} catch {
		return { error: 'Invalid response from server' };
	}

	if (!response.ok) {
		return { error: friendlyError(response.status, data.error) };
	}

	return {
		answer: data.answer ?? 'No answer returned.',
		sources: data.sources,
		grounded: data.grounded,
		release: data.release
	};
}
