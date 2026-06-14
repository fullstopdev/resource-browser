import { writable } from 'svelte/store';
import { fetchManifest } from '$lib/manifest';
import type { ManifestResource } from '$lib/manifest';
import releasesYaml from '$lib/releases.yaml?raw';
import type { ReleasesConfig } from '$lib/structure';
import { loadStaticYaml } from '$lib/yaml/safeYaml';
import { getLatestVersion } from '$lib/versions';

export type GlobalAskContext = {
	release?: string;
	kind?: string;
	group?: string;
	name?: string;
	version?: string;
	question?: string;
};

export type ResolvedAskContext = {
	/** Release explicitly scoped (caller context or parsed from a question). */
	release?: string;
	/** Default release for KV chip actions on CRD detail pages only. */
	kvRelease?: string;
	kind: string;
	group: string;
	name: string;
	version: string;
	hasCrdContext: boolean;
};

const releasesConfig = loadStaticYaml(releasesYaml) as ReleasesConfig;
const allReleases = releasesConfig.releases;

const NON_CRD_PREFIXES = new Set([
	'spec-search',
	'spec-search-auto',
	'validate-yaml',
	'comparison',
	'dependency-map',
	'release-notes',
	'bulk-diff',
	'sitemap'
]);

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

export function parseCrdPageUrl(pathname: string): { name: string; version: string } | null {
	const match = pathname.match(/^\/([^/]+)\/([^/]+)$/);
	if (!match) return null;
	const [, name, version] = match;
	const prefix = name.split('.')[0];
	if (NON_CRD_PREFIXES.has(prefix) || NON_CRD_PREFIXES.has(name)) return null;
	if (!name.includes('.')) return null;
	return { name, version };
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

function emptyContext(): ResolvedAskContext {
	return {
		kind: '',
		group: '',
		name: '',
		version: '',
		hasCrdContext: false
	};
}

function resourceFromManifest(
	entry: ManifestResource,
	versionOverride?: string,
	releaseName?: string
): ResolvedAskContext {
	const kind = entry.kind || entry.name.split('.')[0] || '';
	const group = entry.group || entry.name.split('.').slice(1).join('.') || '';
	const scopedRelease = releaseName ?? getDefaultReleaseName();
	return {
		release: scopedRelease,
		kvRelease: scopedRelease,
		kind,
		group,
		name: entry.name,
		version: versionOverride || getLatestVersion(entry) || '',
		hasCrdContext: true
	};
}

function crdContextFromName(name: string, version: string, releaseName?: string): ResolvedAskContext {
	const kind = name.split('.')[0] || '';
	const group = name.split('.').slice(1).join('.') || '';
	const scopedRelease = releaseName ?? getDefaultReleaseName();
	return {
		release: scopedRelease,
		kvRelease: scopedRelease,
		kind,
		group,
		name,
		version,
		hasCrdContext: true
	};
}

async function resolveFromExplicit(ctx: GlobalAskContext): Promise<ResolvedAskContext> {
	const release =
		ctx.release && allReleases.some((r) => r.name === ctx.release) ? ctx.release : undefined;

	if (ctx.name || (ctx.kind && ctx.group)) {
		const lookupRelease = release ?? getDefaultReleaseName();
		const rel = allReleases.find((r) => r.name === lookupRelease);
		if (rel) {
			const manifest = (await fetchManifest(rel.folder)) ?? [];
			if (ctx.name) {
				const byName = manifest.find((r) => r.name === ctx.name);
				if (byName) {
					return resourceFromManifest(byName, ctx.version, lookupRelease);
				}
			}
			if (ctx.kind) {
				const byKind = manifest.find(
					(r) =>
						r.kind === ctx.kind &&
						(!ctx.group || r.group === ctx.group || r.name.endsWith('.' + ctx.group))
				);
				if (byKind) {
					return resourceFromManifest(byKind, ctx.version, lookupRelease);
				}
			}
		}

		const resolved: ResolvedAskContext = {
			release: lookupRelease,
			kvRelease: lookupRelease,
			kind: ctx.kind ?? '',
			group: ctx.group ?? '',
			name: ctx.name ?? (ctx.kind && ctx.group ? `${ctx.kind}.${ctx.group}` : ''),
			version: ctx.version ?? '',
			hasCrdContext: !!(ctx.kind && ctx.group)
		};
		return resolved;
	}

	if (release) {
		return { ...emptyContext(), release, kvRelease: release };
	}

	return { ...emptyContext(), release: getDefaultReleaseName(), kvRelease: getDefaultReleaseName() };
}

export async function resolveGlobalAskContext(
	pageUrl: URL,
	explicit?: GlobalAskContext | null
): Promise<ResolvedAskContext> {
	if (explicit) {
		return resolveFromExplicit(explicit);
	}

	const parsed = parseCrdPageUrl(pageUrl.pathname);
	const urlRelease = getDefaultReleaseName(pageUrl.searchParams.get('release'));

	if (parsed) {
		const rel = allReleases.find((r) => r.name === urlRelease);
		if (rel) {
			const manifest = (await fetchManifest(rel.folder)) ?? [];
			const entry = manifest.find((r) => r.name === parsed.name);
			if (entry) {
				return resourceFromManifest(entry, parsed.version, urlRelease);
			}
		}
		return crdContextFromName(parsed.name, parsed.version, urlRelease);
	}

	return { ...emptyContext(), release: urlRelease, kvRelease: urlRelease };
}

/** Minimal scoped-context label (CRD kind/group or explicit release only). */
export function contextSummary(ctx: ResolvedAskContext): string {
	const releaseLabel = ctx.release
		? allReleases.find((r) => r.name === ctx.release)?.label ?? ctx.release
		: '';
	if (ctx.hasCrdContext && ctx.kind) {
		const groupPart = ctx.group ? ` (${ctx.group})` : '';
		const releasePart = releaseLabel ? ` · ${releaseLabel}` : '';
		return `${ctx.kind}${groupPart}${releasePart}`;
	}
	if (ctx.release) {
		return releaseLabel || ctx.release;
	}
	return '';
}
