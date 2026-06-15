export type YamlCompletionKind = 'key' | 'value' | 'array-item';

export type YamlCursor = {
	docIndex: number;
	yamlPath: string[];
	completionKind: YamlCompletionKind;
	valuePrefix: string;
	/** Cursor is nested inside an array item object (deeper indent than `- item`). */
	inArrayItem: boolean;
};

type StackFrame = {
	indent: number;
	key: string;
};

type ArrayContext = {
	/** Indent of the `- item` line. */
	itemIndent: number;
	/** Path to the array field (e.g. spec → underlayProtocol → protocols). */
	fieldPath: string[];
};

function countIndent(line: string): number {
	const match = line.match(/^(\s*)/);
	return match?.[1]?.length ?? 0;
}

/** 1-based line number → document index in a multi-doc bundle. */
export function bundleLineToDocIndex(yamlInput: string, line: number): number {
	if (line < 1) return 1;
	const lines = yamlInput.split('\n');
	let docIndex = 1;
	for (let i = 0; i < line - 1 && i < lines.length; i++) {
		if (/^---\s*$/.test(lines[i]!) && i > 0) docIndex += 1;
	}
	return docIndex;
}

function documentStartLine(yamlInput: string, docIndex: number): number {
	const lines = yamlInput.split('\n');
	const starts = [0];
	for (let i = 0; i < lines.length; i++) {
		if (/^---\s*$/.test(lines[i]!) && i > 0) starts.push(i);
	}
	return starts[docIndex - 1] ?? 0;
}

function parseLineKey(
	line: string,
	cursorColumn: number
): {
	indent: number;
	key?: string;
	hasColon: boolean;
	valueStart?: number;
	isArrayItem: boolean;
} {
	const indent = countIndent(line);
	const trimmed = line.slice(indent);
	const isArrayItem = /^-\s+/.test(trimmed);
	const content = isArrayItem ? trimmed.replace(/^-\s+/, '') : trimmed;

	const colonIndex = content.indexOf(':');
	if (colonIndex < 0) {
		const partialKey = content
			.slice(0, Math.max(0, cursorColumn - indent - (isArrayItem ? 2 : 0)))
			.trim();
		return { indent, key: partialKey || undefined, hasColon: false, isArrayItem };
	}

	const key = content.slice(0, colonIndex).trim();
	const valueStart = indent + (isArrayItem ? 2 : 0) + colonIndex + 1;
	const afterColon = content.slice(colonIndex + 1);
	const valuePart = afterColon.trimStart();

	return {
		indent,
		key: key || undefined,
		hasColon: true,
		valueStart: valueStart + (afterColon.length - valuePart.length),
		isArrayItem
	};
}

function hasNestedContent(lines: string[], lineIndex: number, parentIndent: number): boolean {
	for (let i = lineIndex + 1; i < lines.length; i++) {
		const line = lines[i]!;
		if (!line.trim() || line.trim().startsWith('#')) continue;
		return countIndent(line) > parentIndent;
	}
	return false;
}

function hasInlineScalarValue(content: string, colonIndex: number): boolean {
	const after = content.slice(colonIndex + 1).trim();
	return after.length > 0 && after !== '{}' && after !== '[]';
}

function isStructuralKeyLine(lines: string[], lineIndex: number, line: string, indent: number): boolean {
	const trimmed = line.slice(indent);
	if (/^-\s+/.test(trimmed)) return false;

	const colonIndex = trimmed.indexOf(':');
	if (colonIndex < 0) return false;

	if (hasInlineScalarValue(trimmed, colonIndex) && !hasNestedContent(lines, lineIndex, indent)) {
		return false;
	}

	return true;
}

function popStackToIndent(stack: StackFrame[], indent: number): void {
	while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) {
		stack.pop();
	}
}

function buildStructuralContext(
	lines: string[],
	start: number,
	end: number
): { stack: StackFrame[]; arrayContext: ArrayContext | null } {
	const stack: StackFrame[] = [];
	let arrayContext: ArrayContext | null = null;

	for (let i = start; i < end; i++) {
		const line = lines[i]!;
		if (!line.trim() || line.trim().startsWith('#')) continue;

		const indent = countIndent(line);
		if (arrayContext && indent <= arrayContext.itemIndent) {
			arrayContext = null;
		}

		popStackToIndent(stack, indent);

		const trimmed = line.slice(indent);
		if (/^-\s+/.test(trimmed)) {
			const fieldPath = stack.map((frame) => frame.key);
			arrayContext = { itemIndent: indent, fieldPath };
			const content = trimmed.replace(/^-\s+/, '');
			const colonIndex = content.indexOf(':');
			if (colonIndex >= 0) {
				const key = content.slice(0, colonIndex).trim();
				if (key) {
					stack.push({ indent, key });
				}
			}
			continue;
		}

		if (!isStructuralKeyLine(lines, i, line, indent)) continue;

		const parsed = parseLineKey(line, line.length + 1);
		if (parsed.key && parsed.hasColon) {
			stack.push({ indent, key: parsed.key });
		}
	}

	return { stack, arrayContext };
}

function ancestryAtIndent(stack: StackFrame[], indent: number): string[] {
	return stack.filter((frame) => frame.indent < indent).map((frame) => frame.key);
}

function arrayFieldPath(stack: StackFrame[]): string[] {
	return stack.map((frame) => frame.key);
}

/** True when the cursor is in the value region (after `:`), not while editing the key name. */
function isValuePosition(
	column: number,
	colonCol: number,
	valueStartCol: number | undefined,
	afterColon: string
): boolean {
	if (column <= colonCol) return false;
	if (afterColon.trim().length > 0) return true;
	const valueStart = valueStartCol ?? colonCol + 1;
	return column >= valueStart;
}

function keyPrefixFromLine(
	line: string,
	indent: number,
	isArrayItem: boolean,
	column: number
): string {
	const keyStartCol = indent + (isArrayItem ? 2 : 0) + 1;
	return line.slice(keyStartCol - 1, column).trim();
}

export function resolveYamlCursor(yamlInput: string, line: number, column: number): YamlCursor | null {
	if (line < 1) return null;
	const lines = yamlInput.split('\n');
	const lineIndex = line - 1;
	if (lineIndex >= lines.length) return null;

	const docIndex = bundleLineToDocIndex(yamlInput, line);
	const docStart = documentStartLine(yamlInput, docIndex);
	const currentLine = lines[lineIndex]!;

	const { stack, arrayContext } = buildStructuralContext(lines, docStart, lineIndex);
	const parsed = parseLineKey(currentLine, column);

	let yamlPath: string[];
	let completionKind: YamlCompletionKind = 'key';
	let valuePrefix = '';
	let inArrayItem = false;

	if (parsed.isArrayItem && !parsed.hasColon) {
		completionKind = 'array-item';
		yamlPath = arrayFieldPath(stack);
		valuePrefix = currentLine.slice(parsed.indent + 2, column).trim();
	} else if (parsed.isArrayItem && parsed.hasColon && parsed.key) {
		const keyPrefixLen = 2;
		const colonCol = parsed.indent + keyPrefixLen + parsed.key.length + 1;
		const afterColon = currentLine.slice(colonCol);
		const inValue = isValuePosition(column, colonCol, parsed.valueStart, afterColon);
		if (inValue) {
			completionKind = 'value';
			yamlPath = [...arrayFieldPath(stack), parsed.key];
			const valueStartCol = (parsed.valueStart ?? colonCol) + 1;
			valuePrefix = currentLine.slice(valueStartCol - 1, column).trim();
		} else {
			completionKind = 'key';
			yamlPath = arrayFieldPath(stack);
			const keyStartCol = parsed.indent + 2 + 1;
			valuePrefix =
				column >= colonCol
					? ''
					: currentLine.slice(keyStartCol - 1, column).trim();
		}
	} else if (arrayContext && parsed.indent > arrayContext.itemIndent) {
		inArrayItem = true;
		yamlPath = arrayContext.fieldPath;
		completionKind = 'key';
		valuePrefix = keyPrefixFromLine(currentLine, parsed.indent, false, column);
	} else if (parsed.hasColon && parsed.key) {
		const colonCol = parsed.indent + (parsed.isArrayItem ? 2 : 0) + parsed.key.length + 1;
		const afterColon = currentLine.slice(colonCol);
		const inValue = isValuePosition(column, colonCol, parsed.valueStart, afterColon);
		if (inValue) {
			completionKind = 'value';
			yamlPath = [...ancestryAtIndent(stack, parsed.indent), parsed.key];
			const valueStartCol = (parsed.valueStart ?? colonCol) + 1;
			valuePrefix = currentLine.slice(valueStartCol - 1, column).trim();
		} else {
			completionKind = 'key';
			yamlPath = ancestryAtIndent(stack, parsed.indent);
			const keyStartCol = parsed.indent + (parsed.isArrayItem ? 2 : 0) + 1;
			valuePrefix =
				column >= colonCol
					? ''
					: currentLine.slice(keyStartCol - 1, column).trim();
		}
	} else if (parsed.key) {
		completionKind = 'key';
		yamlPath = ancestryAtIndent(stack, parsed.indent);
		valuePrefix = keyPrefixFromLine(
			currentLine,
			parsed.indent,
			parsed.isArrayItem,
			column
		);
	} else {
		yamlPath = ancestryAtIndent(stack, parsed.indent);
	}

	return {
		docIndex,
		yamlPath,
		completionKind,
		valuePrefix,
		inArrayItem
	};
}

/** Path segments under spec (drops leading spec / metadata / kind keys). */
export function specPathFromYamlPath(yamlPath: string[]): string[] {
	const specIndex = yamlPath.indexOf('spec');
	if (specIndex < 0) return [];
	return yamlPath.slice(specIndex + 1);
}
