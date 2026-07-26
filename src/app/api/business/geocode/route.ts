import { NextResponse } from 'next/server';
import { geocodeCity } from '@/lib/business';
import { DEFAULT_COUNTRY_CODE } from '@/lib/constants';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';
import { requireRouteUserId, routeErrorResponse } from '@/lib/route-utils';

export async function GET(request: Request) {
  try {
    const userId = await requireRouteUserId();
    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(`geocode:${userId}:${ip}`, RATE_LIMITS.standard);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: 'Too many geocoding requests. Please wait a moment and try again.' },
        { status: 429 }
      );
    }

    const { searchParams } = new URL(request.url);
    const city = searchParams.get('city')?.trim();
    const country = searchParams.get('country')?.trim() || DEFAULT_COUNTRY_CODE;

    if (!city) {
      return NextResponse.json({ error: 'City is required' }, { status: 400 });
    }

    const result = await geocodeCity(city, country);

    if (!result) {
      return NextResponse.json({ error: `Could not find location: ${city}` }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Geocode error:', error);
    return routeErrorResponse(error, 'Geocoding failed. Please try again.');
  }
}
