import { error } from '@sveltejs/kit'

import type { PageLoad } from './$types'
import type { CrdVersionsMap, OpenAPISchema, ReleasesConfig } from '$lib/structure'

import yaml from 'js-yaml'
import res from '$lib/resources.yaml?raw'
import releases from '$lib/releases.yaml?raw'

const crdResources = yaml.load(res)
const resources = crdResources as CrdVersionsMap
const releaseConfig = yaml.load(releases) as ReleasesConfig
const allReleases = releaseConfig.releases

export const load: PageLoad = async ({ fetch, params, url }) => {
  // Check if a specific release is requested via query parameter
  const requestedRelease = url.searchParams.get('release')
  let selectedRelease = releaseConfig.releases.find(r => r.default) ?? releaseConfig.releases[0]
  
  if (requestedRelease) {
    const foundRelease = releaseConfig.releases.find(r => r.name === requestedRelease)
    if (foundRelease) {
      selectedRelease = foundRelease
    }
  }
  
  const releaseFolder = selectedRelease?.folder ?? 'resources/25.8.2'
  const releaseLabel = selectedRelease?.label ?? selectedRelease?.name ?? ''
  const name = params.name
  const versionOnFocus = params.version
  const rest = name.substring(name.indexOf(".") + 1)

  // Load release-specific manifest
  let releaseManifest: any[] = []
  try {
    const manifestResp = await fetch(`/${releaseFolder}/manifest.json`)
    if (manifestResp.ok) {
      releaseManifest = await manifestResp.json()
    }
  } catch (e) {
    console.warn(`Could not load manifest for ${releaseFolder}, using fallback`)
  }

  // Prefer release manifest entries when available; fallback to static resources.yaml otherwise
  let crdMeta: any[] = []
  if (releaseManifest.length > 0) {
    const manifestEntry = releaseManifest.find(x => x.name === name)
    if (manifestEntry) {
      crdMeta = [manifestEntry]
    }
  }

  if (crdMeta.length === 0) {
    // Try to find resource in static resources.yaml as a fallback
    crdMeta = resources[rest]?.filter(x => x.name === name) || []
  }
  
  if(crdMeta.length !== 1) {
    throw error(404, "Invalid resource name")
  }

  const crdMetaVersion = crdMeta[0].versions.filter(x => x.name === versionOnFocus)
  if(crdMetaVersion.length == 0) {
    throw error(404, "Invalid version for the resource name")
  }

  try {
    let resp = await fetch(`/${releaseFolder}/${name}/${versionOnFocus}.yaml`)

    if (!resp.ok) {
      resp = await fetch(`/resources/${name}/${versionOnFocus}.yaml`)
    }

    if (!resp.ok) {
      throw error(404, 'Error fetching resource')
    }

    const crdText = await resp.text()
    const crd = yaml.load(crdText) as OpenAPISchema

    const group = crdMeta[0].group
    const kind = crdMeta[0].kind
    const deprecated = crdMetaVersion[0].deprecated
    const appVersion = ('appVersion' in crdMetaVersion[0] ? crdMetaVersion[0].appVersion : "")
    
    // Get valid versions for this resource from the manifest (release-specific)
    // Fall back to crdMeta if manifest doesn't have it
    const manifestResource = releaseManifest.find((r: any) => r.name === name)
    const validVersions = manifestResource?.versions?.map((v: any) => v.name) || crdMeta[0].versions.map(x => x.name)

    const spec = crd.schema.openAPIV3Schema.properties.spec
    const status = crd.schema.openAPIV3Schema.properties.status
    // Determine the earliest release in which this specific version is marked deprecated
    let deprecatedSince: string | null = null
    // iterate from oldest to newest
    const checkReleases = [...allReleases].reverse();
    for (const r of checkReleases) {
      try {
        let manifest: any[] = []
        if (r.name === selectedRelease.name && releaseManifest.length > 0) {
          manifest = releaseManifest
        } else {
          const resp = await fetch(`/${r.folder}/manifest.json`)
          if (!resp.ok) continue
          manifest = await resp.json()
        }
        const entry = manifest.find((x: any) => x.name === name)
        if (!entry || !entry.versions) continue
        const v = entry.versions.find((vv: any) => vv.name === versionOnFocus)
        if (v && v.deprecated) { deprecatedSince = r.label || r.name; break }
      } catch (e) {
        // ignore and continue
      }
    }
    return {
      name,
      versionOnFocus,
      kind,
      group,
      deprecated,
      appVersion,
      validVersions,
      spec,
      status,
      releaseLabel,
      releaseFolder,
      allReleases,
      releaseManifest,
      deprecatedSince
    }
  } catch(e) {
    throw error(404, 'Error fetching resource' + e)
  }
}