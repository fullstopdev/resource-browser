/**
 * Releases grouped into release lines (26.8, 26.4, 25.12, …), newest first, for the homepage:
 * the latest patch of each line is the one people pick, older patches go in a "More" list.
 */
export type ReleaseLike = { name: string; default?: boolean };

export type ReleaseLine<R extends ReleaseLike> = {
	/** `26.8` */
	line: string;
	/** Patches, newest first; `releases[0]` is the latest of the line. */
	releases: R[];
};

function parts(name: string): number[] {
	return String(name)
		.split('.')
		.map((n) => parseInt(n, 10) || 0);
}

/** Newest first: 26.8.2, 26.8.1, 26.4.3, … */
export function compareReleaseDesc(a: ReleaseLike, b: ReleaseLike): number {
	const pa = parts(a.name);
	const pb = parts(b.name);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pb[i] ?? 0) - (pa[i] ?? 0);
		if (d !== 0) return d;
	}
	return 0;
}

export function releaseLines<R extends ReleaseLike>(releases: R[]): ReleaseLine<R>[] {
	const byLine = new Map<string, R[]>();
	for (const r of [...releases].sort(compareReleaseDesc)) {
		const line = parts(r.name).slice(0, 2).join('.');
		byLine.set(line, [...(byLine.get(line) ?? []), r]);
	}
	return [...byLine].map(([line, list]) => ({ line, releases: list }));
}

/**
 * The first `shown` lines' latest patches, and everything else (older patches of those lines and
 * every release of older lines), still grouped by line and newest first.
 */
export function splitReleaseLines<R extends ReleaseLike>(
	releases: R[],
	shown = 4
): { featured: ReleaseLine<R>[]; more: ReleaseLine<R>[] } {
	const lines = releaseLines(releases);
	const featured = lines.slice(0, shown);
	const more = [
		...featured
			.map((l) => ({ line: l.line, releases: l.releases.slice(1) }))
			.filter((l) => l.releases.length > 0),
		...lines.slice(shown)
	];
	return { featured, more };
}
