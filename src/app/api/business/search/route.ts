import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { geocodeCity, searchBusinesses, scanCityZones } from '@/lib/business';
import { getPageSpeedKey } from '@/lib/business/pagespeed-key';
import type { Zone, ZoneLevel } from '@/lib/business/zone-contract';
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

export function getFallbackZoneLabel(displayName: string | null | undefined): string {
  return displayName?.split(',')[0]?.trim() || 'Area';
}

interface SearchCenter {
  latitude: number;
  longitude: number;
}

function distanceBetweenMeters(from: SearchCenter, to: SearchCenter): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

/** Selects the one zone used for budgets, density, and persisted UI focus. */
export function selectFocusedZone(
  zones: Zone[],
  searchCenter: SearchCenter | null,
  targetedZoneLabel?: string
): Zone | undefined {
  if (targetedZoneLabel) {
    const labelMatch = zones.find((zone) => zone.label === targetedZoneLabel);
    if (labelMatch) return labelMatch;
  }

  if (
    !searchCenter ||
    !Number.isFinite(searchCenter.latitude) ||
    !Number.isFinite(searchCenter.longitude)
  ) {
    return zones[0];
  }

  let nearestZone: Zone | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const zone of zones) {
    if (!Number.isFinite(zone.latitude) || !Number.isFinite(zone.longitude)) continue;
    const distance = distanceBetweenMeters(searchCenter, zone);
    if (distance < nearestDistance) {
      nearestZone = zone;
      nearestDistance = distance;
    }
  }

  return nearestZone ?? zones[0];
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
    const { businessType, city, country, limit, deepAnalysis, searchLat, searchLng, zoneLabel } =
      parsed.data;

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
    const searchCenterLat = typeof searchLat === 'number' ? searchLat : geocodeResult.latitude;
    const searchCenterLng = typeof searchLng === 'number' ? searchLng : geocodeResult.longitude;
    const isZoneTargeted = typeof searchLat === 'number' && typeof searchLng === 'number';

    // Get localized search query for better results
    // e.g., "real_estate" + "de" → "Immobilienmakler"
    const searchQuery = getSearchQuery(businessType as IndustryType, country);

    // Pull the user's PageSpeed key (optional; falls back to env, then to
    // the unauthenticated endpoint which Google rate-limits hard).
    const pageSpeedApiKey = deepAnalysis ? await getPageSpeedKey(session.user.id) : undefined;

    // Run business search and city zone scan in parallel. Zone scan is free
    // (one Overpass call, cached 7d per city) and now serves as the single
    // source of truth for area density, avoiding a redundant request that
    // could fail when Overpass is rate-limited.
    const [results, zoneGrid] = await Promise.all([
      searchBusinesses(session.user.id, searchQuery, searchCenterLat, searchCenterLng, limit, {
        enableWebsiteScraping: true, // Always scrape for tech stack & features
        enableWebsiteAnalysis: deepAnalysis, // Optional PageSpeed analysis
        pageSpeedApiKey,
        city,
      }),
      scanCityZones(
        city,
        country,
        geocodeResult.latitude,
        geocodeResult.longitude,
        geocodeResult.bbox
      ),
    ]);

    // Resolve focus once on the server. Targeted labels win exactly; otherwise
    // use the zone nearest the actual Maps search center, regardless of score rank.
    const focusedZone =
      zoneGrid.status === 'ok'
        ? selectFocusedZone(
            zoneGrid.zones,
            { latitude: searchCenterLat, longitude: searchCenterLng },
            isZoneTargeted ? zoneLabel : undefined
          )
        : undefined;

    // Enrich each result with budget estimate, area level, and Fit Score
    const enrichedResults = results.map((result) => {
      const budgetInput = buildBudgetInput(
        result.scoreBreakdown,
        result.reviewCount || 0,
        !!result.website,
        result.contactPoints,
        focusedZone?.score,
        focusedZone?.level,
        result.priceLevel,
        result.rating,
        focusedZone?.archetype,
        result.types,
        result.name
      );
      const budgetEstimate = estimateBudget(budgetInput);
      return {
        ...result,
        budgetEstimate,
        areaLevel: focusedZone?.level,
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

    // Successful scans report observed zone evidence. Provider failures omit
    // numeric density entirely and tell the client to retry instead of inventing
    // a low-density market.
    const marketDensity = focusedZone
      ? {
          status: 'ok' as const,
          count,
          level:
            focusedZone.level === 'premium' || focusedZone.level === 'commercial'
              ? ('high' as const)
              : focusedZone.level === 'moderate'
                ? ('medium' as const)
                : ('low' as const),
          label: describeZoneLabel(focusedZone),
          description: describeZone(focusedZone),
          areaScore: focusedZone.score,
          competition: competitionLevel,
          amenities: focusedZone.amenities,
        }
      : {
          status: 'unavailable' as const,
          count,
          level: 'unavailable' as const,
          label: getFallbackZoneLabel(geocodeResult.displayName),
          description:
            'Area scan unavailable because the map provider could not be reached. Retry the search to refresh market density.',
          competition: competitionLevel,
        };

    return NextResponse.json({
      results: enrichedResults,
      location: geocodeResult,
      count,
      marketDensity,
      zoneScanStatus: zoneGrid.status,
      zones: zoneGrid.zones,
      zoneCentroid: zoneGrid.centroid,
      zoneBbox: zoneGrid.bbox,
      singleZone: zoneGrid.singleZone,
      focusedZoneId: focusedZone?.id ?? null,
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

    return NextResponse.json({ error: 'Search failed. Please try again.' }, { status: 500 });
  }
}
