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
