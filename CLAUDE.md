# Lead Snatcher

> Database setup is SQLite-only; PostgreSQL and Docker database tooling are not supported.

A Next.js lead generation platform for finding local businesses that need digital services. Search by industry + city, score leads on digital presence, manage in a lightweight CRM.

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── business/
│   │   │   ├── search/                # Main sweep
│   │   │   ├── neighborhoods/         # Region + zone metadata for picker
│   │   │   ├── last-search/           # Auto-save "resume" session
│   │   │   └── saved-sessions/        # Named permanent sessions
│   │   ├── leads/                     # CRUD + contact logs
│   │   └── settings/                  # API key management
│   └── page.tsx                       # Home + results view (large)
├── components/
│   ├── search/                        # CityInput, BusinessTypeSelector, RegionPicker,
│   │                                    AreaDensityMeter, ActivityTicker, IdleScoreDial,
│   │                                    WelcomeHeader, SaveSessionButton, SavedSessionsPanel,
│   │                                    ResumeSearchCard, ZoneChipsStrip, RadarScan
│   ├── leads/                         # Lead UI (scoring badges, enrich, etc.)
│   └── ui/, settings/, auth/, crm/
├── lib/
│   ├── business/                      # geocode, scoring, zone-grid, area-score,
│   │                                    last-search-store, saved-sessions-store, search
│   ├── hooks/                         # useEnrichmentStream, useCyclingPlaceholder
│   └── search-cache.ts                # localStorage-backed cached search
prisma/
└── schema.prisma                      # LastSearchSession, SavedSearchSession added
```

## Code Quality — Zero Tolerance

After editing ANY file:
```bash
npm run lint && npm run typecheck
```
Fix ALL errors/warnings before continuing. Dev server is port 3002:
```bash
NODE_OPTIONS="--max-old-space-size=8192" PORT=3002 npm run dev
```

DB commands: `npm run db:generate`, `npm run db:migrate`, `npx prisma db push` (used in last session to avoid migration reset).

## Current Focus

Zone-discovery UX. Wealth-based area scoring shipped (v6-spread), Phase 2 saved sessions shipped, RegionPicker shipped. Active blocker: region-picker underfills East/West/outer regions for dense cities (London), Canary Wharf still missing from zones entirely (OSM tagging issue).

## Last Session (2026-04-20) — scoring overhaul + region picker + saved sessions

- **Area scoring v2→v6**: new Overpass tags (`shop=jewelry|watches|boutique|art`, `office=financial|lawyer|accountant`, premium hotels via `stars≥4`, negative signals via `amenity=pawnshop|money_lender|social_facility`). Log-capped weights tuned for 0-100 spread on global dense cities. Cache version: `v6-wider-cap`. Research doc at `C:\Users\SPARTAN PC\Downloads\LEAD_SNATCHER_AREA_SCORING_RESEARCH.md`.
- **Place-based zone scanning**: switched from fixed 3×3 geometric grid to OSM named-place centroids (Mayfair, Temple, Ginza). Added `way`+`relation` types, `place=locality`. Dedupe at 700m. Fallback to grid for sparse cities.
- **RegionPicker** (`src/components/search/RegionPicker.tsx`): replaced flat NeighborhoodChips with 9-region drill-down (NW/N/NE, W/Central/E, SW/S/SE). `/api/business/neighborhoods` now returns `{ regions, zones, singleZone }` shape.
- **Phase 2 Saved Sessions**: new `SavedSearchSession` Prisma model, `saved-sessions-store.ts`, `/api/business/saved-sessions/[id]/` routes, `SaveSessionButton` + `SavedSessionsPanel`. Auto-save resume card Phase 1 also landed (no more auto-redirect to results on mount, dismissible via sessionStorage).
- **Home screen rebuilt for video recording**: HUD-coherent idle loop (cycling placeholders, activity ticker, floating `IdleScoreDial`, rotating tile spotlight, mesh gradient bg, GlowEffect search button, always-on LIVE badge, custom industry input, pimped Deep Analysis toggle). `useCyclingPlaceholder` hook. All elements continuous — no boot sequence.
- **Misc**: country dropdown via `createPortal` (fixed stacking-context fight with GlowEffect), AreaDensityMeter rim icons swapped to Luxury/Pro Svc/Premium/Banks/Leisure/Hotels/Casino/Pawn (negative in rose).

Stopped at: committed + pushed as `a9c78f9`. User tested London chips — Central is packed correctly, but **West shows only 3 zones (~60 each), East shows only Devonshire Square (65), Canary Wharf completely absent**. RegionPicker is underfilling outer regions.

## Next Steps

1. **Investigate RegionPicker sparse-fill for dense cities** — London: Central is fine (Mayfair, Temple, East Marylebone, etc.), but East/West/outer have very few zones. Two suspected causes, test both:
   - **Geometric 3×3 classification is miscalibrated.** Nominatim's bbox for "London" after 20km `clampBbox` means center third = inner Zone 1/2 where ALL the wealth signals concentrate, pushing nearly every scored zone into Central. Outer regions get residual sparse stuff. Consider weighted/density-aware region split, OR widen `MAX_BBOX_SIDE_KM` beyond 20km, OR use admin_level-based districts per-country.
   - **Canary Wharf OSM tagging.** It's at ~7km east of central London (within the 20km bbox), SHOULD fall in East region geometrically, but doesn't appear at all in the zones list — meaning the Overpass query isn't picking it up even with `way` + `relation` + `place=locality`. Probably tagged as `landuse=commercial` or `boundary=administrative` (admin_level=9). Test: add those tag types to Overpass in `src/lib/business/zone-grid.ts` `fetchOverpassForBbox` and see if CW + Stratford + Greenwich appear.
   - Relevant files: `src/lib/business/zone-grid.ts` (constants, `fetchOverpassForBbox`, `buildPlaceBasedZones`, `classifyRegion`-equivalent), `src/app/api/business/neighborhoods/route.ts` (`classifyRegion` lives here — 3×3 splitter over city bbox).

2. **Fix Enrich render-tree bug (CRITICAL — still unresolved from prior session)** — `<EnrichmentExplainer>` and `<BatchEnrichBar>` are rendered AFTER the `if (viewMode === 'results') return …` early return. Clicking Enrich from results view sets `explainerOpen=true` but modal isn't mounted. Wrap both branches in a fragment with the floating UI, or refactor to a single return. `src/app/page.tsx`.

3. **Foot traffic rip-out** (still pending from prior session) — remove `FootTrafficSlot` UI + fetch button, remove peak-busyness bonus in `getEffectiveFitScore`/`computeFitScore`. Keep `Lead.popularTimesData`/`popularTimesScrapedAt` DB fields for possible revival.

4. **Nice-to-have**: include failing URL in `PageSpeed API error: 400` log line in `src/lib/business/pagespeed.ts`.

5. **Phase C scoring (backlog, non-urgent)**: per-region baseline z-score normalization, Overture Maps fusion for emerging markets (MENA/Africa/SE Asia), distance-decay instead of hard 1.5km radius, `brand=*` filtering for premium groceries/hotels, tourist-trap debiasing. See research doc section "Phase C".
