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
	const resourceName = target.name || `${target.kind.toLowerCase()}s.${target.group}`;
	const version = target.version || 'v1alpha1';
	return `/${resourceName}/${version}?release=${encodeURIComponent(release)}`;
}

function dependencyMapPath(target: { name: string }, release: string): string {
	return `/dependency-map?focus=${encodeURIComponent(target.name)}&release=${encodeURIComponent(release)}`;
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
				label: `${target.kind} intent topology`,
				href: mapHref,
				type: 'dependency-map'
			});
		}
	}

	return links;
}

/** Append ## Related in EDA footer and return enriched markdown + links metadata. */
export function enrichAnswerLinks(input: EnrichAnswerInput): {
	answer: string;
	relatedLinks: RelatedLink[];
} {
	const relatedLinks = buildRelatedLinks(input);
	if (!relatedLinks.length) {
		return { answer: input.answer, relatedLinks };
	}

	if (/##\s+Related in EDA\b/i.test(input.answer)) {
		return { answer: input.answer, relatedLinks };
	}

	const footer = [
		'',
		'## Related in EDA',
		'',
		...relatedLinks.map((l) => `- [${l.label}](${l.href})`)
	].join('\n');

	return {
		answer: `${input.answer.trim()}${footer}`,
		relatedLinks
	};
}
