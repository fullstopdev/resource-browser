import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from './copyToClipboard';

function mockLegacyCopy(execCommandResult: boolean) {
	const textarea = {
		value: '',
		style: {} as CSSStyleDeclaration,
		setAttribute: vi.fn(),
		select: vi.fn(),
		setSelectionRange: vi.fn()
	};
	const execCommand = vi.fn().mockReturnValue(execCommandResult);
	vi.stubGlobal('document', {
		createElement: vi.fn().mockReturnValue(textarea),
		body: {
			appendChild: vi.fn(),
			removeChild: vi.fn()
		},
		execCommand
	});
	return { textarea, execCommand };
}

describe('copyToClipboard', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('returns false for empty text', async () => {
		expect(await copyToClipboard('')).toBe(false);
	});

	it('uses clipboard API when available', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });

		expect(await copyToClipboard('hello')).toBe(true);
		expect(writeText).toHaveBeenCalledWith('hello');
	});

	it('falls back to execCommand when clipboard API throws', async () => {
		const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
		const { execCommand } = mockLegacyCopy(true);
		vi.stubGlobal('navigator', { clipboard: { writeText } });

		expect(await copyToClipboard('fallback text')).toBe(true);
		expect(writeText).toHaveBeenCalled();
		expect(execCommand).toHaveBeenCalledWith('copy');
	});

	it('returns false when both methods fail', async () => {
		const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
		mockLegacyCopy(false);
		vi.stubGlobal('navigator', { clipboard: { writeText } });

		expect(await copyToClipboard('nope')).toBe(false);
	});
});
