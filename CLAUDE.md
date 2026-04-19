# Lead Snatcher

A Next.js lead generation platform for finding local businesses that need digital services. Search by industry type and city, score leads based on their digital presence, and manage them in a lightweight CRM.

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/                # API routes
│   │   ├── business/       # Business search & geocode
│   │   ├── leads/          # Lead CRUD & contact logs
│   │   └── settings/       # API key management
│   ├── layout.tsx          # Root layout
│   └── page.tsx            # Home page (search, results, CRM)
├── components/             # React components
│   ├── search/             # Search UI
│   │   ├── BusinessTypeSelector.tsx
│   │   ├── CityInput.tsx
│   │   └── WelcomeHeader.tsx
│   ├── leads/              # Lead management
│   │   ├── LeadScoreBadge.tsx
│   │   ├── LeadStatusBadge.tsx
│   │   ├── StatusSelector.tsx
│   │   └── OpportunitiesList.tsx
│   ├── dashboard/          # Pipeline stats
│   ├── settings/           # Settings modal
│   └── ui/                 # Generic UI components
├── lib/                    # Utilities and API clients
│   ├── business/           # Business logic
│   │   ├── geocode.ts      # City geocoding (Nominatim)
│   │   ├── scoring.ts      # Lead score calculation
│   │   ├── opportunities.ts # Industry opportunities
│   │   └── search.ts       # RapidAPI Maps search
│   ├── rapidapi/           # RapidAPI client
│   ├── constants.ts        # Industry types, statuses
│   ├── db.ts               # Prisma client
│   └── errors.ts           # Error handling
└── types/                  # TypeScript definitions

prisma/
└── schema.prisma           # Database schema (Lead, BusinessSearch, ContactLog)
```

## Key Features

- **Business Search**: Search by industry type + city via RapidAPI Maps
- **Lead Scoring**: Score 0-100 based on missing website (+30), phone (+25), email (+20), high rating (+10), low reviews (+10)
- **Opportunities**: Industry-specific service recommendations
- **CRM**: Status tracking (new → contacted → called → proposal_sent → negotiating → won/lost)
- **Contact Logs**: Track calls, emails, meetings, notes

## Organization Rules

**Keep code organized and modularized:**
- API routes → `src/app/api/`, one folder per resource
- Components → `src/components/`, grouped by feature
- Business logic → `src/lib/business/`
- Types → `src/types/`

**Modularity principles:**
- Single responsibility per file
- Clear, descriptive file names
- Group related functionality together
- Use barrel exports (index.ts) for clean imports

## Code Quality - Zero Tolerance

After editing ANY file, run:

```bash
npm run lint && npm run typecheck
```

Fix ALL errors/warnings before continuing.

### Additional Commands

```bash
npm run format        # Format code with Prettier
npm run format:check  # Check formatting
npm run db:generate   # Generate Prisma client after schema changes
npm run db:migrate    # Run database migrations
```

### Server Restart

If changes require server restart (not hot-reloadable):
1. Restart server: `npm run dev`
2. Read server output/logs
3. Fix ALL warnings/errors before continuing

## Current Focus

Website-quality scoring (deterministic, no LLM) — adding a Layer 5 to the lead score that uses signals we already collect but don't score. Sweep cost stays at 1 RapidAPI call; PageSpeed payload stays at 20 URLs/search. Goal: make "shit website" a concrete, defensible sales pitch ("no mobile viewport, 87 words, Wix free template, accessibility 42").

Dev server: `NEXTAUTH_URL` / `AUTH_URL` now set to `http://localhost:3002`. Start with:
`NODE_OPTIONS="--max-old-space-size=8192" PORT=3002 npm run dev`

## Last Session (2026-04-19) — enrichment redesign + auth port fix

**Auth fix**: `.env` updated — `NEXTAUTH_URL` was `:3000`, now `:3002` (and added v5-style `AUTH_SECRET` + `AUTH_URL` aliases). Fixes the "Unexpected token '<'" client error on `/api/auth/session`.

**Enrichment redesign (11 tasks, all complete)** — decoupled enrichment from the sweep. RapidAPI usage dropped from ~100 calls/sweep → 1 (sweep) + ~2 per lead the user chooses to enrich. First paint ~90s → ~30s.

- **Schema**: `BusinessEnrichmentCache` (keyed by `businessId`, 7d TTL) — `prisma/schema.prisma`.
- **Helpers**: `src/lib/business/enrichment-cache.ts`, `src/lib/business/enrichment-preview.ts` (drives all user-facing copy).
- **Endpoint**: `POST /api/business/enrich` — NDJSON stream, concurrency-capped at 5, cache-first, per-row rate limiting via new `RATE_LIMITS.enrich` bucket.
- **Sweep**: `src/lib/business/search.ts` — deleted both enrichment passes; `enableEnrichment` option + UI toggle removed from `validations.ts`, `search/route.ts`, `page.tsx`.
- **UI**: `EnrichButton` (per-card, dynamic tooltip from `previewEnrichment`), `BatchEnrichBar` (floating, live call-count minus cache hits), `EnrichmentExplainer` (first-time modal, `localStorage`-gated), `useEnrichmentStream` hook (NDJSON reader + status/result maps).
- **Card wiring** (`src/app/page.tsx`): checkbox per card, enrich button in chips row, 3s success chip (`+ website, + Instagram`) or honest `No public contact data found`, `enrichedResults` merges live website + socials into filter/sort pipeline.
- **Scoring preserved**: `calculateLeadScore`, `estimateBudget`, `computeFitScore`, `generateOpportunities` all untouched — leads without Maps websites now score higher (correctly — "+45 pts no website").

**Stopped at**: User approved the Layer 5 website-quality scoring spec (deterministic, zero extra API calls). Ready to implement.

## Next Steps (resume here)

1. **Extend scraper** (`src/lib/business/scraper.ts`) to detect: missing `<meta viewport>`, table-based layout, word count <150, no `<form>`, no schema.org JSON-LD, no Open Graph, deprecated tags (`<marquee>`, `<center>`, `<font>`, inline `bgcolor`), fixed pixel widths, missing `<html lang>`, jQuery <2, template fingerprints (`wix.com`, `godaddysites.com`, `weebly.com`, `business.site`, `jimdo.com`).
2. **Expand PageSpeed** (`src/lib/business/pagespeed.ts`) — currently requests `category=performance` only. Change to request all four categories and surface Accessibility, SEO, Best Practices scores + LCP + CLS in `WebsiteAnalysis`. Single API call still.
3. **Add Layer 5 to `calculateLeadScore`** (`src/lib/business/scoring.ts`) with point table:
   - No viewport +10, table layout +8, word count <150 +6, deprecated tags +6, template fingerprint +7, no form +5, fixed px width +4, jQuery <2 +4, no schema +4, no OG +3, no lang +2
   - PageSpeed: accessibility <70 +6, SEO <70 +6, best-practices <80 +4, LCP >4s +5, CLS >0.25 +3
4. **Surface top 2-3 triggered quality signals** on each card as chips ("No mobile viewport", "Wix template", "Accessibility 42"). Same style as existing lead-chip.
5. **Test**: London sweep, verify a Wix / GoDaddy site ranks higher and shows the concrete chips.
6. **Pre-existing issue**: `useSearchParams()` Suspense boundary in `page.tsx` blocks prod build (dev works fine).
