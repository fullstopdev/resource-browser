<script lang="ts">
import { browser } from '$app/environment';
import { createEventDispatcher, onDestroy, onMount } from 'svelte';
import { clampYamlInput } from '$lib/yaml/inputLimits';
import {
	buildYamlCompletions,
	yamlPropertyInsertText,
	yamlValueInsertText,
	type YamlCompletionContext
} from './yamlCompletions';
import { resolveYamlFieldContext, yamlPathBreadcrumb } from './yamlFieldContext';
import { buildYamlHoverMarkdown } from './yamlHover';
import { bundleIssuesToMarkers } from './yamlMarkers';
import { yamlMonarchLanguage } from './yamlMonarch';
import { resolveYamlCursor } from './yamlCursor';
import { loadMonacoEditor, type MonacoApi } from './monacoLoader';
import {
	isExternalValueUpdate,
	normalizeYamlLineEndings,
	setEditorValuePreservingCursor
} from './monacoValueSync';
import type { BundleIssue } from './types';

type MonacoEditor = ReturnType<MonacoApi['editor']['create']>;
type MonacoDisposable = { dispose(): void };
type MonacoPosition = { lineNumber: number; column: number };
type MonacoTextModel = NonNullable<ReturnType<MonacoEditor['getModel']>>;
type MonacoRange = InstanceType<MonacoApi['Range']>;

export let value = '';
export let highlightLine: number | null = null;
export let validating = false;
export let completionContext: YamlCompletionContext | null = null;
export let validationIssues: BundleIssue[] = [];
export let hideToolbarLabel = false;
export let onValidate: (() => void) | undefined = undefined;
export let onTruncate: (() => void) | undefined = undefined;

let containerEl: HTMLDivElement | undefined;
let editor: MonacoEditor | null = null;
let monacoApi: MonacoApi | null = null;
let decorationIds: string[] = [];
let ignoreModelChange = false;
let completionDisposable: MonacoDisposable | null = null;
let hoverDisposable: MonacoDisposable | null = null;
let cursorDisposable: MonacoDisposable | null = null;
/** Updated reactively so the Monaco provider closure always sees the latest context. */
let completionContextRef: YamlCompletionContext | null = null;
let validationIssuesRef: BundleIssue[] = [];
let loadedSchemaCount = 0;
let pathBreadcrumb = '';
let resizeObserver: ResizeObserver | null = null;
let visibilityObserver: IntersectionObserver | null = null;
let editorInitPromise: Promise<void> | null = null;
/** Last value pushed to the parent from onDidChangeModelContent — avoids setValue echo loops. */
let lastEmittedValue = value;

$: if (browser && containerEl && !editor) {
	void ensureEditor();
}

$: completionContextRef = completionContext;
$: validationIssuesRef = validationIssues;
$: if (!completionContext) {
	loadedSchemaCount = 0;
} else if (editor) {
	const size = completionContext.schemas?.size ?? 0;
	if (size > loadedSchemaCount && editor.hasTextFocus()) {
		queueMicrotask(() => {
			editor?.trigger('yaml', 'editor.action.triggerSuggest', {});
		});
	}
	loadedSchemaCount = size;
}

const dispatch = createEventDispatcher<{ validate: undefined; truncate: undefined }>();

function monacoTheme(): 'vs' | 'vs-dark' {
	return document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs';
}

function syncMonacoTheme() {
	if (!monacoApi || !editor) return;
	monacoApi.editor.setTheme(monacoTheme());
}

function scheduleEditorLayout() {
	requestAnimationFrame(() => {
		requestAnimationFrame(() => editor?.layout());
	});
}

let themeObserver: MutationObserver | null = null;

/** Resolved stack — Monaco cannot measure CSS variables for hit-testing. */
const MONACO_FONT_FAMILY =
	"'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

function setupMonacoWorkers() {
	if (typeof window === 'undefined') return;
	const globalSelf = window as Window & {
		MonacoEnvironment?: {
			getWorker: (workerId: string, label: string) => Worker;
		};
	};
	if (globalSelf.MonacoEnvironment) return;

	globalSelf.MonacoEnvironment = {
		getWorker(_workerId: string, label: string) {
			if (label === 'yaml' || label === 'json') {
				return new Worker(
					new URL('monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url),
					{ type: 'module' }
				);
			}
			return new Worker(
				new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
				{ type: 'module' }
			);
		}
	} as NonNullable<typeof globalSelf.MonacoEnvironment>;
}

function completionRange(
	model: MonacoTextModel,
	position: MonacoPosition,
	cursor: ReturnType<typeof resolveYamlCursor>
): MonacoRange {
	const line = position.lineNumber;
	const col = position.column;
	const lineContent = model.getLineContent(line);

	if (
		cursor &&
		(cursor.completionKind === 'key' ||
			cursor.completionKind === 'array-item' ||
			cursor.completionKind === 'value')
	) {
		const indent = (lineContent.match(/^(\s*)/)?.[1] ?? '').length;
		const dashLen = lineContent.slice(indent).startsWith('- ') ? 2 : 0;
		const prefixLen = cursor.valuePrefix.length;

		if (cursor.completionKind === 'value') {
			const colonIdx = lineContent.indexOf(':', indent);
			let valueStart = colonIdx >= 0 ? colonIdx + 2 : col;
			while (valueStart <= lineContent.length && lineContent[valueStart - 1] === ' ') {
				valueStart += 1;
			}
			const startCol =
				prefixLen > 0 ? Math.max(valueStart, col - prefixLen) : Math.min(valueStart, col);
			return new monacoApi!.Range(line, startCol, line, col);
		}

		const keyStart = indent + dashLen + 1;
		const word = model.getWordUntilPosition(position);
		let startCol: number;
		if (prefixLen > 0) {
			startCol = Math.max(keyStart, col - prefixLen);
		} else if (word.word && word.startColumn >= keyStart) {
			startCol = word.startColumn;
		} else {
			startCol = keyStart;
		}
		return new monacoApi!.Range(line, Math.min(startCol, col), line, col);
	}

	const word = model.getWordUntilPosition(position);
	const startCol = word.word ? word.startColumn : col;
	return new monacoApi!.Range(line, startCol, line, col);
}

function updatePathBreadcrumb() {
	if (!editor) return;
	const model = editor.getModel();
	const position = editor.getPosition();
	if (!model || !position) {
		pathBreadcrumb = '';
		return;
	}
	const cursor = resolveYamlCursor(model.getValue(), position.lineNumber, position.column);
	pathBreadcrumb = cursor ? yamlPathBreadcrumb(cursor) : '';
}

function updateValidationMarkers() {
	if (!editor || !monacoApi) return;
	const model = editor.getModel();
	if (!model) return;

	const markers = bundleIssuesToMarkers(model.getValue(), validationIssuesRef).map((m) => ({
		...m,
		severity:
			m.severity === 'error'
				? monacoApi!.MarkerSeverity.Error
				: m.severity === 'warning'
					? monacoApi!.MarkerSeverity.Warning
					: monacoApi!.MarkerSeverity.Info
	}));

	monacoApi.editor.setModelMarkers(model, 'validate-yaml', markers);
}

function registerYamlCompletions() {
	if (!monacoApi) return;
	completionDisposable?.dispose();

	const kindFor = (kind: string) => {
		switch (kind) {
			case 'property':
				return monacoApi!.languages.CompletionItemKind.Property;
			case 'enum':
				return monacoApi!.languages.CompletionItemKind.Enum;
			case 'reference':
				return monacoApi!.languages.CompletionItemKind.Reference;
			default:
				return monacoApi!.languages.CompletionItemKind.Value;
		}
	};

	completionDisposable = monacoApi.languages.registerCompletionItemProvider('yaml', {
		triggerCharacters: [':', '-', '.'],
		provideCompletionItems: (model, position) => {
			const yaml = model.getValue();
			const line = position.lineNumber;
			const col = position.column;
			const cursor = resolveYamlCursor(yaml, line, col);
			const fieldCtx = resolveYamlFieldContext(yaml, line, col, completionContextRef);
			const items = buildYamlCompletions(yaml, line, col, completionContextRef);
			const range = completionRange(model, position, cursor);
			const lineContent = model.getLineContent(line);

			return {
				suggestions: items.map((item) => {
					const isProperty = item.kind === 'property';
					const insertText = isProperty
						? yamlPropertyInsertText(
								lineContent,
								range.startColumn,
								range.endColumn,
								item.label
							)
						: yamlValueInsertText(item.insertText, fieldCtx?.meta);

					return {
						label: item.label,
						kind: kindFor(item.kind),
						insertText,
						detail: item.detail,
						documentation: item.documentation
							? { value: item.documentation, isTrusted: true }
							: undefined,
						sortText: item.sortText,
						filterText: item.label,
						preselect: item.preselect,
						commitCharacters: isProperty ? [':', ' '] : [' ', '-'],
						range
					};
				})
			};
		}
	});
}

function registerYamlHover() {
	if (!monacoApi) return;
	hoverDisposable?.dispose();

	hoverDisposable = monacoApi.languages.registerHoverProvider('yaml', {
		provideHover: (model, position) => {
			const yaml = model.getValue();
			const line = position.lineNumber;
			const col = position.column;
			const fieldCtx = resolveYamlFieldContext(yaml, line, col, completionContextRef);
			if (!fieldCtx) return null;

			const lineContent = model.getLineContent(line);
			const markdown = buildYamlHoverMarkdown(fieldCtx, lineContent, col);
			if (!markdown) return null;

			return {
				range: new monacoApi!.Range(line, 1, line, lineContent.length + 1),
				contents: [{ value: markdown, isTrusted: true }]
			};
		}
	});
}

async function ensureEditor() {
	if (!browser || !containerEl) return;
	if (editor) return;
	const mountEl = containerEl;
	if (editorInitPromise) {
		await editorInitPromise;
		return;
	}

	editorInitPromise = (async () => {
	setupMonacoWorkers();
	monacoApi = await loadMonacoEditor();

	if (!monacoApi.languages.getLanguages().some((lang) => lang.id === 'yaml')) {
		monacoApi.languages.register({ id: 'yaml' });
	}
	monacoApi.languages.setMonarchTokensProvider('yaml', yamlMonarchLanguage);

	editor = monacoApi.editor.create(mountEl, {
		value: normalizeYamlLineEndings(value),
		language: 'yaml',
		theme: monacoTheme(),
		automaticLayout: true,
		fixedOverflowWidgets: true,
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		fontFamily: MONACO_FONT_FAMILY,
		fontLigatures: false,
		fontSize: 13,
		lineHeight: 20,
		tabSize: 2,
		wordWrap: 'off',
		renderWhitespace: 'selection',
		padding: { top: 10, bottom: 10 },
		lineNumbers: 'on',
		glyphMargin: true,
		folding: true,
		foldingStrategy: 'indentation',
		guides: { indentation: true, bracketPairs: true },
		bracketPairColorization: { enabled: true },
		renderLineHighlight: 'line',
		matchBrackets: 'always',
		autoIndent: 'full',
		formatOnPaste: false,
		renderValidationDecorations: 'on',
		overviewRulerLanes: 3,
		quickSuggestions: {
			other: 'on',
			comments: 'off',
			strings: 'on'
		},
		suggestOnTriggerCharacters: true,
		tabCompletion: 'on',
		wordBasedSuggestions: 'off',
		suggest: {
			showWords: false,
			showSnippets: false,
			showIcons: true,
			showStatusBar: true,
			preview: true
		}
	});

	const initialText = normalizeYamlLineEndings(value);
	lastEmittedValue = initialText;
	if (value !== initialText) value = initialText;

	registerYamlCompletions();
	registerYamlHover();

	cursorDisposable = editor.onDidChangeCursorPosition(() => {
		updatePathBreadcrumb();
	});

	editor.onDidChangeModelContent(() => {
		if (!editor || ignoreModelChange) return;
		const raw = editor.getValue();
		const normalized = normalizeYamlLineEndings(raw);
		const { text, truncated } = clampYamlInput(normalized);
		if (raw !== text) {
			ignoreModelChange = true;
			setEditorValuePreservingCursor(editor, text);
			ignoreModelChange = false;
			if (truncated) {
				onTruncate?.();
				dispatch('truncate');
			}
		}
		if (value !== text) value = text;
		lastEmittedValue = text;
		updateValidationMarkers();
	});

	editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.Enter, () => {
		onValidate?.();
		dispatch('validate');
	});

	updatePathBreadcrumb();
	updateValidationMarkers();

	if (typeof ResizeObserver !== 'undefined' && containerEl) {
		resizeObserver = new ResizeObserver(scheduleEditorLayout);
		resizeObserver.observe(containerEl);
		if (containerEl.parentElement) {
			resizeObserver.observe(containerEl.parentElement);
		}
		scheduleEditorLayout();
	}

	if (typeof IntersectionObserver !== 'undefined' && containerEl) {
		visibilityObserver = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					scheduleEditorLayout();
				}
			},
			{ threshold: 0 }
		);
		visibilityObserver.observe(containerEl);
	}
	})().finally(() => {
		editorInitPromise = null;
	});

	await editorInitPromise;
}

function updateHighlightLine() {
	if (!editor || !monacoApi) return;
	const model = editor.getModel();
	if (!model) return;

	if (highlightLine && highlightLine > 0) {
		decorationIds = editor.deltaDecorations(decorationIds, [
			{
				range: new monacoApi.Range(highlightLine, 1, highlightLine, 1),
				options: {
					isWholeLine: true,
					className: 'monaco-yaml-line-highlight',
					linesDecorationsClassName: 'monaco-yaml-gutter-highlight'
				}
			}
		]);
	} else {
		decorationIds = editor.deltaDecorations(decorationIds, []);
	}
}

export async function focusLine(line: number) {
	await ensureEditor();
	if (!editor || line < 1) return;
	editor.focus();
	editor.revealLineInCenter(line);
	editor.setPosition({ lineNumber: line, column: 1 });
	const model = editor.getModel();
	const lineLength = model?.getLineLength(line) ?? 1;
	editor.setSelection({
		startLineNumber: line,
		startColumn: 1,
		endLineNumber: line,
		endColumn: lineLength + 1
	});
}

export function layout() {
	scheduleEditorLayout();
}

onMount(async () => {
	await ensureEditor();
	updateHighlightLine();
	if (typeof MutationObserver !== 'undefined') {
		themeObserver = new MutationObserver(() => syncMonacoTheme());
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class']
		});
	}
});

onDestroy(() => {
	resizeObserver?.disconnect();
	resizeObserver = null;
	visibilityObserver?.disconnect();
	visibilityObserver = null;
	themeObserver?.disconnect();
	themeObserver = null;
	completionDisposable?.dispose();
	completionDisposable = null;
	hoverDisposable?.dispose();
	hoverDisposable = null;
	cursorDisposable?.dispose();
	cursorDisposable = null;
	editor?.dispose();
	editor = null;
});

$: if (editor && !ignoreModelChange && isExternalValueUpdate(value, lastEmittedValue)) {
	ignoreModelChange = true;
	setEditorValuePreservingCursor(editor, value);
	lastEmittedValue = value;
	ignoreModelChange = false;
	updateValidationMarkers();
}

$: highlightLine, updateHighlightLine();
$: validationIssues, updateValidationMarkers();

$: validating;
</script>

<div class="monaco-yaml-editor">
	<div class="yaml-editor-toolbar" class:yaml-editor-toolbar--compact={hideToolbarLabel}>
		{#if !hideToolbarLabel}
			<span class="yaml-editor-label">Editor</span>
		{/if}
		<div class="yaml-editor-toolbar-meta">
			{#if validating}
				<span class="yaml-editor-validating" aria-live="polite">Validating…</span>
			{/if}
			{#if pathBreadcrumb}
				<span class="yaml-editor-breadcrumb" title={pathBreadcrumb}>{pathBreadcrumb}</span>
			{:else}
				<span class="yaml-editor-hint">Ctrl+Enter · schema IntelliSense</span>
			{/if}
		</div>
	</div>
	<div class="monaco-yaml-editor__surface" bind:this={containerEl}></div>
</div>

<style>
	.monaco-yaml-editor {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-height: 0;
		flex: 1 1 auto;
		border-radius: 0.375rem;
		border: 1px solid #e2e8f0;
		background: #fff;
		overflow: hidden;
	}

	:global(.dark) .monaco-yaml-editor {
		border-color: rgba(56, 100, 150, 0.35);
		background: rgba(15, 42, 72, 0.88);
	}

	.monaco-yaml-editor__surface {
		flex: 1 1 auto;
		min-height: 400px;
		width: 100%;
	}

	:global(.monaco-yaml-line-highlight) {
		background: rgba(251, 191, 36, 0.18);
	}

	:global(.monaco-yaml-gutter-highlight) {
		background: rgba(245, 158, 11, 0.35);
		width: 4px !important;
		margin-left: 4px;
	}
</style>
