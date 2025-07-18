import type { Schema } from "$lib/structure"

export function getScope(resource: Schema) {
  return resource.type === "array" ? resource.items : resource
}

export function getDescription(resource: Schema) {
  return resource?.description || (resource.type === "array" ? resource.items.type : "")
}

export function hashExistDeep(hash: string, currentId: string) {
  if(hash.indexOf(currentId) !== -1) {
    return true
  }
  return false
}