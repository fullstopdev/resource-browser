---
title: API Comparison
description: Compare the EDA OpenAPI specs of two releases, path by path and schema by schema.
section: Guide
order: 8
---

**API Comparison** (`/openapi-comparison`) shows how the EDA REST API changed between a source and
a target release.

## Using it

1. Choose the **source** and **target** releases (`?sr=...&tr=...` in the URL).
2. Run the comparison (button or <kbd>Enter</kbd>). Progress is shown per API family.
3. Filter by status, swap the direction, and open an entry to see path and schema differences.

## Statuses

| Status   | Meaning                                                                |
| -------- | ---------------------------------------------------------------------- |
| Added    | The API exists only in the target release                              |
| Removed  | The API exists only in the source release                              |
| Modified | Paths or schema content changed                                        |
| Shared   | Same content (a change of version string alone still counts as shared) |

## How it works

```mermaid
flowchart LR
  MS["Source OpenAPI manifest"] --> D["Diff the two manifests"]
  MT["Target OpenAPI manifest"] --> D
  D --> FAM["Group specs by API family"]
  FAM --> BOTH{"In both releases?"}
  BOTH -->|"no"| AR["Added or removed"]
  BOTH -->|"yes"| LOAD["Load both specs, 8 at a time"]
  LOAD --> CMP["Compare paths and schemas"]
  CMP --> ST["Modified or shared"]
```
