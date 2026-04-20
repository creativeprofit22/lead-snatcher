import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { geocodeCity, scanCityZones } from '@/lib/business';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';
import type { Zone } from '@/lib/business/zone-grid';

// Directional fallbacks used by zone-grid when no named place is nearby.
// These are NOT real neighborhood names and should be hidden from suggestions.
const DIRECTIONAL_FALLBACK_LABELS = new Set([
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
]);

type RegionDirection =
  | 'nw'
  | 'n'
  | 'ne'
  | 'w'
  | 'central'
  | 'e'
  | 'sw'
  | 's'
  | 'se';

interface RegionSummary {
  direction: RegionDirection;
  label: string;
  score: number; // max score of any zone inside this region (0 if none)
  zoneCount: number;
  topLabel: string | null; // the best-scoring neighborhood inside, for preview text
}

interface NeighborhoodOut {
  label: string;
  score: number;
  level: Zone['level'];
  latitude: number;
  longitude: number;
  region: RegionDirection;
}

const DIRECTION_LABELS: Record<RegionDirection, string> = {
  nw: 'Northwest',
  n: 'North',
  ne: 'Northeast',
  w: 'West',
  central: 'Central',
  e: 'East',
  sw: 'Southwest',
  s: 'South',
  se: 'Southeast',
};

/**
 * Classify a lat/lng into one of 9 regions based on the city bbox.
 * Splits bbox into a 3×3 grid. Lat axis: south third / mid third / north
 * third. Lon axis: west / mid / east. Combined gives SW/S/SE, W/Central/E,
 * NW/N/NE.
 */
function classifyRegion(
  lat: number,
  lon: number,
  bbox: [number, number, number, number]
): RegionDirection {
  const [south, north, west, east] = bbox;
  const latThird = (north - south) / 3;
  const lonThird = (east - west) / 3;

  const latIdx = lat < south + latThird ? 0 : lat < south + 2 * latThird ? 1 : 2; // 0=south, 1=mid, 2=north
  const lonIdx = lon < west + lonThird ? 0 : lon < west + 2 * lonThird ? 1 : 2; // 0=west, 1=mid, 2=east

  const grid: RegionDirection[][] = [
    ['sw', 's', 'se'],
    ['w', 'central', 'e'],
    ['nw', 'n', 'ne'],
  ];
  return grid[latIdx][lonIdx];
}

const REGION_ORDER: RegionDirection[] = [
  'nw',
  'n',
  'ne',
  'w',
  'central',
  'e',
  'sw',
  's',
  'se',
];

function buildRegionSummaries(zones: NeighborhoodOut[]): RegionSummary[] {
  const byRegion = new Map<RegionDirection, NeighborhoodOut[]>();
  for (const z of zones) {
    const list = byRegion.get(z.region) ?? [];
    list.push(z);
    byRegion.set(z.region, list);
  }
  return REGION_ORDER.map((direction) => {
    const list = byRegion.get(direction) ?? [];
    const sorted = list.sort((a, b) => b.score - a.score);
    const top = sorted[0];
    return {
      direction,
      label: DIRECTION_LABELS[direction],
      score: top?.score ?? 0,
      zoneCount: list.length,
      topLabel: top?.label ?? null,
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Soft rate limit — shared with standard calls so typing fast doesn't
    // let one user hammer Nominatim/Overpass through our server.
    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(
      `neighborhoods:${session.user.id}:${ip}`,
      RATE_LIMITS.standard
    );
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: 'Too many requests. Slow down a touch.' },
        { status: 429 }
      );
    }

    const { searchParams } = new URL(request.url);
    const city = searchParams.get('city')?.trim();
    const country = searchParams.get('country')?.trim() || 'us';

    if (!city || city.length < 2) {
      return NextResponse.json({
        regions: [],
        zones: [],
        singleZone: true,
      });
    }

    const geocodeResult = await geocodeCity(city, country);
    if (!geocodeResult) {
      return NextResponse.json({
        regions: [],
        zones: [],
        singleZone: true,
      });
    }

    const zoneGrid = await scanCityZones(
      city,
      country,
      geocodeResult.latitude,
      geocodeResult.longitude,
      geocodeResult.bbox
    );

    // Filter out directional fallbacks + empty zones before region grouping.
    const validZones = zoneGrid.zones.filter(
      (z) =>
        !DIRECTIONAL_FALLBACK_LABELS.has(z.label) &&
        z.score > 0 &&
        z.amenities.total > 0
    );

    // Annotate each zone with its region based on city bbox. Small-city
    // single-zone fallback has no meaningful sub-regions, so everything
    // lands in Central.
    const cityBbox = zoneGrid.bbox;
    const annotated: NeighborhoodOut[] = validZones.map((z) => ({
      label: z.label,
      score: z.score,
      level: z.level,
      latitude: z.latitude,
      longitude: z.longitude,
      region: zoneGrid.singleZone
        ? 'central'
        : classifyRegion(z.latitude, z.longitude, cityBbox),
    }));

    const regions = buildRegionSummaries(annotated);

    return NextResponse.json({
      regions,
      zones: annotated,
      singleZone: zoneGrid.singleZone,
      city: geocodeResult.displayName,
    });
  } catch (error) {
    console.error('Neighborhoods lookup error:', error);
    return NextResponse.json(
      { regions: [], zones: [], singleZone: true },
      { status: 200 } // soft-fail: empty state is better UX than a red error
    );
  }
}
