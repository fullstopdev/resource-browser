import { buildCatalogCrdPath } from '$lib/urlState';
import type { CrdDiffEntry } from './types';

export type ResourceLinkContext = {
	releaseName: string;
	version: string;
};

export function resourceLinkContext(
	crd: CrdDiffEntry,
	sourceReleaseName: string,
	targetReleaseName: string
): ResourceLinkContext | null {
	if (crd.status === 'not-in-either' || crd.status === 'error') return null;

	const releaseName =
		crd.status === 'added' || crd.status === 'removed'
			? crd.status === 'added'
				? targetReleaseName
				: sourceReleaseName
			: sourceReleaseName;

	const version =
		crd.status === 'added' && crd.targetVersion
			? crd.targetVersion
			: crd.version;

	return { releaseName, version };
}

export function resourceDetailHref(
	crd: CrdDiffEntry,
	sourceReleaseName: string,
	targetReleaseName: string
): string | null {
	const ctx = resourceLinkContext(crd, sourceReleaseName, targetReleaseName);
	if (!ctx) return null;
	return buildCatalogCrdPath({
		release: ctx.releaseName,
		kind: crd.kind,
		name: crd.name,
		version: ctx.version
	});
}
