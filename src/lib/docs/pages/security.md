---
title: Security
description: The security measures built into the site — headers, input limits, the API proxy allowlist and protected endpoints.
section: Developer
order: 5
---

The site is public and has no user accounts, so its security work focuses on safe defaults, limits
on anything that costs money (AI calls, KV reads), and not becoming a relay for attacks.

## Response headers

Set on every response — by `src/hooks.server.ts` for Worker responses and by `_headers` for static
assets (Cloudflare Pages doesn't apply `_headers` to Worker responses):

| Header                                             | Value / purpose                                           |
| -------------------------------------------------- | --------------------------------------------------------- |
| `Strict-Transport-Security`                        | HTTPS only, one year, including subdomains                |
| `X-Content-Type-Options`                           | `nosniff`                                                 |
| `X-Frame-Options` and CSP `frame-ancestors 'self'` | Other sites can't embed the site in a frame               |
| CSP `base-uri 'self'; object-src 'none'`           | Blocks `<base>` hijacking and plugins                     |
| `Referrer-Policy`                                  | `strict-origin-when-cross-origin`                         |
| `Permissions-Policy`                               | Camera, microphone, geolocation, payment and USB disabled |
| `Cross-Origin-Opener-Policy`                       | `same-origin`                                             |

## Protections per endpoint

```mermaid
flowchart TB
  subgraph AI["POST /api/ai"]
    A0["Same-origin browser requests only"] --> A1["Body at most 1 MB"]
    A1 --> A2["YAML at most 512 KiB, field at most 1,024 chars, at most 100 issues"]
    A2 --> A3["Action allowlist, validate and compare disabled"]
    A3 --> A4["Release names resolved from a fixed list, path segments validated"]
    A4 --> A5["Fixes verified before they are returned or cached"]
  end
  subgraph CS["GET /api/cache-status"]
    C1["Per-CRD lookups: a few KV reads"] --> C2["Full summary requires a bearer token"]
  end
```

- **AI cost control.** Size limits stop a single request from sending a huge prompt, LLM actions
  without a UI are disabled, and other sites' pages can't call the endpoint. Scripts can still call
  it directly, so add a Cloudflare rate-limiting rule (below).
- **Shared cache integrity.** AI fixes are cached under a hash of the full prompt and only after
  server-side verification, so one client can't plant a bad fix that others receive.
- **No outbound proxy.** The site has no endpoint that forwards requests to other hosts, so it
  can't be used to reach internal addresses (an earlier unused proxy route was removed).
- **Cache summary.** `?summary=true` scans every CRD of a release (hundreds of KV reads). It is
  disabled unless the `CACHE_STATUS_TOKEN` secret is set, and then requires
  `Authorization: Bearer …`.

## Rate limiting `/api/ai`

Rate limiting is configured at the Cloudflare edge, not in code. In the dashboard: **your domain or
the Pages project → Security → WAF → Rate limiting rules → Create rule**:

| Setting                       | Value                                                                   |
| ----------------------------- | ----------------------------------------------------------------------- |
| If incoming requests match    | URI Path equals `/api/ai` **and** Request Method equals `POST`          |
| With the same characteristics | IP                                                                      |
| When rate exceeds             | 20 requests per 1 minute                                                |
| Then                          | Block for 1 minute (returns 429; the page shows "Too many AI requests") |

A bulk AI Fix on a large bundle makes a request per remaining issue, so keep the limit above ~15 per
minute for real users. Rate limiting rules apply to custom domains on a Cloudflare zone; a
`*.pages.dev` hostname alone can't have WAF rules.

## Rendering untrusted text

- Search highlighting and the markdown renderer for AI text escape HTML before adding their own
  markup.
- That renderer only turns `http(s)` URLs and site-relative paths into links; protocol-relative
  `//host` links are not treated as internal.
- Regex search is bounded (pattern length, scanned text, iterations) to avoid slow patterns.
- Mermaid diagrams in these docs render with `securityLevel: 'strict'`.

## Secrets

- Tokens are passed through environment variables (`CLOUDFLARE_API_TOKEN`) or Cloudflare secrets,
  never committed. `.env*` and `.dev.vars` are git-ignored.
- Rotate any token that was ever pasted into a chat, ticket or log.

## Dependencies and runtime

- Node.js is pinned to a release that includes the latest security fixes (see
  [Build & deploy](build-deploy.md)).
- `npm audit` and `pnpm audit` should report no vulnerabilities before a deploy.
