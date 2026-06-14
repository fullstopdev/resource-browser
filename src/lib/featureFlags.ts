/** Ask AI UI (header button, slide-over, Ctrl+K). On in dev; production requires PUBLIC_ASK_AI_ENABLED=true. */
export const askAiEnabled =
	import.meta.env.DEV || import.meta.env.PUBLIC_ASK_AI_ENABLED === 'true';
