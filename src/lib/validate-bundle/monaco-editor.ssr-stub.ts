/** SSR/worker stub — real monaco-editor is client-only (fonts, workers). */
export const editor = {
	create: () => ({
		dispose: () => {},
		getValue: () => '',
		setValue: () => {},
		onDidChangeModelContent: () => ({ dispose: () => {} }),
		addCommand: () => {},
		getModel: () => null,
		getPosition: () => null,
		setPosition: () => {},
		setSelection: () => {},
		revealLineInCenter: () => {},
		focus: () => {},
		deltaDecorations: () => []
	})
};

export const languages = {
	register: () => {}
};

export const KeyMod = { CtrlCmd: 0 };
export const KeyCode = { Enter: 0 };
export class Range {
	constructor(
		public startLineNumber: number,
		public startColumn: number,
		public endLineNumber: number,
		public endColumn: number
	) {}
}
