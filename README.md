# EDA Resource Browser - Visual Architecture

## System Overview

Resource Browser is a compact SvelteKit application that reads CRD manifests stored in the repo (under `static/resources/<release>/...`) and exposes:

- A release-aware resource browser and search index
- Per-resource pages showing YAML and OpenAPI-style schema details
- Lightweight version comparison and diff views

The app is built with SvelteKit + Vite and can be deployed as a static site (for example, Cloudflare Pages).

<!-- prettier-ignore -->
# 🚀 EDA Resource Browser

A compact, fast web UI for exploring Nokia EDA Custom Resource Definitions (CRDs) and release manifests.

Clean, focused features:

- 🔎 Search and browse CRDs by release
- 📄 View YAML and OpenAPI-style schemas for each resource
- 🔁 Compare versions across releases and inspect diffs

Quick start

1. Install dependencies:

```bash
pnpm install
```

2. Run the development server (hot-reload):

```bash
pnpm run dev
```

Workers AI (Ask tab on CRD resources) needs the Cloudflare adapter and a remote AI binding:

```bash
npm run build:cloudflare
export CLOUDFLARE_API_TOKEN=your_token   # or: npx wrangler login
npm run dev:ai
```

`wrangler.toml` defines the `AI` binding for production Pages deploys. For local dev, Wrangler calls Workers AI in your account; the API token must include **Workers AI** (and typically **Account** read) permissions. `CLOUDFLARE_API_TOKEN` is read from the environment (see `.env.example` / `.dev.vars.example`); do not commit tokens.

Corporate networks: if direct HTTPS to `api.cloudflare.com` fails, keep `HTTP_PROXY` / `HTTPS_PROXY` set when running Wrangler (do not unset them). Remote Workers AI in local dev calls `workers-binding.ai`; if `wrangler whoami` works but `/api/ask` hangs, the proxy or firewall may be blocking that host—try another network or ask IT to allow Cloudflare AI endpoints.

### Vectorize RAG (CRD corpus + EDA docs)

The Ask tab retrieves CRD schema excerpts and Nokia EDA official documentation from Cloudflare Vectorize before calling Workers AI. **Rich server-built context works without Vectorize**; `/api/ask` skips RAG when bindings are absent.

We use **two separate indexes** (same 768-dim `@cf/baai/bge-base-en-v1.5` embeddings, cosine metric):

| Index | Binding | Content |
|-------|---------|---------|
| `eda-crd-corpus-v1` | `CRD_INDEX` | CRD OpenAPI schema chunks from `static/resources/` |
| `eda-docs-v1` | `DOCS_INDEX` | Crawled pages from [docs.eda.dev/26.4/](https://docs.eda.dev/26.4/) |

**Deploy without Vectorize:** comment out the `[[vectorize]]` blocks in `wrangler.toml` so Pages deploy is not blocked while indexes or token permissions are missing.

**API token permissions:** creating indexes and upserting vectors requires a token with **Vectorize Edit** (Wrangler/API error `10000` means the token lacks it). Workers AI and Account read are separate requirements for Ask and embed.

**One-time index setup**—dashboard: Workers & Pages → Vectorize, or CLI:

```bash
wrangler vectorize create eda-crd-corpus-v1 --dimensions=768 --metric=cosine \
  --metadata-index=release --metadata-index=kind --metadata-index=group --metadata-index=chunkType

wrangler vectorize create eda-docs-v1 --dimensions=768 --metric=cosine \
  --metadata-index=source --metadata-index=release --metadata-index=section
```

**Enable RAG on Pages:** ensure both `[[vectorize]]` blocks in `wrangler.toml` are active (`CRD_INDEX`, `DOCS_INDEX`), redeploy, then embed.

**Embed CRD corpus** (`CLOUDFLARE_API_TOKEN` with Workers AI + **Vectorize Edit**; set `CLOUDFLARE_ACCOUNT_ID` if not using `wrangler login`). On corporate networks set `HTTP_PROXY` / `HTTPS_PROXY` (embed scripts use undici `ProxyAgent`):

```bash
export CLOUDFLARE_API_TOKEN=your_token
export CLOUDFLARE_ACCOUNT_ID=your_account_id   # optional if wrangler whoami works
npm run embed:crd-corpus
# Single release: npm run embed:crd-corpus -- --release 26.4.2
# Count chunks only: npm run embed:crd-corpus -- --dry-run
```

**Embed EDA documentation** (crawls `docs.eda.dev` under `/26.4/`, rate-limited, respectful user-agent):

```bash
export CLOUDFLARE_API_TOKEN=your_token
npm run embed:eda-docs
# Docs release: npm run embed:eda-docs -- --release 26.4
# Preview crawl: npm run embed:eda-docs -- --dry-run --max-pages 20
```

**Workers AI neuron limits:** Free and paid Workers plans include a **daily neuron budget** for Workers AI (embeddings and LLM calls share it). Large embed jobs may stop partway with HTTP **429** or an API error mentioning neurons. `/api/ask` then returns **503** with a quota message instead of a generic 500. After the quota resets (next UTC day), resume indexing:

```bash
npm run embed:crd-corpus   # safe to re-run; upserts by chunk id
npm run embed:eda-docs
```

Upgrade your Cloudflare Workers plan or purchase additional Workers AI capacity if you need higher daily limits.

**Vector index completion** (check with `wrangler vectorize info <index>`):

| Index | Target vectors | Status (2026-06-08) |
|-------|----------------|---------------------|
| `eda-crd-corpus-v1` | 9,249 (`npm run embed:crd-corpus -- --dry-run`) | Partial — re-run embed to resume |
| `eda-docs-v1` | ~551 (`npm run embed:eda-docs -- --dry-run`) | Empty until `npm run embed:eda-docs` completes |

Resume after neuron quota reset:

```bash
export CLOUDFLARE_API_TOKEN=your_token
export HTTP_PROXY=http://your-proxy:8080 HTTPS_PROXY=http://your-proxy:8080   # if needed
npm run embed:crd-corpus   # upserts by chunk id; safe to re-run
npm run embed:eda-docs
wrangler vectorize info eda-crd-corpus-v1
wrangler vectorize info eda-docs-v1
```

### Neuron budget estimates

Cloudflare bills Workers AI in **neurons** (10,000/day free on Workers Free and Paid). Rates from [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/):

| Model | Neurons |
|-------|---------|
| `@cf/baai/bge-base-en-v1.5` (embed) | 6,058 per M input tokens |
| `@cf/meta/llama-3.1-8b-instruct` (Ask LLM) | 25,608 per M input tokens · 75,147 per M output tokens |

**Per `/api/ask` request** (1 embed + 1 LLM call; Vectorize query is free):

| Path | Typical neurons |
|------|-----------------|
| RAG-sufficient slim context (~6.5K chars after retrieval) | **~75–95** |
| Trimmed fallback (~10K chars, index empty/weak) | **~100–130** |
| Legacy full rich context (~20K chars, pre-RAG optimization) | **~165–190** |
| Worst case (24K context + 1536 output tokens) | **~290** |

**One-time index build** (dominates daily quota):

| Activity | Chunks | Neurons each (est.) | Total (est.) |
|----------|--------|---------------------|--------------|
| `embed:crd-corpus` (full) | 9,249 | ~2.3 (256–512 tok/chunk) | **~21,500** |
| `embed:crd-corpus` (partial, ~53%) | ~4,870 | ~2.3 | **~11,300** |
| `embed:eda-docs` | ~551 | ~2.3 | **~1,300** |

Re-running an embed script **re-embeds every chunk from the start** (upserts are idempotent, but Workers AI calls are not free). Two partial CRD runs in one day can consume ~23k neurons — far more than Ask testing.

### Neuron optimization (`/api/ask`)

Ask uses **one** Workers AI LLM call per question (embedding for Vectorize is separate). To stay within daily neuron budgets:

- **RAG-first slim context:** When Vectorize returns sufficient chunks (≥3 matches, or top score ≥0.65), the LLM prompt includes retrieved excerpts plus metadata only (`release` / `kind` / `apiVersion`) — not the full CRD OpenAPI JSON (~12K chars saved per request).
- **Trimmed fallback:** When the index is empty or returns too few chunks, a capped (~4K) schema summary is built from the manifest instead of the full 24K rich context.
- **Cheaper retrieval:** Default Vectorize `topK` is 4; embedding input is the user question only (not question + full context).

Re-run embed scripts after adding CRD releases or when Nokia publishes updated docs. These are manual pre-deploy steps (not wired into `prebuild`).

**Test `/api/ask` locally:**

```bash
npm run build:cloudflare
export CLOUDFLARE_API_TOKEN=your_token
npm run dev:ai
# POST http://localhost:8788/api/ask
curl -s -X POST http://localhost:8788/api/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"What spec fields are required?","release":"26.4.2","kind":"Fabric","group":"fabrics.eda.nokia.com","version":"v1"}'
```

**On production** (`https://eda-resource-browser.pages.dev`): open any CRD → Ask tab, or POST `/api/ask` with the same JSON body. Responses include `sources` when Vectorize RAG matched chunks.

3. Build for production:

```bash
pnpm run prepare
pnpm run build
```

Preview the production build locally:

```bash
pnpm run preview
```

Notes and tips

- Demo data: sample CRD manifests are placed under `static/resources/<release>/...` — the app reads these for the release browser.
- CI tip: if `pnpm install` in CI errors with a frozen-lockfile mismatch, regenerate the lockfile locally with:

```bash
pnpm install --no-frozen-lockfile
git add pnpm-lock.yaml
git commit -m "chore: update pnpm-lock.yaml"
```

Developer notes

- Built with SvelteKit + Vite and styled with TailwindCSS. Routes expose a home listing and per-resource detail pages.
- Keep changes small and UI-focused. If you add a new release, drop its manifest under `static/resources/<release>/manifest.json`.

Contributing

- Open issues and PRs welcome. Please include a short description and screenshots where helpful.

### Performance notes

We changed the hero/background handling to improve LCP:

- The primary hero is now an inline <img> (via a <picture> element) inserted early in the layout for accurate LCP measurement and preloading control. The CSS now uses gradients only; the image sits behind the page content.
- Fonts: we prefer WOFF2 for smaller payloads and preloaded critical hero fonts. If you need to generate WOFF2 assets from the existing TTF fonts in `/static/fonts`, run:

````bash
pnpm install -D ttf2woff2
pnpm run generate:woff2

Note: `ttf2woff2` reads from stdin and writes a compressed WOFF2 to stdout. The `generate:woff2` script wraps this in a loop and pipes each TTF into the converter. If you prefer a one-off command, you can run:

```bash
npx ttf2woff2 < static/fonts/NokiaPureText_Rg.ttf > static/fonts/NokiaPureText_Rg.woff2
````

Or to convert all TTFs at once using a shell loop (same as the script):

```bash
for f in static/fonts/*.ttf; do npx ttf2woff2 < "$f" > "${f%.ttf}.woff2"; done
```

```

That converts TTF files in `static/fonts` to WOFF2. After that, update the `app.html` preloads if you change filenames.



```
