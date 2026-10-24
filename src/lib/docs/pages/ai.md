---
title: AI & caching
description: How /api/ai works — actions, models, request limits, server-side verification of fixes, the KV cache, fallbacks and cache warming.
section: Developer
order: 3
---

The site uses **Cloudflare Workers AI** in [Validate YAML](validate-yaml.md): **AI Fix** and the
**More detail (AI)** field explanation. Both go through `POST /api/ai`.

## Actions

| Action                                            | LLM? | Used by               | Returns                                                                                           |
| ------------------------------------------------- | ---- | --------------------- | ------------------------------------------------------------------------------------------------- |
| `fix`                                             | Yes  | AI Fix                | Corrected YAML for one issue, several issues, or a syntax error — **verified**                    |
| `field`                                           | Yes  | Explain → More detail | Plain-language explanation of one field (falls back to schema facts)                              |
| `explain`                                         | Yes  | cache warming         | Explanation of a CRD (falls back to a schema summary)                                             |
| `example`                                         | Yes  | cache warming         | Example manifests; one is picked per response                                                     |
| `spec-search`                                     | Yes  | —                     | Answer to a free-text question about a CRD                                                        |
| `schema-summary`, `relationships`, `full-context` | No   | cache warming         | Deterministic text built from the schema                                                          |
| `dependency-map`                                  | No   | cache warming         | Release-wide dependency summary                                                                   |
| `validate`, `compare`                             | —    | —                     | **Disabled (404)**: they duplicated the browser validator and the diff engine and only cost quota |

All LLM calls use `temperature = 0` and a fixed seed, so the same input gives the same answer
and can be cached.

## Models

| Tier        | Default model                              | Override           |
| ----------- | ------------------------------------------ | ------------------ |
| Default     | `@cf/meta/llama-3.1-8b-instruct-fast`      | `AI_MODEL_DEFAULT` |
| Fix / retry | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | `AI_MODEL_FIX`     |

Simple fixes start on the default model; batched, relocation, migration and deeply nested fixes start
on the fix model. Output token limits are sized from the document the model must return (about
1.3× its tokens, at most 4,096). Timeouts are 90 s (120 s for fixes).

Model trials on the 61-case eval (October 2026): `@cf/qwen/qwen2.5-coder-32b-instruct` as the fix
model scored the same as the 70B default, and `@cf/meta/llama-4-scout-17b-16e-instruct` for both
tiers scored one case lower at about twice the latency, so the defaults stay.

## AI Gateway

Set `AI_GATEWAY_ID` (a gateway in the same Cloudflare account) to send every Workers AI call through
[AI Gateway](https://developers.cloudflare.com/ai-gateway/) for request logs, token and cost
analytics, and optional rate limits. The gateway's own cache is skipped (`skipCache`): only fixes
that pass verification are cached, in KV. Without the variable the app calls Workers AI directly.

## A fix request, step by step

```mermaid
sequenceDiagram
  participant B as Browser
  participant W as /api/ai Worker
  participant K as KV AI_CACHE
  participant L as Workers AI
  B->>W: POST action=fix, release, kind, userYaml, issue(s)
  W->>W: Same-origin check, size limits, required fields
  alt A rule-based fix exists
    W-->>B: 422 (use the one-click Fix)
  else
    W->>W: Short doc → send it whole, long doc → excerpt around the issue
    W->>W: Allowed values and types taken from the CRD schema
    W->>K: GET sha256(prompt version, model, prompt)
    alt Cached (always a verified fix)
      K-->>B: fix, cached=true
    else
      W->>L: Attempt 1
      W->>W: Parse, splice excerpt back, verify
      opt Rejected or unparseable
        W->>L: Attempt 2 on the fix model, with the rejection reason
        W->>W: Parse, splice, verify
      end
      W->>K: PUT only if verified (30-day TTL, in the background)
      W-->>B: fixedYaml + verified, or fixable=false with the reason
    end
  end
```

### Long documents

Documents up to **200 lines** are sent whole and the model returns the whole document. Longer ones
are cut to the lines around the issue; the model returns **only those lines**, and the server
splices them back by line range. The model never has to reproduce text it didn't see.

### Verification

Before a fix is returned or cached, the server checks it:

1. it parses as a single YAML object;
2. the minimal-edit guard passes — `kind` and `apiVersion` unchanged, no unrelated keys added, a
   bounded number of changed lines (the same guard the browser uses);
3. the reported issue is resolved — enum value now allowed, type matches the schema, required field
   present, unknown field removed. YAML syntax fixes only need to parse.

Ajv can't run in Workers (it compiles validators with `new Function`), so the server checks the
issue directly against the schema; the browser then re-runs full validation on the result.

## Request limits

| Limit        | Value                                                                              |
| ------------ | ---------------------------------------------------------------------------------- |
| Request body | 1 MB                                                                               |
| `userYaml`   | 512 KiB (same as the editor)                                                       |
| `field`      | 1,024 characters                                                                   |
| `issues`     | 100 per request                                                                    |
| Origin       | Same-origin browser requests only (scripts without an `Origin` header are allowed) |

## Cache keys

```text
ai:v3:fix:{release}:{sha256(promptVersion, model, system prompt, user prompt)}   (30-day TTL)
ai:v2:{release}:{kind}:{group}:{apiVersion}:{field}:{compareRelease}:{action}     (other actions)
```

Fix keys hash everything that shaped the answer. Hints sent by the browser are part of the prompt,
so a crafted request can only populate its own key — never the entry other users read — and only
verified fixes are written. Bumping `FIX_PROMPT_VERSION` retires all cached fixes.

## Failures and fallbacks

```mermaid
flowchart LR
  REQ["LLM call"] --> OK{"Succeeded?"}
  OK -->|"yes"| ANS["Answer"]
  OK -->|"quota exhausted"| Q["explain / field: schema-based fallback, others: quota error"]
  OK -->|"timeout"| T["504"]
  OK -->|"other error"| E["explain / field: fallback, others: 500"]
```

The browser cancels requests when you press **Cancel** or close the AI panel, and gives up after
130 s.

## Observability

Every AI call writes one JSON log line (`{"evt":"ai", …}`) with the action, release, kind, cache
hit, whether the fix was verified, attempts, model, excerpt or full mode, the reject reason and the
latency. Read them in **Workers & Pages → your project → Logs** to track the fix success rate.

## Measuring fix quality

`src/lib/ai/eval/` holds 61 cases built on the 26.8.2 schemas, each with an independent check of the
returned document:

- 20 hand-written ones (enum, type, required, unknown field, syntax, and a long document sent as an
  excerpt);
- 41 made by breaking the curated docs.eda.dev examples (`fixCasesCurated.ts`): Fabric, BGP peers
  and groups, default routers, routing policy, services, topology, and multi-issue documents where
  only the reported issue may change. A unit test checks that the validator reports exactly each
  case's message and field path.

Run them against any deployment:

```bash
npm run eval:fix -- --base-url https://<preview>.eda-resource-browser.pages.dev --min-pass 0.85
```

The report lists pass/fail per case, latency, cache hits and retries. Use it before changing a
model or a prompt. On GitHub, **Actions → AI Fix eval → Run workflow** runs it against production
or a preview URL and writes the table to the job summary. Uncached cases use Workers AI quota (a
full uncached run is a sizeable share of the free daily allowance).

## Feature flags

| Variable                | Effect                                                         |
| ----------------------- | -------------------------------------------------------------- |
| `PUBLIC_FIX_AI_ENABLED` | `false` disables AI features (UI and endpoint). On by default. |

The **lean** deploy (`npm run deploy:cloudflare:lean`) turns it off and deploys without the AI
and KV bindings.

## Warming the cache

`scripts/warm-cache.ts` calls `/api/ai` for every CRD of a release so the deterministic answers
(and optionally `explain` / `example`) are already in KV:

```bash
npm run warm:cache -- --release 26.8.2
WARM_ACTIONS=explain,example npm run warm:cache:llm -- --release 26.8.2
```

`GET /api/cache-status?release=…&kind=…` shows what is cached for one CRD.
