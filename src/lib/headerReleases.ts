import { getContext, setContext } from 'svelte';
import { readable, type Readable } from 'svelte/store';

/** A page's own release list for the header switcher (e.g. the OpenAPI releases). */
export type HeaderReleaseOptions = {
	releases: Array<{ name: string; default?: boolean }>;
	current: string;
	/** Where choosing a release goes; the page handles it as a normal navigation. */
	href: (name: string) => string;
};

const KEY = Symbol('header-releases');

/** Call in a page component, before it renders AppHeader. */
export function setHeaderReleases(options: Readable<HeaderReleaseOptions | null>): void {
	setContext(KEY, options);
}

export function getHeaderReleases(): Readable<HeaderReleaseOptions | null> {
	return getContext<Readable<HeaderReleaseOptions | null> | undefined>(KEY) ?? readable(null);
}
