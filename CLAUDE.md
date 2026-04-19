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

Search reliability + perf. Overpass + PageSpeed have been the two biggest pain points; both are now hardened, cached, and tiered. User PC restart pending — needs to test the full search loop on bare metal (WSL was OOMing during compile).

## Last Session (2026-04-18) — performance + resilience pass
Two commits landed: `1ca1650` (Overpass + PageSpeed wiring), `d1bbb2e` (perf wins).

**Overpass / zone scanning** (`src/lib/business/zone-grid.ts`):
- Mirror list re-ordered: OSM-FR + OSM-CH first (the `.de` mirrors and kumi were globally 504/timeout). All 5 stay in the pool.
- `Promise.any` race now cancels losing siblings on first win (prevents 20s hang waiting for kumi after .de 504s in 200ms).
- New singleflight via `inFlight` Map keyed by `country|city` — neighborhoods autocomplete + search button no longer double-fire Overpass.
- `200 + 0 elements` now counts as failure for the race (osm.ch silently truncates dense bboxes).
- Server-side `[timeout:N]` 7s → 20s, client cap 8s → 12s — was too tight for greater London.
- On total failure, `synthesizeEmptyZone` returns inline instead of recursing into `buildSingleZone` (which would have made another Overpass call → 40s).
- Empty results cached for 60s only (not 7d) so transient Overpass outages auto-recover.

**PageSpeed wiring** (multi-key Settings UI + flow):
- `apiKeyServiceSchema` + settings route accept new `'pagespeed'` service.
- `src/lib/business/pagespeed-key.ts`: mirrors `getRapidApiKey` (cache → DB → `PAGESPEED_API_KEY` env).
- Search route fetches the key only when `deepAnalysis` is on, passes via `pageSpeedApiKey` option.
- `pagespeed.ts` throws tagged `PageSpeedRateLimited` on 429; batch loop short-circuits after first 429 (no more 50-URL grind on dead quota).
- `SettingsModal.tsx` rewritten as registry-driven (`SERVICES` array) — adding future keys is one entry.

**Search performance** (`d1bbb2e`):
- Lighthouse JSON parse scoped to a tight block in `pagespeed.ts` so the 1–5MB tree dies before return → ~80% peak heap reduction during 50-site batches.
- Scraper concurrency 15 → 8 (eased WSL socket pressure that was contributing to OOMs).
- **PageSpeed tiering**: scrape all sites first, score every business with scraping data only, then run PageSpeed on **top-20 by preliminary score**. Cuts the slow path from ~3min to ~30s.
- New `UrlAnalysisCache` SQLite table + `src/lib/business/url-cache.ts` helper. Persistent 7d cache keyed by canonicalized URL for both `'pagespeed'` and `'scrape'` services. Repeat searches of the same city drop from ~30s to ~5s on the analysis pass.
- Frontend `handleSearch` timeout 60s → 5min, with amber UI hint shown when slow toggles are on.

**Frontend bug fix** (`src/components/search/NeighborhoodChips.tsx`):
- `lastFetchedRef` cache key now only set on **non-empty** success — empty results no longer permanently lock out a city's autocomplete.

**Stopped at**: User's WSL dev server died mid-compile (silent OOM, no logs). Recommended fix is `NODE_OPTIONS="--max-old-space-size=8192" PORT=3001 npm run dev` (or drop `--turbopack`). User opted to restart PC and resume in fresh session.

## Next Steps (resume here)
1. Start dev server with bumped heap: `cd /mnt/e/Projects/aloo && NODE_OPTIONS="--max-old-space-size=8192" PORT=3001 npm run dev`
2. Test London search **twice** — first run validates #5 (top-20 tiering, target ~30s), second validates #2 (URL cache, target ~5s). Settings → ensure RapidAPI key is set; PageSpeed key optional but recommended (https://console.cloud.google.com/apis/credentials → API key → restrict to PageSpeed Insights API).
3. If perf is still rough, the deferred #4 (streaming results) is queued — needs UX rework of `RadarScan` to handle progressive reveal. Skip if 30s/5s feels acceptable.
4. Pre-existing issues unrelated to this session: `useSearchParams()` Suspense boundary in `page.tsx` (blocks prod build, not dev); old visual-overhaul beats from 2026-04-16 still need user eyeball.
