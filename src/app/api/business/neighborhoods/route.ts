import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { geocodeCity, scanCityZones } from '@/lib/business';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

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
      return NextResponse.json({ neighborhoods: [], singleZone: true });
    }

    const geocodeResult = await geocodeCity(city, country);
    if (!geocodeResult) {
      return NextResponse.json({ neighborhoods: [], singleZone: true });
    }

    const zoneGrid = await scanCityZones(
      city,
      country,
      geocodeResult.latitude,
      geocodeResult.longitude,
      geocodeResult.bbox
    );

    // Surface only named, meaningful zones. Skip directional fallbacks and
    // zero-score zones — they'd just be noise under the input.
    const neighborhoods = zoneGrid.zones
      .filter(
        (z) =>
          !DIRECTIONAL_FALLBACK_LABELS.has(z.label) &&
          z.score > 0 &&
          z.amenities.total > 0
      )
      .slice(0, 6)
      .map((z) => ({
        label: z.label,
        score: z.score,
        level: z.level,
        latitude: z.latitude,
        longitude: z.longitude,
      }));

    return NextResponse.json({
      neighborhoods,
      singleZone: zoneGrid.singleZone,
      city: geocodeResult.displayName,
    });
  } catch (error) {
    console.error('Neighborhoods lookup error:', error);
    return NextResponse.json(
      { neighborhoods: [], singleZone: true },
      { status: 200 } // soft-fail: empty chips is better UX than a red error
    );
  }
}
