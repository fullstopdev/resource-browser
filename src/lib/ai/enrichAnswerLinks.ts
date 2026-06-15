import { buildCatalogCrdPath, buildDependencyMapFocusPath } from '$lib/urlState';

export type RelatedLink = {
	label: string;
	href: string;
	type: 'crd' | 'dependency-map' | 'docs';
};

export type EnrichAnswerInput = {
	answer: string;
	release: string;
	targets: Array<{ kind: string; group: string; name: string; version?: string }>;
	origin: string;
};

function crdPagePath(target: { kind: string; group: string; name: string; version?: string }, release: string): string {
	return buildCatalogCrdPath({
		release,
		kind: target.kind,
		name: target.name,
		version: target.version
	});
}

function dependencyMapPath(
	target: { name: string; kind: string; group: string },
	release: string
): string {
	return buildDependencyMapFocusPath({
		release,
		name: target.name,
		kind: target.kind,
		group: target.group
	});
}

/** Build quick-action links for resolved CRD targets. */
export function buildRelatedLinks(input: EnrichAnswerInput): RelatedLink[] {
	const links: RelatedLink[] = [];
	const seen = new Set<string>();

	for (const target of input.targets) {
		const crdHref = crdPagePath(target, input.release);
		const crdKey = `crd:${crdHref}`;
		if (!seen.has(crdKey)) {
			seen.add(crdKey);
			links.push({
				label: `Open ${target.kind} spec`,
				href: crdHref,
				type: 'crd'
			});
		}

		const mapHref = dependencyMapPath(target, input.release);
		const mapKey = `map:${mapHref}`;
		if (!seen.has(mapKey)) {
			seen.add(mapKey);
			links.push({
				label: `${target.kind} topology`,
				href: mapHref,
				type: 'dependency-map'
			});
		}
	}

	return links;
}

/** Return sanitized answer text and structured resource links (links are UI-only, not appended to markdown). */
export function enrichAnswerLinks(input: EnrichAnswerInput): {
	answer: string;
	relatedLinks: RelatedLink[];
} {
	const relatedLinks = buildRelatedLinks(input);
	return { answer: input.answer.trim(), relatedLinks };
}
