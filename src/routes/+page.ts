import { browser } from '$app/environment';
import { fetchManifest } from '$lib/manifest/fetch';
import releasesYaml from '$lib/releases.yaml?raw';
import { buildCrdSeoSummary, type CrdSeoSummary } from '$lib/seo/crdSummary';
import type { CrdResource, ReleasesConfig } from '$lib/structure';
import { parseCatalogParams, resolveCrdFromParam, resolveReleaseName } from '$lib/urlState';
import { schemaVersionForDocument } from '$lib/versions';
import { fetchSchema, schemaPath } from '$lib/yaml-validation/schemaCache';
import { loadStaticYaml } from '$lib/yaml/safeYaml';
import type { PageLoad } from './$types';

const releases = (loadStaticYaml(releasesYaml) as ReleasesConfig).releases;

/**
 * Server-render a short CRD summary for `/?crd=…` URLs so crawlers get the CRD's real description
 * and fields. Runs only during SSR: in the browser the catalog loads everything itself, so client
 * navigation between CRDs costs no extra requests.
 */
export const load: PageLoad = async ({ url, fetch }): Promise<{ crdSeo: CrdSeoSummary | null }> => {
	if (browser) return { crdSeo: null };
	const params = parseCatalogParams(url.searchParams);
	if (!params.crd) return { crdSeo: null };

	try {
		const releaseName = resolveReleaseName(releases, params.release);
		const release = releases.find((r) => r.name === releaseName);
		if (!release) return { crdSeo: null };

		const manifest = ((await fetchManifest(release.folder, undefined, fetch)) ??
			[]) as CrdResource[];
		const entry = resolveCrdFromParam(manifest, params.crd);
		if (!entry?.kind || !entry.group) return { crdSeo: null };

		const version = schemaVersionForDocument(entry, params.version);
		if (!version) return { crdSeo: null };
		const sections = await fetchSchema(schemaPath(release.folder, entry.name, version), fetch);
		if (!sections) return { crdSeo: null };

		return {
			crdSeo: buildCrdSeoSummary({
				kind: entry.kind,
				group: entry.group,
				version,
				release: release.name,
				sections
			})
		};
	} catch {
		// SEO is best effort; the page itself never depends on this.
		return { crdSeo: null };
	}
};
