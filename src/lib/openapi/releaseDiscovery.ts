import { compareReleaseDesc } from '$lib/release-notes/generateNotes';

export { compareReleaseDesc };

/** Semver folder names under `static/openapi/` (e.g. `25.8.3`, `26.4.3`). */
export const OPENAPI_RELEASE_FOLDER = /^\d+\.\d+\.\d+$/;

export function isOpenApiReleaseFolder(name: string): boolean {
	return OPENAPI_RELEASE_FOLDER.test(name.trim());
}

/** Discover release folder names, newest first (matches openapi-releases.yaml order). */
export function discoverOpenApiReleaseFolders(folders: string[]): string[] {
	return folders.filter(isOpenApiReleaseFolder).sort(compareReleaseDesc);
}
