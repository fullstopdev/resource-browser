import type { ManifestResource } from '$lib/manifest';
import { displayKind, displayGroup, type SearchableResource } from '$lib/resourceSearch';
import { compareVersionDesc } from '$lib/versions';
import type { DeprecatedApiVersion, DeprecatedItem } from './types';

const REMOVED_IN_UNKNOWN = 'Next major release';

export function resolveResourceKind(resource: ManifestResource): string {
	return displayKind(resource as SearchableResource);
}

export function resolveResourceGroup(resource: ManifestResource): string {
	return displayGroup(resource as SearchableResource);
}

export function fullApiVersion(resource: ManifestResource, versionName: string): string {
	const group = resolveResourceGroup(resource);
	return `${group}/${versionName}`;
}

export function recommendedApiVersion(resource: ManifestResource): string | undefined {
	const stable = (resource.versions ?? []).filter((v) => v?.name && !v.deprecated);
	if (stable.length === 0) return undefined;
	const latest = [...stable].sort((a, b) => compareVersionDesc(a.name, b.name))[0];
	return fullApiVersion(resource, latest.name);
}

export function detectNewlyPromotedApiVersion(
	sourceResource: ManifestResource | undefined,
	targetResource: ManifestResource
): string | undefined {
	if (!sourceResource) return undefined;

	const sourceNames = new Set((sourceResource.versions ?? []).map((v) => v.name).filter(Boolean));
	const promoted = (targetResource.versions ?? []).filter(
		(v) => v?.name && !v.deprecated && !sourceNames.has(v.name)
	);
	if (promoted.length === 0) return undefined;

	const latest = [...promoted].sort((a, b) => compareVersionDesc(a.name, b.name))[0];
	return fullApiVersion(targetResource, latest.name);
}

export function buildDeprecationMigrationPath(
	resource: ManifestResource,
	recommended?: string,
	deprecatedVersions: DeprecatedApiVersion[] = []
): string {
	const kind = resolveResourceKind(resource);
	const newlyDeprecated = deprecatedVersions
		.filter((v) => v.newInRelease)
		.map((v) => v.apiVersion);

	if (recommended && newlyDeprecated.length > 0) {
		const from = newlyDeprecated.join(', ');
		return `Migrate ${kind} manifests from ${from} → ${recommended}`;
	}
	if (recommended) {
		return `Adopt apiVersion ${recommended} for ${kind}`;
	}
	return `Adopt a non-deprecated apiVersion for ${kind} from the catalog`;
}

export function countDeprecatedApiVersions(items: DeprecatedItem[]): number {
	return items.reduce((n, item) => n + item.deprecatedVersions.length, 0);
}

export function countNewlyDeprecatedApiVersions(items: DeprecatedItem[]): number {
	return items.reduce(
		(n, item) => n + item.deprecatedVersions.filter((v) => v.newInRelease).length,
		0
	);
}

export function sortDeprecatedItems(items: DeprecatedItem[]): DeprecatedItem[] {
	return [...items].sort((a, b) => a.kind.localeCompare(b.kind));
}

export function removedInLabel(version: DeprecatedApiVersion): string | undefined {
	if (version.removedInVersion && version.removedInVersion !== 'TBD') {
		return version.removedInVersion;
	}
	return REMOVED_IN_UNKNOWN;
}

export type RawDeprecatedVersion = {
	versionName: string;
	newInRelease: boolean;
};

export function groupDeprecatedByResource(
	resources: Array<{
		resource: ManifestResource;
		versions: RawDeprecatedVersion[];
		newlyPromotedApiVersion?: string;
	}>
): DeprecatedItem[] {
	const items: DeprecatedItem[] = [];

	for (const { resource, versions, newlyPromotedApiVersion } of resources) {
		if (versions.length === 0) continue;

		const kind = resolveResourceKind(resource);
		const group = resolveResourceGroup(resource);
		const recommended = recommendedApiVersion(resource);
		const deprecatedVersions = versions.map(({ versionName, newInRelease }) => ({
			version: versionName,
			apiVersion: fullApiVersion(resource, versionName),
			removedInVersion: REMOVED_IN_UNKNOWN,
			newInRelease
		}));

		items.push({
			kind,
			group,
			crdName: resource.name,
			recommendedApiVersion: recommended,
			newlyPromotedApiVersion,
			migrationPath: buildDeprecationMigrationPath(resource, recommended, deprecatedVersions),
			deprecatedVersions
		});
	}

	return sortDeprecatedItems(items);
}
