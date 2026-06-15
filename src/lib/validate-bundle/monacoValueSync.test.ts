import { describe, expect, it } from 'vitest';
import {
	isExternalValueUpdate,
	mapOffsetAfterRemovingCarriageReturns,
	mapOffsetForNormalizedTextChange,
	normalizeYamlLineEndings,
	setEditorValuePreservingCursor
} from './monacoValueSync';

describe('isExternalValueUpdate', () => {
	it('returns false when bound value matches the last editor emission', () => {
		expect(isExternalValueUpdate('apiVersion: v1\n', 'apiVersion: v1\n')).toBe(false);
	});

	it('returns true when the parent pushes new YAML (fix, example, AI apply)', () => {
		expect(isExternalValueUpdate('kind: Fixed\n', 'kind: Broken\n')).toBe(true);
	});

	it('returns true on initial external load before the editor has emitted', () => {
		expect(isExternalValueUpdate('kind: New\n', '')).toBe(true);
	});
});

describe('normalizeYamlLineEndings', () => {
	it('strips carriage returns from CRLF and legacy CR lines', () => {
		expect(normalizeYamlLineEndings('a\r\nb\rc')).toBe('a\nb\nc');
	});
});

describe('mapOffsetAfterRemovingCarriageReturns', () => {
	it('maps cursor past hidden carriage returns on each line', () => {
		const text = 'kind: Node\r\nname: leaf\r';
		const offsetBeforeHiddenCr = 'kind: Node'.length + 1;
		expect(mapOffsetAfterRemovingCarriageReturns(text, offsetBeforeHiddenCr)).toBe('kind: Node'.length);
	});
});

describe('mapOffsetForNormalizedTextChange', () => {
	it('preserves offset when only line endings change', () => {
		const oldText = 'apiVersion: v1\r\nkind: Node\r';
		const newText = normalizeYamlLineEndings(oldText);
		const offsetBeforeHiddenCr = oldText.indexOf('\r', oldText.indexOf('kind: Node'));
		expect(mapOffsetForNormalizedTextChange(oldText, newText, offsetBeforeHiddenCr)).toBe(
			newText.indexOf('\n', newText.indexOf('kind: Node'))
		);
	});
});

describe('setEditorValuePreservingCursor', () => {
	it('keeps the cursor on the same visible character after CR removal', () => {
		const lines: string[] = ['kind: Node\r'];
		let cursorOffset = 0;

		const model = {
			getValue: () => lines.join(''),
			getOffsetAt: (pos: { lineNumber: number; column: number }) => {
				let offset = 0;
				for (let line = 1; line < pos.lineNumber; line++) {
					offset += lines[line - 1]!.length + 1;
				}
				return offset + pos.column - 1;
			},
			getPositionAt: (offset: number) => {
				let remaining = offset;
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i]!;
					if (remaining <= line.length) {
						return { lineNumber: i + 1, column: remaining + 1 };
					}
					remaining -= line.length + 1;
				}
				const last = lines.at(-1) ?? '';
				return { lineNumber: lines.length, column: last.length + 1 };
			},
			getFullModelRange: () => ({})
		};

		const editor = {
			getModel: () => model,
			getPosition: () => model.getPositionAt(cursorOffset),
			getSelection: () => null,
			setValue: (next: string) => {
				lines.splice(0, lines.length, ...next.split('\n'));
			},
			setPosition: (pos: { lineNumber: number; column: number }) => {
				cursorOffset = model.getOffsetAt(pos);
			},
			setSelection: () => {}
		};

		cursorOffset = model.getOffsetAt({ lineNumber: 1, column: 'kind: Node'.length + 1 });
		setEditorValuePreservingCursor(editor, 'kind: Node\n');

		expect(lines[0]).toBe('kind: Node');
		expect(cursorOffset).toBe('kind: Node'.length);
	});
});
