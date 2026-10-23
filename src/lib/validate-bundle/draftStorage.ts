/** Autosaved Validate YAML draft, kept in this browser only. */
export type ValidateDraft = { yaml: string; release?: string; savedAt: number };

const DRAFT_KEY = 'validate-yaml:draft:v1';

/** Storage can throw (private mode, blocked site data); a missing draft is never an error. */
export function loadDraft(
	storage: Storage | undefined = globalThis.localStorage
): ValidateDraft | null {
	try {
		const raw = storage?.getItem(DRAFT_KEY);
		if (!raw) return null;
		const draft = JSON.parse(raw) as Partial<ValidateDraft>;
		return typeof draft.yaml === 'string' && draft.yaml.trim()
			? { yaml: draft.yaml, release: draft.release, savedAt: Number(draft.savedAt) || 0 }
			: null;
	} catch {
		return null;
	}
}

export function saveDraft(
	draft: Omit<ValidateDraft, 'savedAt'>,
	storage: Storage | undefined = globalThis.localStorage
): void {
	try {
		if (!draft.yaml.trim()) {
			storage?.removeItem(DRAFT_KEY);
			return;
		}
		storage?.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
	} catch {
		/* quota exceeded or storage blocked: drafts are a convenience */
	}
}

export function clearDraft(storage: Storage | undefined = globalThis.localStorage): void {
	try {
		storage?.removeItem(DRAFT_KEY);
	} catch {
		/* ignore */
	}
}
