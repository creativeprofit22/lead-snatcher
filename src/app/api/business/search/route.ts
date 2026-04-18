import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  geocodeCity,
  searchBusinesses,
  scanCityZones,
} from '@/lib/business';
import { getPageSpeedKey } from '@/lib/business/pagespeed-key';
import type { Zone, ZoneLevel } from '@/lib/business/zone-grid';
import { estimateBudget, buildBudgetInput, computeFitScore } from '@/lib/business/budget-estimate';
import { getSearchQuery } from '@/lib/constants';
import { ApiError } from '@/lib/errors';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';
import { businessSearchSchema } from '@/lib/validations';
import type { IndustryType } from '@/types';

// Human-readable tier label for a zone — e.g. "Premium Area", "Commercial Area".
function tierLabel(level: ZoneLevel): string {
  switch (level) {
    case 'premium':
      return 'Premium Area';
    case 'commercial':
      return 'Commercial Area';
    case 'moderate':
      return 'Moderate Area';
    case 'developing':
      return 'Developing Area';
  }
}

// Headline label: prefers the zone's actual name, falls back to tier label.
function describeZoneLabel(zone: Zone): string {
  const directional = new Set([
    'SW Quadrant',
    'South',
    'SE Quadrant',
    'West',
    'Central',
    'East',
    'NW Quadrant',
    'North',
    'NE Quadrant',
    'Zone',
    'Area',
  ]);
  if (!directional.has(zone.label)) {
    // Named neighborhood — e.g. "The Loop"
    return zone.label;
  }
  return tierLabel(zone.level);
}

// One-line description of a zone that adapts to whatever amenity data we
// have. Never produces "could not access area" — the zone scan is the
// source of truth here, and an empty zone just reports empty honestly.
function describeZone(zone: Zone): string {
  const { banks, hotels, hospitals, total } = zone.amenities;
  if (total === 0) {
    return `Commercial infrastructure limited in this zone — ${zone.score}/100 area score`;
  }
  if (zone.level === 'premium') {
    return `${banks} banks, ${hotels} hotels nearby — high-value commercial area`;
  }
  if (zone.level === 'commercial') {
    return `Active commercial area with ${total} key amenities nearby`;
  }
  if (zone.level === 'moderate') {
    return `Some commercial activity (${total} amenities${hospitals > 0 ? `, incl. ${hospitals} hospital${hospitals === 1 ? '' : 's'}` : ''}) — growing area`;
  }
  return `Limited commercial infrastructure (${total} amenities) — emerging market`;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limit search to prevent API quota exhaustion
    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(`search:${session.user.id}:${ip}`, RATE_LIMITS.search);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: 'Too many searches. Please wait a moment and try again.' },
        { status: 429 }
      );
    }

    const rawBody = await request.json();
    const parsed = businessSearchSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
        { status: 400 }
      );
    }
    const {
      businessType,
      city,
      country,
      limit,
      deepAnalysis,
      enableEnrichment,
      searchLat,
      searchLng,
      zoneLabel,
    } = parsed.data;

    // Geocode the city. Always needed for the zone-grid bbox, even when the
    // caller supplies explicit search coords (zone-targeted rescan).
    const geocodeResult = await geocodeCity(city, country);
    if (!geocodeResult) {
      return NextResponse.json(
        { error: `Could not find location: ${city}. Try a different city.` },
        { status: 400 }
      );
    }

    // Resolve the exact Maps search center: explicit zone coords win, else
    // fall back to the geocoded city centroid.
    const searchCenterLat =
      typeof searchLat === 'number' ? searchLat : geocodeResult.latitude;
    const searchCenterLng =
      typeof searchLng === 'number' ? searchLng : geocodeResult.longitude;
    const isZoneTargeted =
      typeof searchLat === 'number' && typeof searchLng === 'number';

    // Get localized search query for better results
    // e.g., "real_estate" + "de" → "Immobilienmakler"
    const searchQuery = getSearchQuery(businessType as IndustryType, country);

    // Pull the user's PageSpeed key (optional; falls back to env, then to
    // the unauthenticated endpoint which Google rate-limits hard).
    const pageSpeedApiKey = deepAnalysis
      ? await getPageSpeedKey(session.user.id)
      : undefined;

    // Run business search and city zone scan in parallel. Zone scan is free
    // (one Overpass call, cached 7d per city) and now serves as the single
    // source of truth for area density — no separate scoreArea call that
    // could fail when Overpass is rate-limited.
    const [results, zoneGrid] = await Promise.all([
      searchBusinesses(
        session.user.id,
        searchQuery,
        searchCenterLat,
        searchCenterLng,
        limit,
        {
          enableWebsiteScraping: true, // Always scrape for tech stack & features
          enableWebsiteAnalysis: deepAnalysis, // Optional PageSpeed analysis
          enableEnrichment, // Optional web-search + social fallback for missing data
          pageSpeedApiKey,
          city,
        }
      ),
      scanCityZones(
        city,
        country,
        geocodeResult.latitude,
        geocodeResult.longitude,
        geocodeResult.bbox
      ),
    ]);

    // Pick the focused zone:
    //  - If the caller specified a zoneLabel (chip click), use that zone
    //  - Else the top-scoring zone (zones are already sorted desc by score)
    //  - Fallback for empty zones list: synthesize a neutral zone so the
    //    response is always well-formed.
    const focusedZone: Zone =
      (zoneLabel && zoneGrid.zones.find((z) => z.label === zoneLabel)) ||
      zoneGrid.zones[0] || {
        id: 'zone-fallback',
        label: geocodeResult.displayName.split(',')[0].trim() || 'Area',
        latitude: searchCenterLat,
        longitude: searchCenterLng,
        score: 50,
        level: 'moderate' as ZoneLevel,
        amenities: {
          banks: 0,
          hotels: 0,
          hospitals: 0,
          pharmacies: 0,
          supermarkets: 0,
          fuelStations: 0,
          affluenceSpots: 0,
          total: 0,
        },
        radiusMeters: 1500,
        distanceFromCenterMeters: 0,
      };

    // Enrich each result with budget estimate, area level, and Fit Score
    const enrichedResults = results.map((result) => {
      const budgetInput = buildBudgetInput(
        result.scoreBreakdown,
        result.reviewCount || 0,
        !!result.website,
        result.contactPoints,
        focusedZone.score,
        focusedZone.level,
        result.priceLevel
        // peakBusyness omitted — Popular Times is opt-in per-card on the
        // search page; fitScore is recomputed client-side when it arrives.
      );
      const budgetEstimate = estimateBudget(budgetInput);
      return {
        ...result,
        budgetEstimate,
        areaLevel: focusedZone.level,
        fitScore: computeFitScore(result.leadScore, budgetEstimate.points),
      };
    });

    // Save search to database — persist the exact coords queried so zone
    // rescans show up as distinct history rows.
    await prisma.businessSearch.create({
      data: {
        userId: session.user.id,
        businessType,
        city,
        country,
        latitude: searchCenterLat,
        longitude: searchCenterLng,
        results: {
          create: results.map((result) => ({
            placeId: result.placeId,
            name: result.name,
            address: result.address,
            phone: result.phone,
            website: result.website,
            rating: result.rating,
            reviewCount: result.reviewCount,
            types: JSON.stringify(result.types),
            photoUrl: result.photoUrl,
            mapsUrl: result.mapsUrl,
            leadScore: result.leadScore,
          })),
        },
      },
    });

    const count = enrichedResults.length;

    // Market density from result count (business competition)
    const competitionLevel = count >= 30 ? 'high' : count >= 15 ? 'medium' : 'low';

    // Market density is now derived from the focused zone. Label becomes the
    // neighborhood name (e.g. "The Loop") rather than a generic "Premium Zone"
    // string — much more concrete for users wondering "where did this score
    // come from?" Description paraphrases the zone's amenity counts so it
    // always has content, even when amenity totals are zero.
    const densityLevelBucket: 'high' | 'medium' | 'low' =
      focusedZone.level === 'premium' || focusedZone.level === 'commercial'
        ? 'high'
        : focusedZone.level === 'moderate'
          ? 'medium'
          : 'low';
    const densityDescription = describeZone(focusedZone);

    const marketDensity = {
      count,
      level: densityLevelBucket,
      label: describeZoneLabel(focusedZone),
      description: densityDescription,
      areaScore: focusedZone.score,
      competition: competitionLevel,
      amenities: focusedZone.amenities,
    };

    return NextResponse.json({
      results: enrichedResults,
      location: geocodeResult,
      count,
      marketDensity,
      zones: zoneGrid.zones,
      zoneCentroid: zoneGrid.centroid,
      zoneBbox: zoneGrid.bbox,
      singleZone: zoneGrid.singleZone,
      searchCenter: {
        latitude: searchCenterLat,
        longitude: searchCenterLng,
        zoneLabel: isZoneTargeted ? zoneLabel : undefined,
      },
    });
  } catch (error) {
    console.error('Business search error:', error);

    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: 'Search failed. Please try again.' },
      { status: 500 }
    );
  }
}
