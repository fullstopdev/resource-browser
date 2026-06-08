const MAX_CONTEXT_CHARS = 8000;

export interface CrdContextInput {
	kind: string;
	group: string;
	name: string;
	version: string;
	release: string;
	deprecated: boolean;
	spec: unknown;
	status: unknown;
}

/** Build a compact JSON context string for the AI prompt (trimmed server-side too). */
export function buildCrdContext(input: CrdContextInput): string {
	const payload = {
		apiVersion: `${input.group}/${input.version}`,
		kind: input.kind,
		metadata: {
			name: input.name,
			release: input.release,
			deprecated: input.deprecated
		},
		specSchema: input.spec ?? null,
		statusSchema: input.status ?? null
	};

	let text = JSON.stringify(payload, null, 2);
	if (text.length > MAX_CONTEXT_CHARS) {
		text = text.slice(0, MAX_CONTEXT_CHARS) + '\n…[truncated]';
	}
	return text;
}
