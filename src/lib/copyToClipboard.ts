/**
 * Copy text to the clipboard. Tries the Clipboard API first, then falls back to
 * execCommand for HTTP or other non-secure contexts where writeText throws.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
	if (!text) return false;

	if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Secure context required — fall through to legacy copy.
		}
	}

	try {
		const textarea = document.createElement('textarea');
		textarea.value = text;
		textarea.setAttribute('readonly', '');
		textarea.style.position = 'fixed';
		textarea.style.left = '-9999px';
		textarea.style.opacity = '0';
		document.body.appendChild(textarea);
		textarea.select();
		textarea.setSelectionRange(0, text.length);
		const ok = document.execCommand('copy');
		document.body.removeChild(textarea);
		return ok;
	} catch {
		return false;
	}
}
