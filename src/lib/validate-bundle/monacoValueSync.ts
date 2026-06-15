/** True when bind:value changed from the parent, not echoed from the editor. */
export function isExternalValueUpdate(boundValue: string, lastEmittedValue: string): boolean {
	return boundValue !== lastEmittedValue;
}

/** Normalize Windows / legacy line endings to LF. */
export function normalizeYamlLineEndings(text: string): string {
	return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Map a model offset after stripping carriage returns that precede it. */
export function mapOffsetAfterRemovingCarriageReturns(source: string, offset: number): number {
	let mapped = 0;
	const limit = Math.max(0, Math.min(offset, source.length));
	for (let i = 0; i < limit; i++) {
		if (source[i] !== '\r') mapped++;
	}
	return mapped;
}

/** Map a cursor offset when text only differs by line-ending normalization. */
export function mapOffsetForNormalizedTextChange(
	oldText: string,
	newText: string,
	offset: number
): number {
	if (normalizeYamlLineEndings(oldText) === newText) {
		return mapOffsetAfterRemovingCarriageReturns(oldText, offset);
	}
	return Math.min(offset, newText.length);
}

type MonacoPosition = { lineNumber: number; column: number };
type MonacoSelection = {
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
};
type MonacoTextModel = {
	getValue(): string;
	getOffsetAt(position: MonacoPosition): number;
	getPositionAt(offset: number): MonacoPosition;
	getFullModelRange(): unknown;
};
type MonacoEditorLike = {
	getModel(): MonacoTextModel | null;
	getPosition(): MonacoPosition | null;
	getSelection(): MonacoSelection | null;
	setValue(value: string): void;
	setPosition(position: MonacoPosition): void;
	setSelection(selection: MonacoSelection): void;
};

/** Replace editor text while preserving cursor/selection when possible. */
export function setEditorValuePreservingCursor(
	editor: MonacoEditorLike,
	nextText: string
): void {
	const model = editor.getModel();
	if (!model) return;

	const currentText = model.getValue();
	if (currentText === nextText) return;

	const position = editor.getPosition();
	const selection = editor.getSelection();
	const cursorOffset = position ? model.getOffsetAt(position) : 0;
	const selectionStart = selection
		? model.getOffsetAt({
				lineNumber: selection.startLineNumber,
				column: selection.startColumn
			})
		: cursorOffset;
	const selectionEnd = selection
		? model.getOffsetAt({
				lineNumber: selection.endLineNumber,
				column: selection.endColumn
			})
		: cursorOffset;

	editor.setValue(nextText);

	const updatedModel = editor.getModel();
	if (!updatedModel) return;

	const nextCursorOffset = mapOffsetForNormalizedTextChange(currentText, nextText, cursorOffset);
	const nextCursor = updatedModel.getPositionAt(
		Math.min(nextCursorOffset, nextText.length)
	);
	editor.setPosition(nextCursor);

	if (
		selection &&
		(selection.startLineNumber !== selection.endLineNumber ||
			selection.startColumn !== selection.endColumn)
	) {
		const nextStart = updatedModel.getPositionAt(
			Math.min(
				mapOffsetForNormalizedTextChange(currentText, nextText, selectionStart),
				nextText.length
			)
		);
		const nextEnd = updatedModel.getPositionAt(
			Math.min(
				mapOffsetForNormalizedTextChange(currentText, nextText, selectionEnd),
				nextText.length
			)
		);
		editor.setSelection({
			...selection,
			startLineNumber: nextStart.lineNumber,
			startColumn: nextStart.column,
			endLineNumber: nextEnd.lineNumber,
			endColumn: nextEnd.column
		});
	}
}
