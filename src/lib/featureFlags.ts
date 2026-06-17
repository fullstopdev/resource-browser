/** Ask AI UI — disabled by default; `/api/ask` removed. Set PUBLIC_ASK_AI_ENABLED=true to show legacy UI. */
export const askAiEnabled = import.meta.env.PUBLIC_ASK_AI_ENABLED === 'true';

/** YAML fix AI — enabled by default. Set PUBLIC_FIX_AI_ENABLED=false to disable. */
export const fixAiEnabled = import.meta.env.PUBLIC_FIX_AI_ENABLED !== 'false';
