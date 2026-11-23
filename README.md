# Launchpad Marketing Site

> The hackathon platform for builders who ship. Built with Astro 5, Neon, and Tailwind v4.

## Stack

| Layer | Technology |
|-------|------------|
| Framework | Astro 5 (hybrid: static + islands) |
| Database | Neon (serverless Postgres, branching) |
| Styling | Tailwind v4 (CSS-first, `@theme`) |
| Linting | Biome |
| CI/CD | GitHub Actions |
| Deploy | Netlify (preview + production) |
| Visual Regression | Chromatic |
| Performance | Lighthouse CI |

## Security

See [docs/security-gates.md](docs/security-gates.md) for the complete security gate checklist including:
- CSP with per-request nonces
- COOP/COEP cross-origin isolation
- Rate limiting & UA blocking at edge
- Neon branch isolation + prepared statements
- Dependency audit + SBOM + Trivy scanning
- Visual regression + performance budgets + accessibility gates

## Getting Started

### Prerequisites

- Node.js 22.23.4+
- npm 10.8.0+
- Neon account (for DATABASE_URL)

### Installation

```bash
# Clone
git clone https://github.com/obiriandrewm/launchpad-marketing.git
cd launchpad-marketing

# Install dependencies
npm ci

# Set up environment
cp .env.example .env
# Add your DATABASE_URL

# Start dev server
npm run dev
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon connection string (server-only) |
| `NODE_ENV` | No | `development` \| `production` \| `test` |

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server at localhost:4321 |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | Run Biome lint |
| `npm run format` | Run Biome format |
| `npm run check` | Run `astro check` (typecheck) |
| `npm test` | Run Vitest (when tests exist) |

## Project Structure

```
src/
├── components/       # Shared Astro components
├── islands/          # Interactive islands (React/Preact/Vue/Svelte)
├── layouts/          # Page layouts
├── lib/              # Utilities (db, auth, etc.)
├── middleware/       # Security middleware (CSP, rate limit, headers)
├── pages/            # File-based routes
├── styles/           # Global CSS (Tailwind v4 @theme)
├── db/               # Database schema migrations
└── env.d.ts          # TypeScript env declarations
```

## CI/CD Pipeline

`.github/workflows/ci.yml` runs on every PR and push to main:

1. **Lint & Typecheck** — Biome + `astro check`
2. **Unit Tests** — Vitest (≥80% coverage)
3. **Visual Regression** — Chromatic (3 viewports)
4. **Performance Budgets** — Lighthouse CI (LCP ≤2.5s, INP ≤200ms, CLS ≤0.1)
5. **Security Scan** — `npm audit` + SBOM (syft) + Trivy
6. **Deploy Preview** — Netlify preview deploy (PRs)
7. **Deploy Production** — Netlify production (main branch)

## Deployment

### Preview (PRs)

Automatic via GitHub Actions → Netlify Preview. Each PR gets a unique URL with isolated Neon branch.

### Production (main)

Automatic via GitHub Actions → Netlify Production on merge to main.

### Manual Deploy

```bash
npm run build
netlify deploy --dir=dist --prod
```

## Database

### Schema

Run migrations against Neon:

```bash
# Development branch
psql "$DATABASE_URL" -f src/db/schema.sql

# Production (via Neon dashboard or CI)
```

### Branching

Neon creates an isolated branch for each preview deploy automatically via GitHub integration. Branch = copy-on-write, <1s creation, includes production data.

## Security Notes

- **No secrets in repo** — All secrets via GitHub Environments + OIDC
- **CSP nonces** — Generated per-request in middleware
- **Prepared statements** — All DB queries use tagged template literals
- **Rate limiting** — 100 req/min per IP (upgrade to Redis for production)
- **Dependency scanning** — Per-PR audit + weekly Dependabot

## License

MIT — see [LICENSE](LICENSE) for details.
