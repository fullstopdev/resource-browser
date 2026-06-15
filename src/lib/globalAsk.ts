import { writable } from 'svelte/store';
import releasesYaml from '$lib/releases.yaml?raw';
import type { ReleasesConfig } from '$lib/structure';
import { loadStaticYaml } from '$lib/yaml/safeYaml';

export type GlobalAskContext = {
	release?: string;
	question?: string;
};

export type GlobalAskDefaults = {
	release: string;
	prefillQuestion?: string;
};

const releasesConfig = loadStaticYaml(releasesYaml) as ReleasesConfig;
const allReleases = releasesConfig.releases;

export const globalAskOpen = writable(false);
export const globalAskContext = writable<GlobalAskContext | null>(null);

export function openGlobalAsk(context?: GlobalAskContext): void {
	if (context) {
		globalAskContext.set(context);
	}
	globalAskOpen.set(true);
}

export function closeGlobalAsk(): void {
	globalAskOpen.set(false);
}

export function getDefaultReleaseName(urlRelease?: string | null): string {
	if (urlRelease && allReleases.some((r) => r.name === urlRelease)) return urlRelease;
	return allReleases.find((r) => r.default)?.name ?? allReleases[0]?.name ?? '';
}

/** Parse an EDA release name from free-form question text (e.g. "26.4.2", "EDA 26.4.1", "latest"). */
export function parseReleaseFromQuestion(question: string): string | undefined {
	const q = question.trim();
	if (!q) return undefined;

	if (/\blatest\b/i.test(q)) {
		return getDefaultReleaseName();
	}

	for (const rel of allReleases) {
		const namePattern = rel.name.replace(/\./g, '\\.');
		if (new RegExp(`\\b${namePattern}\\b`, 'i').test(q)) {
			return rel.name;
		}

		const labelCore = rel.label.replace(/^EDA\s+/i, '').replace(/\./g, '\\.');
		if (new RegExp(`\\b(?:EDA\\s+)?${labelCore}\\b`, 'i').test(q)) {
			return rel.name;
		}
	}

	return undefined;
}

/** Default release from URL ?release= and optional prefill question from openGlobalAsk(). */
export function getGlobalAskDefaults(
	pageUrl: URL,
	explicit?: GlobalAskContext | null
): GlobalAskDefaults {
	const urlRelease = getDefaultReleaseName(pageUrl.searchParams.get('release'));
	const release =
		explicit?.release && allReleases.some((r) => r.name === explicit.release)
			? explicit.release
			: urlRelease;

	return {
		release,
		prefillQuestion: explicit?.question?.trim() || undefined
	};
}

export function releaseLabel(release: string): string {
	if (!release) return '';
	const rel = allReleases.find((r) => r.name === release);
	return rel?.label ?? `EDA ${release}`;
}
