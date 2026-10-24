---
title: API Explorer
description: Browse the EDA REST API (OpenAPI) specs of each release, their operations, schemas and a schema graph.
section: Guide
order: 7
---

The **API Explorer** (`/openapi`) shows the OpenAPI specifications published by EDA: the core API
and one spec per application API group and version.

## Using it

The page has three parts:

- **Sidebar**: the API picker (core first, then the application APIs), a filter, method toggles
  (GET, POST, PUT, PATCH, DELETE, each with its count) and the tag list. Clicking a tag scrolls to
  it; the tag you're reading is highlighted. On phones the sidebar opens from **Filters and tags**.
- **Endpoints**: every tag is listed open, with the method, the path (path parameters such as
  `{namespace}` highlighted) and the summary. Public endpoints are marked.
- **Endpoint panel**: click an endpoint (or press Enter on it) to open it beside the list, with
  **Copy path**, **Copy curl**, **Show in Schema Graph**, parameters, request and response schemas,
  examples and vendor extensions. On narrower screens it opens over the page; Escape closes it and
  returns to the endpoint.

The release comes from the header's release switcher. **Paths / Schema graph** switches the view:

- _API map_ mode: how paths and schemas connect.
- _Schema dependencies_ mode: which schemas reference which.
- A **fields list check** validates a list of field paths against a schema's leaf fields.

### Keyboard

| Key                       | Action                    |
| ------------------------- | ------------------------- |
| <kbd>/</kbd>              | Focus the endpoint filter |
| <kbd>↑</kbd> <kbd>↓</kbd> | Move between endpoints    |
| <kbd>Enter</kbd>          | Open the endpoint         |
| <kbd>Esc</kbd>            | Close the endpoint panel  |

Links can point to an endpoint (`#operationId`), a tab (`tab=schemaGraph`) or a schema
(`schema=...`).

## How it loads

```mermaid
sequenceDiagram
  participant U as You
  participant P as API Explorer
  participant S as Static files
  U->>P: Choose release and spec
  P->>S: GET /openapi/{release}/manifest.json (cached)
  S-->>P: Spec list with titles, groups, path counts
  P->>S: GET the spec JSON (core or apps/{group}/{version})
  S-->>P: OpenAPI document
  P->>P: Clean the spec for display
  P->>U: Paths and operations
  opt Schema Graph tab
    P->>S: GET api-graph.json next to the spec
    S-->>P: Precomputed graph
    P->>U: Layered graph layout
  end
```

Specs without any paths are hidden from the list. The graph layout orders each level to reduce
crossing lines.
