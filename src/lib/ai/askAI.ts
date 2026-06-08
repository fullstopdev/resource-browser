export interface AskAIResult {
	answer?: string;
	error?: string;
}

/** Call the server-side Workers AI endpoint (no API keys in the browser). */
export async function askAI(question: string, crdContext: string): Promise<AskAIResult> {
	const response = await fetch('/api/ask', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ question, context: crdContext })
	});

	let data: { answer?: string; error?: string };
	try {
		data = await response.json();
	} catch {
		return { error: 'Invalid response from server' };
	}

	if (!response.ok) {
		return { error: data.error ?? `Request failed (${response.status})` };
	}

	return { answer: data.answer ?? 'No answer returned.' };
}
