import type { RagSource } from '$lib/ai/rag/chunkTypes';

export interface AskAIParams {
	question: string;
	release?: string;
	/** Pinned CRD page context only — Global Ask must omit kind/group. */
	kind?: string;
	group?: string;
	version?: string;
	fieldPath?: string;
	/** Legacy client-built context (fallback when release/kind/group omitted). */
	context?: string;
}

export type ResolvedTargetSummary = {
	kind: string;
	group: string;
	name: string;
	kvHit: boolean;
};

export interface AskAIResult {
	answer?: string;
	sources?: RagSource[];
	error?: string;
	grounded?: boolean;
	release?: string;
	kvCached?: boolean;
	targetsResolved?: ResolvedTargetSummary[];
	formattedBy?: 'llm';
	rag?: {
		chunkCount: number;
		topScore: number;
		release: string;
		sufficient: boolean;
		skipped?: boolean;
	};
}

function friendlyError(status: number, message?: string): string {
	if (status === 503 || status === 500 || status === 504) {
		return message ?? 'AI unavailable, try again later';
	}
	if (status === 404) {
		return (
			message ??
			'No indexed schema or docs for that release. Run embed:crd-corpus / embed:eda-docs for this release.'
		);
	}
	if (status === 422) {
		return (
			message ??
			'Not enough grounded context. Open a CRD page or include release + kind in your question.'
		);
	}
	if (status === 0 || (typeof navigator !== 'undefined' && !navigator.onLine)) {
		return 'Network error — check your connection and try again.';
	}
	return message ?? 'AI unavailable, try again later';
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
		kvCached?: boolean;
		fallbackReason?: 'quota' | 'llm_error';
		targetsResolved?: ResolvedTargetSummary[];
		formattedBy?: 'llm';
		rag?: AskAIResult['rag'];
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
		release: data.release,
		kvCached: data.kvCached,
		targetsResolved: data.targetsResolved,
		formattedBy: data.formattedBy,
		rag: data.rag
	};
}
