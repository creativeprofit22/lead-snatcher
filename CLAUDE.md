# Lead Snatcher

> Database setup is SQLite-only; PostgreSQL and Docker database tooling are not supported.

Invite-only local-business prospecting and lightweight CRM web app. Users search by industry and location, score and enrich prospects, save search sessions, and manage leads, tasks, tags, and contact history.

## Stack

- Next.js 16 App Router, React 19, and TypeScript; npm package with Node `^22.12.0` (`.nvmrc`: `22.12.0`).
- Tailwind CSS 4 and feature-oriented React components.
- NextAuth credentials authentication with invite/password setup.
- Prisma 7 with `better-sqlite3`; the active datasource is SQLite.
- Prisma generates its client into `src/generated/prisma/`.

## Repository Layout

```text
src/app/                  Next.js App Router pages and HTTP route handlers
src/components/           Feature components and shared UI primitives
src/lib/business/         Discovery, scoring, enrichment, geocoding, and zone logic
src/lib/                  Auth, Prisma, caching, encryption, validation, and rate limits
src/types/                Shared TypeScript types
prisma/schema.prisma      Canonical SQLite schema
prisma/migrations/        Only migration_lock.toml; no migration history is committed
prisma/seed.ts            Admin-user database seed
scripts/                  Setup and user-provisioning utilities
data/                     Local SQLite database storage
```

## Architecture

- `src/app/api/` is the HTTP boundary; reusable discovery and scoring logic belongs in `src/lib/business/`.
- Business search combines RapidAPI Maps results, direct website scraping, optional PageSpeed analysis, Nominatim geocoding, and Overpass zone analysis.
- Search, session, and CRM records are user-scoped; URL-analysis and business-enrichment caches are shared.
- User-managed external API keys are encrypted before persistence.
- Prisma generates `src/generated/prisma/` from `prisma/schema.prisma`; regenerate the client after schema changes.
- `next.config.ts` produces standalone output. SQLite deployments require persistent writable storage, and native `better-sqlite3` and `bcrypt` binaries must match the runtime platform.

## Commands

These commands match the scripts in `package.json`:

```bash
npm run dev             # Next dev with Turbopack; filters output through grep
npm run build           # Generate Prisma client, then build Next.js
npm run start           # Serve the production build
npm run test            # Run Vitest once
npm run lint
npm run lint:fix
npm run format
npm run format:check
npm run typecheck
npm run db:generate
npm run db:migrate      # Run prisma migrate dev
npm run db:push
npm run db:studio
npm run db:seed         # Seed through tsx
npm run setup           # Run scripts/setup.sh
npm run setup:user      # Create or update a user interactively
```

## Runtime Notes

- `npm run setup` and `npm run dev` rely on Bash/GNU tooling; on Windows, run them in Git Bash or WSL.
- First-time setup creates `.env`, generates secrets, configures `data/lead-snatcher.db`, generates Prisma, applies the schema, and creates an admin user.
