---
title: Build & deploy
description: Local setup, Node.js version, build commands, deploying to Cloudflare Pages and adding a new EDA release.
section: Developer
order: 4
---

## Requirements

- **Node.js 24.22.1** or newer (pinned in `.node-version`, enforced by `engines` with
  `engine-strict=true`). Cloudflare Pages reads `.node-version` for its builds.
- npm or pnpm. Both lockfiles are kept in sync: `package-lock.json` for npm, `pnpm-lock.yaml` for
  Cloudflare Pages builds.

```bash
nvm install 24.22.1
npm install
npm run dev
```

The dev server listens on all interfaces. For AI features locally, use `npm run dev:ai`, which
builds for Cloudflare and runs `wrangler pages dev` with the AI binding (needs Cloudflare
credentials).

## Build commands

| Command                    | What it does                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm run build`            | Runs `prebuild` generators, then `vite build`                                                        |
| `npm run build:cloudflare` | Cleans dev artifacts, runs the generators, `vite build` with the Cloudflare adapter, then prunes |
| `npm run build:vercel`     | Same app with the Vercel adapter                                                                     |
| `npm run check`            | `svelte-check` type checking                                                                         |
| `npm run lint`             | Prettier + ESLint                                                                                    |

> [!NOTE]
> `npm run build` and `npm run build:cloudflare` (used by every `deploy:cloudflare*` script that
> builds) both run `npm run generate:all` first: sitemap, release notes, OpenAPI manifests and
> schema graphs. The generated files change on every build (dates); commit them with your change.
> `deploy:cloudflare:only` deploys an existing build without regenerating.

## Deploying

```mermaid
flowchart LR
  SRC["Source + committed static data"] --> PB["npm run build: prebuild generators + vite build"]
  PB --> OUT[".svelte-kit/cloudflare"]
  OUT --> PR["prune-cloudflare-output.mjs"]
  PR --> WD["wrangler pages deploy"]
  WD --> CF["Cloudflare Pages project"]
  CF --> LIVE["Production URL"]
```

| Script                   | Use                                                                            |
| ------------------------ | ------------------------------------------------------------------------------ |
| `deploy:cloudflare`      | Build for Cloudflare and deploy                                                |
| `deploy:cloudflare:only` | Prune and deploy an existing build                                             |
| `deploy:cloudflare:lean` | Deploy without AI, KV or Vectorize (swaps in `wrangler.lean.toml` temporarily) |

Wrangler needs a Cloudflare API token in `CLOUDFLARE_API_TOKEN`. Behind a corporate proxy, set
`HTTPS_PROXY` as well. Never commit tokens: local secrets go in `.dev.vars` (git-ignored); see
`.dev.vars.example`.

## Adding an EDA release

```mermaid
flowchart TB
  A["Install the release on a cluster"] --> B["static/sync-release.sh {release}"]
  B --> C["RELEASE={release} npm run sync:openapi"]
  C --> D["Set default: true in releases.yaml if it is the newest"]
  D --> E["npm run build"]
  E --> F["Check the site locally"]
  F --> G["Commit static data and generated files"]
  G --> H["Deploy"]
  H --> I["Optional: npm run warm:cache -- --release {release}"]
```

See [Data pipeline](data-pipeline.md) for what each step produces.

## Dependency hygiene

- Run `npm audit` and `pnpm audit` after dependency changes; keep both lockfiles updated
  (`pnpm install --lockfile-only`).
- pnpm enforces a minimum release age for new packages. Pin a version that is at least a day old
  rather than adding an exclusion.
- Follow Node.js security releases and update `.node-version` and `engines` together.
