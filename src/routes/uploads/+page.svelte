<script lang="ts">
  import { page } from '$app/stores'

  import Footer from '$lib/components/Footer.svelte'
  import Theme from '$lib/components/Theme.svelte'
  import Render from '$lib/components/Render.svelte'

	import type { OpenAPISchema, Schema, VersionSchema } from '$lib/structure'
  import { expandAll, expandAllScope, ulExpanded } from '$lib/store'

  let files: FileList

  expandAll.set(false)
  expandAllScope.set("local")
  ulExpanded.set([])

  const hash = $page.url.hash?.substring(1)
  
  let group = ""
  let kind = ""
  let versions: VersionSchema = {}
  let spec: Schema = {}
  let status: Schema = {}

  let validVersions: string[] = []
  let versionOnFocus: string = ""

  async function handleUpload() {
    if(files) {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const crd = JSON.parse(text);

          const group = crd.spec.group
          const kind = crd.spec.names.kind
          const name = `${kind.toLowerCase()}.${group}`
          const versions: VersionSchema = {}

          crd.spec.versions.forEach((x: OpenAPISchema) => {
            versions[x.name] = {
              spec: x.schema.openAPIV3Schema.properties.spec,
              status: x.schema.openAPIV3Schema.properties.status
            }
          })

          validVersions = Object.keys(versions)
          versionOnFocus = validVersions[0]
          spec = versions[versionOnFocus].spec
          status = versions[versionOnFocus].status

          //localStorage.setItem('crdUploaded', JSON.stringify({name, group, kind, versions}))
          window.alert(`[Success] File uploaded.`)
        } catch (err) {
          window.alert(`[Error] Failed to upload file: ${err}`)
        }
        //window.location.reload()
      }
      reader.readAsText(files[0])
    }
  }

  function handleGlobalExpand() {
    expandAllScope.set("global")
    if($ulExpanded.length > 0) {
      expandAll.set(false)
    } else {
      expandAll.set(true)
    }
  }

  function handleVersionChange(event: Event) {
    const select = event.target as HTMLSelectElement
    const versionOnFocus = select.value
    spec = versions[versionOnFocus].spec
    status = versions[versionOnFocus].status
  }
</script>

<nav class="fixed top-0 z-20 pl-6 pr-4 py-4 w-screen font-nunito text-black dark:text-white backdrop-filter backdrop-blur-lg border-b border-gray-300 dark:border-gray-700">
  <div class="flex items-center justify-between">
    <div class="flex items-center space-x-2 overflow-x-auto scroll-light dark:scroll-dark">
      <a href="/"><img class="min-w-8" src="/images/eda.png" width="35" alt="Logo"/></a>
      <div class="flex flex-col">
        <p class="text-sm">Resource Browser</p>
        <p class="text-xs">Uploads</p>
      </div>
    </div>
    <Theme/>
  </div>
</nav>
<div class="pt-[100px] px-6 pb-6 space-y-4">
  <div>
    <input id="dropzone" type="file" class="peer hidden" accept="application/json" bind:files on:change={handleUpload} />
    <label for="dropzone" class="flex items-center justify-center px-4 py-3 cursor-pointer rounded-lg text-gray-500 dark:text-gray-400 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 border-2 border-dashed border-gray-200 dark:border-gray-700">
      <div class="flex items-center space-x-2 pr-2">
        <svg class="w-4 h-4" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
          <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v9m-5 0H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-2M8 9l4-5 4 5m1 8h.01"/>
        </svg>                
        <p class="text-sm">Click to upload a CRD</p>
      </div>
      <div class="pl-2 border-l border-gray-400 dark:border-gray-700">
        <p class="text-xs">Supported file format .json (max 10 MB)</p>
      </div>
    </label>
  </div>
</div>

<Footer home={false}/>
