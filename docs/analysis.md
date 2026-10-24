# Code health & analysis

Internal review of the EDA Resource Browser codebase (2026-10-23). **Repo-only — not published on
the site.** Public documentation lives in `src/lib/docs/pages/` and is served at `/docs`.

Nothing listed here was removed or changed as part of the review.

## Summary

| Area                                                                                                          | Status                                                                            |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| User-facing tools (catalog, search, validate, compare, dependency map, API explorer/compare, release changes) | Healthy, well tested                                                              |
| AI                                                                                                            | Only **AI Fix** is live; a whole Ask-AI + RAG stack is dormant                    |
| Routing                                                                                                       | Several legacy routes are redirect-only but still carry full page components      |
| Build                                                                                                         | `prebuild` is skipped by the Cloudflare build scripts                             |
| Tests                                                                                                         | 811 server tests pass; 3 data-dependent failures; client test project is empty    |
| SEO                                                                                                           | CRD content renders client-side only; titles and descriptions are server-rendered |
| Security                                                                                                      | Headers, input limits, proxy allowlist in place; dependency audits clean          |

## Live vs dormant code

```mermaid
flowchart LR
  subgraph Live
    VY["/validate-yaml"] -->|"fixYAML"| AI["/api/ai action=fix"]
    WC["scripts/warm-cache.ts"] -->|"all other actions"| AI
    AI --> KV["KV AI_CACHE"]
    AI --> WAI["Workers AI"]
  end
  subgraph Dormant["Dormant (no route uses it)"]
    GAP["GlobalAskPanel.svelte"] --> CAP["CrdAskPanel.svelte"]
    CAP --> ASK["askAI.ts"]
    ASK -.->|"POST"| GONE["/api/ask (removed, empty folder)"]
    BAC["buildAskContext.ts"] --> RAG["ai/rag/retrieve.ts"]
    RAG -.-> VEC["Vectorize CRD_INDEX / DOCS_INDEX"]
    FLAG["featureFlags.askAiEnabled (never read)"]
    PX["/api/openapi-proxy (no caller)"]
  end
  EMB["embed-*.ts scripts"] --> VEC
```

### Findings

1. **Ask-AI stack is dead code.** `GlobalAskPanel.svelte` → `CrdAskPanel.svelte` → `askAI.ts` posts to
   `/api/ask`, which no longer exists (`src/routes/api/ask/` is empty). No route imports either panel.
   `featureFlags.askAiEnabled` is never read.
2. **RAG/Vectorize unused at runtime.** `ai/rag/*`, `buildAskContext.ts`, most of `buildRichContext.ts`,
   `resolveAskTargets`, `classifyQuestionIntent` and `eval/goldenQuestions` are only reached from
   tests and the embed scripts. The `CRD_INDEX` / `DOCS_INDEX` bindings are declared but unused by
   any request.
3. **LLM actions without a UI.** `explain`, `example` and `spec-search` are only called by `warm-cache.ts` (or nothing); `field` now powers Explain → More detail; `validate` and `compare` are disabled.
4. **`/api/openapi-proxy` has no caller** in the app. It is hardened (origin allowlist, no
   redirects, size limit) but is still a public relay to the configured EDA API.
5. **Redirect routes with dead bodies.** `/[name]/[version]/+page.svelte`, `/spec-search-auto/+page.svelte`
   (~1,200 lines) and the `/api-browser` pages never render: their loads always redirect.
6. **Empty route folders**: `src/routes/{robots.txt,sitemap.xml,sitemaps/pages.xml,sitemaps/crds.xml,api/ask,configlet-builder}`.
7. **`/sitemap` page links to redirect URLs** (`/<crd>/<version>`) and still lists `/spec-search-auto`.
8. **`_routes.json` excludes `/releases/*`**, but no `static/releases/` folder exists.

## Build and deploy pitfalls

```mermaid
flowchart LR
  B["npm run build"] --> PRE["prebuild: sitemap, release notes, OpenAPI manifests, API index"]
  PRE --> V1["vite build"]
  BC["npm run build:cloudflare / deploy:cloudflare*"] --> V2["vite build"]
  V2 -.->|"prebuild skipped"| STALE["Generated files may be stale"]
```

9. **`prebuild` only runs with `npm run build`.** The Cloudflare scripts call `vite build` directly, so
   generated files must be regenerated and committed separately. Easy to deploy a stale sitemap or
   release notes.
10. **README was inaccurate** about `prebuild` always running and referenced a missing "Vectorize RAG"
    section (fixed alongside the docs).
11. **Two lockfiles** (`package-lock.json`, `pnpm-lock.yaml`) must be updated together; drift
    changes what Cloudflare Pages installs.
12. **`deploy:cloudflare` and `deploy:cloudflare:phase1` are identical.**

## Testing gaps

13. **Client Vitest project is empty**: no `*.svelte.test.ts` files, and its setup file
    `vitest-setup-client.ts` doesn't exist, so the project would fail if a test were added.
14. **3 failing server tests depend on data** that changed or was never committed
    (`formatDependencyMap`, `auditCorpus`, `computeUnifiedGraphLayout`: missing
    `static/openapi/26.4.3/.../flowsampling.json`, hard-coded CRD counts).
15. **E2E coverage is thin**: home page, OpenAPI catalog, release-notes deprecation, docs.
16. **14 pre-existing `svelte-check` errors** in validation, OpenAPI and release-notes modules.

## SEO

17. CRD details are rendered in the browser after hydration. Titles, descriptions and canonicals
    are server-rendered (since 2026-10-23), but the schema text itself isn't in the initial HTML.
    Server-rendering a short summary per CRD (kind, group, versions, top-level fields) would help
    indexing.
18. CRD pages live at query URLs (`/?release&crd&version`). Clean path URLs would be friendlier,
    but the current `/<crd>/<version>` paths 307-redirect to the query form, so they can't be the
    canonical today.

## Resolved (Validate YAML & AI work, 2026-10-23, not yet deployed)

- AI Fix excerpt bug: long documents are sent as an excerpt and **spliced back on the server**; short ones whole.
- AI output is **verified on the server** (parse, minimal-edit guard, issue resolved), retried once on the 70B model with the reason, and only verified fixes are cached (SHA-256 prompt key, 30-day TTL, non-blocking KV write). Closes the cache-poisoning hole.
- Token budget sized from the document; parser tolerant of CRLF / `yml` / missing fence; models overridable via env; one structured log line per AI call; `npm run eval:fix` with 20 cases.
- `validate` and `compare` LLM actions disabled; same-origin check on `/api/ai`.
- Validation uses the **declared apiVersion's** schema; stale results can't overwrite newer ones; AI Fix can't overwrite newer edits; issue ids unique per run.
- Formats (int32, int64, ipv4, date-time, uri, Go duration), list-type set/map uniqueness, CEL rules as info hints, duplicate resources in a bundle, readable messages for every Ajv keyword, anyOf/oneOf noise collapsed.
- Fix-all loop: tried issues not re-sent, failures counted, fixes kept only if the issue disappears, Cancel button, client timeout.
- Editor: share link, download, undoable fixes, quick-fix lightbulb, F8 navigation, Info filter, Explain (schema + optional AI), Insert example (curated docs examples); schema fetch de-duplication and 404 caching. (Draft autosave and file upload were later removed for privacy; YAML is not kept in the browser.)

Still open from this area: namespace rule for cluster-scoped kinds (static data has no CRD `scope`), cross-document reference checks (26.8.2 schemas carry no reference annotations), validation in a Web Worker for very large bundles, rate limiting (needs a custom domain for WAF rules).

## Resolved (roadmap items 2, 3, 6, 7 — 2026-10-23)

- CI added (`.github/workflows/ci.yml`): type check, unit tests, audit, end-to-end. The 3 data-dependent tests were fixed (counts read from the committed graph, flowsampling spec moved to 26.8.2, wildcard "any EDA resource" references skipped) and the 14 svelte-check errors cleared: 0 errors, all unit tests green.
- `build:cloudflare` runs `generate:all`, so deploys can't ship stale generated data.
- Upgrade check in Validate YAML: validate against a newer release and list what breaks.
- "Migrate to vN" for deprecated versions: apiVersion rewrite, scalar→object wraps, regular fixes, review.

## Resolved (roadmap items 4, 5, 8, 13)

- Dead code removed (~8,700 lines + the 1.2 MB embedding manifest): Ask-AI panels and store, RAG retrieval/chunking, embed scripts and Vectorize bindings, the unused `/api/openapi-proxy`, redirect-only page bodies, unused UI components, empty route folders. Found by an import-reachability check from every route and script.
- CRD scope recorded in `manifest.json` from the OpenAPI paths (`npm run build:crd-scopes`, part of `generate:all`): cluster-scoped kinds no longer require a namespace, and a namespace on them is flagged as ignored.
- Missing prerequisites: references (from the dependency graph) to resources that aren't in the bundle are reported as Info notes, namespace-aware.
- SEO: the catalog page server-renders each CRD's real description and schema.org JSON-LD.
- Curated Insert example: content-quality test (no shell/templates/placeholders/lab names, namespace eda); broken TopoNode replaced via the docs AI search.

## Resolved (roadmap items 9–12, 14)

- Validation runs in a Web Worker (`validation.worker.ts`), with a main-thread fallback.
- AI Fix eval grown to 61 cases (Fabric, BGP, routing policy, multi-issue), with a manual GitHub
  Actions workflow and a pass-rate threshold. It found a real guard bug: verified fixes for missing
  required fields (issue path = parent object) and for list items (`links.0` vs `links[0]`) were
  rejected. Fixed.
- AI Gateway support (`AI_GATEWAY_ID`); model trials kept the current defaults.
- Accessibility: an axe scan (WCAG 2.1 AA, serious and critical) of the catalog, a CRD page,
  Validate YAML, docs and release notes runs in CI; contrast, ARIA and list-structure issues fixed.
- Known stale e2e suites outside CI: `openapi`, `demo` and `release-notes-deprecated` still expect
  release 26.4.3 and a removed background image.

## Recommendations (by priority)

| #   | Action                                                                                                | Effort | Benefit                             |
| --- | ----------------------------------------------------------------------------------------------------- | ------ | ----------------------------------- |
| 1   | Run generators in `build:cloudflare` (or a `predeploy`) so deploys can't ship stale data              | S      | Correctness                         |
| 2   | Add a Cloudflare rate-limit rule on `/api/ai`; consider allowing only `fix` from the public endpoint  | S      | Cost control                        |
| 3   | Remove or quarantine the dormant Ask-AI / RAG stack and the unused proxy, or wire them into a feature | M      | Less attack surface and maintenance |
| 4   | Delete dead page bodies under redirect routes and the empty route folders                             | S      | Clarity                             |
| 5   | Fix or update the 3 data-dependent tests; add `vitest-setup-client.ts` or drop the client project     | S      | Green CI                            |
| 6   | Point `/sitemap` at canonical query URLs and drop `/spec-search-auto`                                 | S      | SEO consistency                     |
| 7   | Server-render a CRD summary in the catalog page                                                       | M      | Indexing                            |
| 8   | Clear the 14 `svelte-check` errors                                                                    | M      | Type safety                         |
| 9   | Add CI (GitHub Actions) running `check`, server tests and audits                                      | S      | Regressions caught early            |
