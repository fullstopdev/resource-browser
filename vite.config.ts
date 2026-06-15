import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const monacoEditorStub = path.resolve(rootDir, 'src/lib/validate-bundle/monaco-editor.ssr-stub.ts');
const monacoYamlEditorStub = path.resolve(
	rootDir,
	'src/lib/validate-bundle/MonacoYamlEditor.ssr.stub.svelte'
);

// Plugin to suppress 404 logs for CRD version availability checks
const suppressCrdCheckLogs = (): Plugin => ({
	name: 'suppress-crd-check-logs',
	configureServer(server) {
		// @ts-ignore - Intercept console output to suppress CRD check 404s
		const proc = globalThis.process;
		if (!proc) return;

		const originalStdoutWrite = proc.stdout.write.bind(proc.stdout);
		const originalStderrWrite = proc.stderr.write.bind(proc.stderr);

		// @ts-ignore - Override stdout
		proc.stdout.write = (chunk: any, ...args: any[]) => {
			const str = chunk?.toString() || '';
			if (
				str.includes('Not found:') &&
				str.includes('/resources/') &&
				(str.includes('.yaml') || str.includes('dependency-graph.json'))
			) {
				return true; // Suppress this output
			}
			return originalStdoutWrite(chunk, ...args);
		};

		// @ts-ignore - Override stderr
		proc.stderr.write = (chunk: any, ...args: any[]) => {
			const str = chunk?.toString() || '';
			if (
				str.includes('Not found:') &&
				str.includes('/resources/') &&
				(str.includes('.yaml') || str.includes('dependency-graph.json'))
			) {
				return true; // Suppress this output
			}
			return originalStderrWrite(chunk, ...args);
		};
	}
});

const monacoSsrStub = (): Plugin => ({
	name: 'monaco-ssr-stub',
	enforce: 'pre',
	resolveId(source, _importer, options) {
		if (!options?.ssr) return null;
		if (source === 'monaco-editor' || source.startsWith('monaco-editor/')) {
			return monacoEditorStub;
		}
		const normalized = source.replace(/\\/g, '/');
		if (normalized.endsWith('/MonacoYamlEditor.svelte') || normalized.includes('MonacoYamlEditor.svelte')) {
			return monacoYamlEditorStub;
		}
		return null;
	}
});

export default defineConfig(({ isSsrBuild }) => ({
	plugins: [monacoSsrStub(), suppressCrdCheckLogs(), tailwindcss(), sveltekit(), devtoolsJson()],
	resolve: isSsrBuild
		? {
				alias: {
					'monaco-editor': monacoEditorStub,
					'$lib/validate-bundle/MonacoYamlEditor.svelte': monacoYamlEditorStub,
					[path.resolve(rootDir, 'src/lib/validate-bundle/MonacoYamlEditor.svelte')]:
						monacoYamlEditorStub
				}
			}
		: undefined,
	build: {
		rollupOptions: {
			// Work around Rollup 4 literal deoptimization crash (ConditionalExpression + frozen arrays)
			treeshake: false
		}
	},
	test: {
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					environment: 'browser',
					browser: {
						enabled: true,
						provider: 'playwright',
						instances: [{ browser: 'chromium' }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**'],
					setupFiles: ['./vitest-setup-client.ts']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
}));
