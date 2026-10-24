/**
 * The latest (default) EDA release, read from src/lib/releases.yaml with node:fs: for tests and
 * scripts, so they follow each new release without edits.
 */
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

export function latestReleaseName(): string {
	const config = yaml.load(readFileSync('src/lib/releases.yaml', 'utf8')) as {
		releases: Array<{ name: string; default?: boolean }>;
	};
	return (config.releases.find((r) => r.default) ?? config.releases[0]!).name;
}
