/** Key used by an earlier version of the page that autosaved the editor text. */
const LEGACY_DRAFT_KEY = 'validate-yaml:draft:v1';

/**
 * Validate YAML never keeps manifests in the browser. Remove a draft saved by the earlier
 * autosave feature so old content doesn't linger. Storage can throw (private mode, blocked
 * site data); that is never an error here.
 */
export function purgeLegacyDraft(storage: Storage | undefined = globalThis.localStorage): void {
	try {
		storage?.removeItem(LEGACY_DRAFT_KEY);
	} catch {
		/* ignore */
	}
}
