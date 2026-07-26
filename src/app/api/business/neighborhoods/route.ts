import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { geocodeCity, scanCityZones } from '@/lib/business';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';
import { neighborhoodLookupResponseSchema } from '@/lib/business/neighborhood-contract';
import { buildNeighborhoodLookup } from '@/lib/business/zone-neighborhoods';

function jsonNeighborhoodLookup(payload: unknown) {
  return NextResponse.json(neighborhoodLookupResponseSchema.parse(payload));
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
      return NextResponse.json({ error: 'Too many requests. Slow down a touch.' }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const city = searchParams.get('city')?.trim();
    const country = searchParams.get('country')?.trim() || 'us';

    if (!city || city.length < 2) {
      return jsonNeighborhoodLookup({
        regions: [],
        zones: [],
        singleZone: true,
      });
    }

    const geocodeResult = await geocodeCity(city, country);
    if (!geocodeResult) {
      return jsonNeighborhoodLookup({
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

    const neighborhoodLookup = buildNeighborhoodLookup(zoneGrid);

    return jsonNeighborhoodLookup({
      ...neighborhoodLookup,
      city: geocodeResult.displayName,
    });
  } catch (error) {
    console.error('Neighborhoods lookup error:', error);
    return jsonNeighborhoodLookup({ regions: [], zones: [], singleZone: true });
  }
}
