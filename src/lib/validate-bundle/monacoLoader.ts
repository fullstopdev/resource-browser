/** Full Monaco editor bundle (lazy-loaded on validate-yaml only). */
export type MonacoApi = typeof import('monaco-editor');

export async function loadMonacoEditor(): Promise<MonacoApi> {
	return import('monaco-editor');
}
