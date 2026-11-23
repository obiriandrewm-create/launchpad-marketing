# Security Gates — Launchpad Marketing Site

This document defines the security controls, configurations, and verification steps for the `launchpad-marketing` repository (Astro 5 + Neon + Tailwind v4).

---

## 1. Transport Security

| Control | Implementation | Verification |
|---------|----------------|--------------|
| TLS 1.3 | Enforced by Neon (database) and Netlify/Vercel (edge) | `nmap --script ssl-enum-ciphers` |
| HSTS Preload | `max-age=31536000; includeSubDomains; preload` via middleware | `curl -I https://domain` → `Strict-Transport-Security` header |
| Certificate Transparency | Netlify/Vercel managed | `crt.sh` monitoring |

---

## 2. Content Security Policy (CSP)

**Policy:** Strict, nonce-based for Astro islands; no `unsafe-inline` for scripts, no `unsafe-eval`.

```
default-src 'self';
script-src 'self' 'nonce-{RUNTIME}' 'strict-dynamic';
style-src 'self' 'unsafe-inline';  /* Tailwind JIT requires this */
img-src 'self' data: https:;
font-src 'self' data:;
connect-src 'self' https://*.neon.tech wss://*.neon.tech;
frame-src 'self' https://www.youtube.com https://player.vimeo.com;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none';
```

**Implementation:** `src/middleware/security.ts` generates per-request nonce via `crypto.randomBytes(16)`.

**Verification:** `curl -I https://domain` → `Content-Security-Policy` header; CSP report-only endpoint (TODO: add Sentry/Datadog sink).

---

## 3. Cross-Origin Isolation

| Header | Value | Scope |
|--------|-------|-------|
| `Cross-Origin-Opener-Policy` | `same-origin` | All routes |
| `Cross-Origin-Embedder-Policy` | `credentialless` | Marketing routes (`/`, `/blog/*`, `/features/*`) |
| `Cross-Origin-Embedder-Policy` | `require-corp` | Auth/island routes |
| `Cross-Origin-Resource-Policy` | `same-origin` | All routes |

**Rationale:** `credentialless` allows YouTube/Vimeo embeds on marketing pages without CORP headers; `require-corp` enforces isolation for authenticated/island routes.

---

## 4. Edge Middleware Security

**File:** `src/middleware/security.ts`

### Controls Implemented

1. **Rate Limiting**: 100 req/min per IP (in-memory, upgrade to Redis/KV for production)
2. **UA Blocking**: Blocks known scanner/bot signatures (sqlmap, nikto, nessus, etc.)
3. **CSP Nonce Generation**: Per-request `crypto.randomBytes(16)`
4. **Security Headers**: All headers from sections 1-3 applied to every response
5. **Server Header Removal**: `Server` and `X-Powered-By` stripped

### Limitations

- Astro middleware runs in **Node.js**, not V8 isolates (unlike Cloudflare Workers)
- In-memory rate limit does not scale across instances
- No WAF rules (consider Cloudflare WAF or Netlify Edge Functions for production)

---

## 5. Database Security (Neon)

| Control | Implementation |
|---------|----------------|
| Branch Isolation | Each preview deploy = isolated Neon branch (copy-on-write, <1s) |
| Prepared Statements | All queries via tagged template literals (`sql\`...\``) — injection impossible |
| `service_role` Key | **Never** in client; server-only via `src/lib/db.ts` |
| Connection Pooling | Neon serverless driver handles pooling |
| TLS | Neon enforces TLS 1.3 for all connections |
| RLS | Row Level Security policies on all tables (schema migration required) |

### Environment Variables

| Variable | Scope | Description |
|----------|-------|-------------|
| `DATABASE_URL` | Production | Neon production branch connection string |
| `DATABASE_URL_PREVIEW` | Preview | Auto-injected by Neon GitHub integration per PR |

**GitHub Environments:** Separate `production` and `preview` environments with OIDC to Neon — no long-lived secrets in repo.

---

## 6. Secrets Management

| Secret | Storage | Rotation |
|--------|---------|----------|
| `DATABASE_URL` | GitHub Environments + OIDC to Neon | Automatic via Neon |
| `NETLIFY_AUTH_TOKEN` | GitHub Environments | Manual (90-day) |
| `NETLIFY_SITE_ID` | GitHub Environments | Static |
| `CHROMATIC_PROJECT_TOKEN` | GitHub Environments | Manual (90-day) |
| `LHCI_GITHUB_APP_TOKEN` | GitHub Environments | Manual (90-day) |

**No secrets in repo.** `astro:env` schema validates required vars at build time.

---

## 7. Dependency Hygiene

| Tool | Frequency | Action |
|------|-----------|--------|
| `npm audit --audit-level=high` | Per PR (CI) | Block on high/critical |
| `dependabot.yml` | Weekly | Auto-PR for updates |
| `npm audit signatures` | Per PR (CI) | Verify supply chain integrity |
| `syft` SBOM | Per PR (CI) | Generate CycloneDX SBOM |
| `trivy` fs scan | Per PR (CI) | Scan for vulnerabilities in dependencies |

**Lockfile:** `package-lock.json` committed (npm@10.8.0 pinned via `engines.node`).

---

## 8. Runtime Hardening

| Control | Status |
|---------|--------|
| Node 22 LTS | ✅ `engines.node >=22.23.4` |
| `--experimental-permission` | ⏳ TODO: Add to `package.json` scripts |
| No `child_process` in prod | ✅ Verified by `trivy` + manual review |
| No `eval`/`Function` constructor | ✅ Biome `noDangerousFunction` rule |

---

## 9. CI/CD Security Gates

**Pipeline:** `.github/workflows/ci.yml`

| Gate | Tool | Threshold | Fail Action |
|------|------|-----------|-------------|
| Lint | Biome | 0 errors, 0 warnings | Block PR |
| Typecheck | `astro check` | Clean | Block PR |
| Unit Tests | Vitest | ≥80% coverage | Block PR |
| Visual Regression | Chromatic | 0 pixel diffs (static), ±2% (islands) | Block PR |
| Performance | Lighthouse CI | LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 | Warn PR |
| Security Audit | `npm audit` | 0 critical, 0 high (unreviewed) | Block PR |
| Supply Chain Integrity | `npm audit signatures` | All packages verified | Block PR |
| Secret Scan | Gitleaks | 0 findings | Block PR |
| SBOM | `syft` | Generated per PR | Artifact |
| Trivy Scan | Trivy | 0 critical, 0 high | Block PR |
| Accessibility | axe-core (in Chromatic) | 0 violations (WCAG 2.1 AA) | Block PR |

---

## 10. Gaps & TODO

| Gap | Priority | Owner | Target |
|-----|----------|-------|--------|
| CSP report endpoint (Sentry/Datadog) | High | @zeus | Week 1 |
| Redis/KV rate limiting | Medium | @zeus | Week 2 |
| RLS policies migration | High | @zeus + @ares | Week 1 |
| `--experimental-permission` flags | Medium | @zeus | Week 2 |
| WAF rules (Cloudflare/Netlify) | Low | @zeus | Month 1 |
| Penetration test (staging) | High | @zeus | Pre-launch |

---

## 11. Incident Response

1. **CSP Violation Spike** → Check Sentry/Datadog CSP reports → Identify injected script → Rotate nonce logic if needed
2. **Rate Limit Bypass** → Check middleware logs → Add UA/IP to blocklist → Deploy hotfix
3. **Neon Branch Leak** → Revoke preview `DATABASE_URL` via Neon dashboard → Audit GitHub Environment secrets
4. **Dependency Compromise** → `npm audit` + `trivy` catch in CI → Block deploy → Investigate `node_modules` diff

---

*Last updated: 2025-11-23 | Owner: @zeus | Review: @hermes, @heimdall*