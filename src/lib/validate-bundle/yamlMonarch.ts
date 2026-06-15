import type { languages } from 'monaco-editor';

/** Lightweight YAML Monarch tokenizer for VS Code-like syntax highlighting. */
export const yamlMonarchLanguage: languages.IMonarchLanguage = {
	tokenizer: {
		root: [
			[/^---$/, 'meta.tag'],
			[/^\s*#.*$/, 'comment'],
			[/^\s*-\s/, 'delimiter'],
			[/[a-zA-Z_][\w.-]*(?=\s*:)/, 'type'],
			[/:\s*/, 'delimiter', '@value'],
			[/[{}[\]]/, 'delimiter.bracket']
		],
		value: [
			[/\s*#.*$/, { token: 'comment', next: '@pop' }],
			[/\s*$/, { token: '', next: '@pop' }],
			[/"([^"\\]|\\.)*"/, 'string', '@pop'],
			[/'([^'\\]|\\.)*'/, 'string', '@pop'],
			[/\b(true|false|null|~)\b/, 'keyword', '@pop'],
			[/[+-]?\d+(\.\d+)?/, 'number', '@pop'],
			[/[^\s#]+/, 'string', '@pop']
		]
	}
};
