<script lang="ts">
	import { browser } from '$app/environment';
	import { onDestroy, onMount } from 'svelte';
	import { loadMonacoEditor, type MonacoApi } from './monacoLoader';

	interface Props {
		original: string;
		modified: string;
		label?: string;
		/** When true, expand to fill the parent flex container (e.g. Fix All review panel). */
		fill?: boolean;
	}

	let { original, modified, label = 'YAML diff', fill = false }: Props = $props();

	let containerEl: HTMLDivElement | undefined;
	let diffEditor: ReturnType<MonacoApi['editor']['createDiffEditor']> | null = null;
	let monaco: MonacoApi | null = null;

	onMount(async () => {
		if (!browser || !containerEl) return;
		monaco = await loadMonacoEditor();
		if (!monaco.languages.getLanguages().some((lang) => lang.id === 'yaml')) {
			monaco.languages.register({ id: 'yaml' });
		}
		const originalModel = monaco.editor.createModel(original, 'yaml');
		const modifiedModel = monaco.editor.createModel(modified, 'yaml');

		diffEditor = monaco.editor.createDiffEditor(containerEl, {
			readOnly: true,
			renderSideBySide: true,
			minimap: { enabled: false },
			scrollBeyondLastLine: false,
			fontSize: 13,
			lineNumbers: 'on',
			automaticLayout: true,
			originalEditable: false,
			ignoreTrimWhitespace: true,
			// Keep every document visible; collapsing unchanged regions hides most of multi-doc bundles.
			hideUnchangedRegions: { enabled: false }
		});

		diffEditor.setModel({ original: originalModel, modified: modifiedModel });
		diffEditor.layout();
	});

	$effect(() => {
		if (!diffEditor || !monaco) return;
		const model = diffEditor.getModel();
		if (!model) return;
		let updated = false;
		if (model.original.getValue() !== original) {
			model.original.setValue(original);
			updated = true;
		}
		if (model.modified.getValue() !== modified) {
			model.modified.setValue(modified);
			updated = true;
		}
		if (updated) diffEditor.layout();
	});

	onDestroy(() => {
		const model = diffEditor?.getModel();
		model?.original.dispose();
		model?.modified.dispose();
		diffEditor?.dispose();
		diffEditor = null;
	});
</script>

<div
	class="monaco-yaml-diff"
	class:monaco-yaml-diff--fill={fill}
	role="region"
	aria-label={label}
	bind:this={containerEl}
></div>

<style>
	.monaco-yaml-diff {
		width: 100%;
		min-height: 320px;
		height: min(50vh, 480px);
		border: 1px solid #e2e8f0;
		border-radius: 0.5rem;
		overflow: hidden;
	}

	.monaco-yaml-diff--fill {
		flex: 1 1 auto;
		min-height: 0;
		height: 100%;
	}

	:global(.dark) .monaco-yaml-diff {
		border-color: rgba(56, 100, 150, 0.35);
	}
</style>
