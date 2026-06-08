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
	release: string;
	kind: string;
	group: string;
	name: string;
	version: string;
	hasCrdContext: boolean;
	source: 'explicit' | 'url-crd' | 'url-release' | 'default';
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

const TOOL_PAGES_WITH_RELEASE = new Set([
	'validate-yaml',
	'spec-search',
	'spec-search-auto',
	'dependency-map'
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

function resourceFromManifest(entry: ManifestResource, versionOverride?: string): ResolvedAskContext {
	const kind = entry.kind || entry.name.split('.')[0] || '';
	const group = entry.group || entry.name.split('.').slice(1).join('.') || '';
	return {
		release: '',
		kind,
		group,
		name: entry.name,
		version: versionOverride || getLatestVersion(entry) || '',
		hasCrdContext: true,
		source: 'url-crd'
	};
}

function releaseOnlyContext(release: string, source: ResolvedAskContext['source']): ResolvedAskContext {
	return {
		release,
		kind: '',
		group: '',
		name: '',
		version: '',
		hasCrdContext: false,
		source
	};
}

async function resolveFromExplicit(ctx: GlobalAskContext): Promise<ResolvedAskContext> {
	const release = ctx.release && allReleases.some((r) => r.name === ctx.release)
		? ctx.release
		: getDefaultReleaseName();

	if (ctx.name || (ctx.kind && ctx.group)) {
		const rel = allReleases.find((r) => r.name === release);
		if (rel) {
			const manifest = (await fetchManifest(rel.folder)) ?? [];
			if (ctx.name) {
				const byName = manifest.find((r) => r.name === ctx.name);
				if (byName) {
					return { ...resourceFromManifest(byName, ctx.version), release, source: 'explicit' };
				}
			}
			if (ctx.kind) {
				const byKind = manifest.find(
					(r) =>
						r.kind === ctx.kind &&
						(!ctx.group || r.group === ctx.group || r.name.endsWith('.' + ctx.group))
				);
				if (byKind) {
					return {
						...resourceFromManifest(byKind, ctx.version),
						release,
						source: 'explicit'
					};
				}
			}
		}

		return {
			release,
			kind: ctx.kind ?? '',
			group: ctx.group ?? '',
			name: ctx.name ?? (ctx.kind && ctx.group ? `${ctx.kind}.${ctx.group}` : ''),
			version: ctx.version ?? '',
			hasCrdContext: !!(ctx.kind && ctx.group),
			source: 'explicit'
		};
	}

	return releaseOnlyContext(release, 'explicit');
}

function releaseFromToolPage(pathname: string, searchParams: URLSearchParams): string | null {
	const page = pathname.split('/').filter(Boolean)[0] ?? '';
	if (page === 'comparison') {
		return getDefaultReleaseName(searchParams.get('sr'));
	}
	if (TOOL_PAGES_WITH_RELEASE.has(page)) {
		return getDefaultReleaseName(searchParams.get('release'));
	}
	return null;
}

export async function resolveGlobalAskContext(
	pageUrl: URL,
	explicit?: GlobalAskContext | null
): Promise<ResolvedAskContext> {
	if (explicit) {
		return resolveFromExplicit(explicit);
	}

	const parsed = parseCrdPageUrl(pageUrl.pathname);
	if (parsed) {
		const release = getDefaultReleaseName(pageUrl.searchParams.get('release'));
		const rel = allReleases.find((r) => r.name === release);
		if (rel) {
			const manifest = (await fetchManifest(rel.folder)) ?? [];
			const entry = manifest.find((r) => r.name === parsed.name);
			if (entry) {
				return {
					...resourceFromManifest(entry, parsed.version),
					release,
					source: 'url-crd'
				};
			}
		}
	}

	const toolRelease = releaseFromToolPage(pageUrl.pathname, pageUrl.searchParams);
	if (toolRelease) {
		return releaseOnlyContext(toolRelease, 'url-release');
	}

	return releaseOnlyContext(getDefaultReleaseName(), 'default');
}

export function contextSummary(ctx: ResolvedAskContext): string {
	const rel = allReleases.find((r) => r.name === ctx.release);
	const releaseLabel = rel?.label ?? ctx.release;
	if (ctx.hasCrdContext && ctx.kind) {
		const groupPart = ctx.group ? ` (${ctx.group})` : '';
		return `${ctx.kind}${groupPart} · ${releaseLabel}`;
	}
	return releaseLabel;
}
