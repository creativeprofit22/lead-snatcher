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

Post-launch UX polish + reliability. Layer 5 scoring shipped. Sweep is now fast + WSL-safe. Remaining: fix the render-tree bug that breaks Enrich from the results view, a minor visual alignment, and decide fate of foot traffic.

Dev server: `NEXTAUTH_URL` / `AUTH_URL` set to `http://localhost:3002`. Start with:
`NODE_OPTIONS="--max-old-space-size=8192" PORT=3002 npm run dev`

## Last Session (2026-04-19) — persistence, UX fixes, WSL memory fix

- **Session + cross-session persistence** — `src/lib/search-cache.ts` (2h localStorage, enrichment state included) + new `LastSearchSession` DB model (`prisma/schema.prisma`) + `GET/POST/DELETE /api/business/last-search` + `ResumeSearchCard` on home screen.
- **Dead-click fix** — `useEnrichmentStream.enrichLeads` now flips spinner BEFORE filtering, toasts + sets `bannerError` on every failure path (401/429/5xx/network/stream drop). `ErrorBanner` component renders above results with actionable buttons (e.g., "Log in" on 401).
- **WSL OOM fix** — PageSpeed `fields` URL parameter cuts response ~100× (~5MB → ~15KB). Concurrency dropped 3→2. Scrape + PageSpeed pipelines wrapped in try/catch so a blow-up degrades to Maps-only results, never eats the sweep.
- **Search timeout + banner** — 2-min cap (5-min if Deep Analysis on). Timeout / disconnect / non-200 all now show a persistent `searchBannerError` with honest copy.

**Stopped at**: Identified 3 remaining issues (see Next Steps). User chose to tackle one-by-one. Nothing implemented yet on those three.

## Next Steps

1. **Fix Enrich render-tree bug (CRITICAL)** — `<EnrichmentExplainer>` (page.tsx:1306) and `<BatchEnrichBar>` (page.tsx:1286) are rendered AFTER the `if (viewMode === 'results') return …` early return at page.tsx:711. Clicking Enrich from the results view sets `explainerOpen=true` but the modal isn't mounted → nothing happens until user navigates home. Move both to render regardless of viewMode (wrap both branches in a fragment with the floating UI, or refactor to a single return).
2. **Ring alignment on area-score dial** — the rotating outer ring doesn't pass through the centers of the amenity icons on its rim. Pure visual. Check `src/components/search/AreaDensityMeter.tsx`.
3. **Foot traffic — rip it out** (user decision). Remove `FootTrafficSlot` UI + fetch button, remove the peak-busyness bonus in `getEffectiveFitScore` / `computeFitScore`. Keep `Lead.popularTimesData`/`popularTimesScrapedAt` DB fields for possible revival; just delete the UI surface area.
4. **(Nice-to-have)** Include the failing URL in `PageSpeed API error: 400` log line (`src/lib/business/pagespeed.ts`).
