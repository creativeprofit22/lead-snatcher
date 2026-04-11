import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { geocodeCity, searchBusinesses, scoreArea } from '@/lib/business';
import { estimateBudget, buildBudgetInput } from '@/lib/business/budget-estimate';
import { getSearchQuery } from '@/lib/constants';
import { ApiError } from '@/lib/errors';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';
import { businessSearchSchema } from '@/lib/validations';
import type { IndustryType } from '@/types';

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
    const { businessType, city, country, limit, deepAnalysis } = parsed.data;

    // Geocode the city
    const geocodeResult = await geocodeCity(city, country);
    if (!geocodeResult) {
      return NextResponse.json(
        { error: `Could not find location: ${city}. Try a different city.` },
        { status: 400 }
      );
    }

    // Get localized search query for better results
    // e.g., "real_estate" + "de" → "Immobilienmakler"
    const searchQuery = getSearchQuery(businessType as IndustryType, country);

    // Run business search and area scoring in parallel
    const [results, areaScore] = await Promise.all([
      searchBusinesses(
        session.user.id,
        searchQuery,
        geocodeResult.latitude,
        geocodeResult.longitude,
        limit,
        {
          enableWebsiteScraping: true, // Always scrape for tech stack & features
          enableWebsiteAnalysis: deepAnalysis, // Optional PageSpeed analysis
        }
      ),
      scoreArea(geocodeResult.latitude, geocodeResult.longitude),
    ]);

    // Enrich each result with budget estimate and area level
    const enrichedResults = results.map((result) => {
      const budgetInput = buildBudgetInput(
        result.scoreBreakdown,
        result.reviewCount || 0,
        !!result.website,
        result.contactPoints,
        areaScore.score,
        areaScore.level
      );
      return {
        ...result,
        budgetEstimate: estimateBudget(budgetInput),
        areaLevel: areaScore.level,
      };
    });

    // Save search to database
    await prisma.businessSearch.create({
      data: {
        userId: session.user.id,
        businessType,
        city,
        country,
        latitude: geocodeResult.latitude,
        longitude: geocodeResult.longitude,
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

    // Combined market intelligence
    const marketDensity = {
      count,
      level: areaScore.level === 'premium' || areaScore.level === 'commercial' ? 'high'
        : areaScore.level === 'moderate' ? 'medium'
        : 'low',
      label: areaScore.label,
      description: areaScore.description,
      areaScore: areaScore.score,
      competition: competitionLevel,
      amenities: areaScore.amenities,
    };

    return NextResponse.json({
      results: enrichedResults,
      location: geocodeResult,
      count,
      marketDensity,
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
